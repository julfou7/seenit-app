#!/usr/bin/env bash
set -Eeuo pipefail

readonly EXPECTED_PROJECT='gen-lang-client-0201895414'
readonly DEFAULT_DATABASE='default'
readonly AI_DATABASE='ai-studio-seenit-065aead8-cc5a-4b86-9f25-dd812194ffa4'
readonly DEFAULT_LOCATION='eur3'
readonly AI_LOCATION='us-west1'
readonly CLOUD_RUN_REGION='us-west1'
readonly CLOUD_RUN_SERVICE='seenit-app'
readonly FIREBASE_TOOLS_VERSION='14.16.0'

PROJECT_ID="${GCP_PROJECT_ID:-}"
EXPECTED_SHA="${SEENIT_MIGRATION_SHA:-}"
CONFIRMATION="${SEENIT_MIGRATION_CONFIRMATION:-}"
RUN_ID="${GITHUB_RUN_ID:-local}"
RUN_ATTEMPT="${GITHUB_RUN_ATTEMPT:-1}"
STATE_DIR="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/seenit-firestore-migration-${RUN_ID}-${RUN_ATTEMPT}"
VERIFY_DEFAULT="seenit-verify-default-${RUN_ID}-${RUN_ATTEMPT}"
VERIFY_AI="seenit-verify-aistudio-${RUN_ID}-${RUN_ATTEMPT}"
DEFAULT_BUCKET="${PROJECT_ID}-fs-default-${RUN_ID}-${RUN_ATTEMPT}"
AI_BUCKET="${PROJECT_ID}-fs-aistudio-${RUN_ID}-${RUN_ATTEMPT}"
DEFAULT_EXPORT="gs://${DEFAULT_BUCKET}/default"
AI_EXPORT="gs://${AI_BUCKET}/ai-studio"

TRAFFIC_LOCKED=false
DEFAULT_PROTECTION_DISABLED=false
DEFAULT_DELETED=false
DEFAULT_RECREATED=false
DEFAULT_RESTORED=false
AI_DELETED=false
MIGRATION_SUCCEEDED=false
PREFLIGHT_PASSED=false

log() {
  printf '[Firestore migration] %s\n' "$*"
}

database_json() {
  local database_id="$1"
  gcloud firestore databases describe \
    --project "$PROJECT_ID" \
    --database "$database_id" \
    --format=json
}

database_exists() {
  database_json "$1" >/dev/null 2>&1
}

deploy_rules() {
  local config_file="$1"
  npx --yes "firebase-tools@${FIREBASE_TOOLS_VERSION}" deploy \
    --project "$PROJECT_ID" \
    --config "$config_file" \
    --only firestore:rules \
    --non-interactive
}

restore_public_traffic() {
  if [[ "$TRAFFIC_LOCKED" != 'true' ]]; then
    return 0
  fi
  gcloud run services add-iam-policy-binding "$CLOUD_RUN_SERVICE" \
    --project "$PROJECT_ID" \
    --region "$CLOUD_RUN_REGION" \
    --member='allUsers' \
    --role='roles/run.invoker' \
    --quiet >/dev/null
  TRAFFIC_LOCKED=false
  log 'Accès public Cloud Run restauré.'
}

lock_public_traffic() {
  local policy_file="$STATE_DIR/cloud-run-policy.json"
  gcloud run services get-iam-policy "$CLOUD_RUN_SERVICE" \
    --project "$PROJECT_ID" \
    --region "$CLOUD_RUN_REGION" \
    --format=json > "$policy_file"
  if ! jq -e 'any(.bindings[]?; .role == "roles/run.invoker" and any(.members[]?; . == "allUsers"))' "$policy_file" >/dev/null; then
    log 'Le backend canonique n’est pas publiquement invocable ; bascule refusée.'
    return 1
  fi
  gcloud run services remove-iam-policy-binding "$CLOUD_RUN_SERVICE" \
    --project "$PROJECT_ID" \
    --region "$CLOUD_RUN_REGION" \
    --member='allUsers' \
    --role='roles/run.invoker' \
    --quiet >/dev/null
  TRAFFIC_LOCKED=true
  log 'Accès public Cloud Run suspendu.'
}

write_digest() {
  local database_id="$1"
  local output_file="$2"
  GOOGLE_CLOUD_PROJECT="$PROJECT_ID" node scripts/firestore-database-digest.cjs "$database_id" > "$output_file"
  jq -e '.documentCount >= 0 and (.digest | test("^[0-9a-f]{64}$")) and (.collectionGroupCounts | type == "object")' \
    "$output_file" >/dev/null
}

compare_digests() {
  local source_file="$1"
  local target_file="$2"
  local source_contract target_contract
  source_contract="$(jq -Sc '{documentCount, collectionGroupCounts, digest}' "$source_file")"
  target_contract="$(jq -Sc '{documentCount, collectionGroupCounts, digest}' "$target_file")"
  if [[ "$source_contract" != "$target_contract" ]]; then
    log 'Les digests documentaires divergent ; aucune suppression supplémentaire ne sera exécutée.'
    return 1
  fi
}

delete_database_if_present() {
  local database_id="$1"
  local current etag
  if ! current="$(database_json "$database_id" 2>/dev/null)"; then
    return 0
  fi
  etag="$(jq -r '.etag' <<<"$current")"
  gcloud firestore databases delete \
    --project "$PROJECT_ID" \
    --database "$database_id" \
    --etag "$etag" \
    --quiet
}

create_default_with_retry() {
  local attempt
  if database_exists "$DEFAULT_DATABASE"; then
    DEFAULT_RECREATED=true
    return 0
  fi
  for attempt in $(seq 1 40); do
    if gcloud firestore databases create \
      --project "$PROJECT_ID" \
      --database "$DEFAULT_DATABASE" \
      --location "$DEFAULT_LOCATION" \
      --edition=standard \
      --type=firestore-native \
      --delete-protection \
      --quiet; then
      DEFAULT_RECREATED=true
      DEFAULT_PROTECTION_DISABLED=false
      return 0
    fi
    log "L’identifiant default n’est pas encore réutilisable (tentative ${attempt}/40)."
    sleep 15
  done
  return 1
}

restore_default_after_cutover_failure() {
  local recovery_digest="$STATE_DIR/default-recovery-digest.json"
  log 'Tentative de restauration d’urgence de default.'
  create_default_with_retry || return 1
  gcloud firestore import "$DEFAULT_EXPORT" \
    --project "$PROJECT_ID" \
    --database "$DEFAULT_DATABASE" \
    --quiet
  write_digest "$DEFAULT_DATABASE" "$recovery_digest"
  compare_digests "$STATE_DIR/default-source-digest.json" "$recovery_digest"
  deploy_rules firebase.json
  restore_public_traffic
  DEFAULT_RESTORED=true
  log 'Restauration d’urgence vérifiée ; le trafic a été rouvert.'
}

recover_on_failure() {
  local status=$?
  trap - EXIT
  if [[ "$MIGRATION_SUCCEEDED" == 'true' ]]; then
    exit "$status"
  fi

  log "Échec de la migration (code ${status})."
  if [[ "$PREFLIGHT_PASSED" != 'true' ]]; then
    log 'Le préflight n’a produit aucune mutation ; aucun rollback nécessaire.'
    exit "$status"
  fi
  set +e
  delete_database_if_present "$VERIFY_DEFAULT"
  delete_database_if_present "$VERIFY_AI"

  if [[ "$DEFAULT_DELETED" == 'true' ]]; then
    if ! restore_default_after_cutover_failure; then
      log 'ROLLBACK INCOMPLET : maintenance conservée ; reprendre depuis les exports privés.'
    fi
  else
    if [[ "$DEFAULT_PROTECTION_DISABLED" == 'true' ]]; then
      gcloud firestore databases update \
        --project "$PROJECT_ID" \
        --database "$DEFAULT_DATABASE" \
        --delete-protection \
        --quiet
    fi
    deploy_rules firebase.json
    restore_public_traffic
  fi
  exit "$status"
}
trap recover_on_failure EXIT

preflight() {
  local current_sha command_expected databases default_meta ai_meta
  [[ "$PROJECT_ID" == "$EXPECTED_PROJECT" ]] || {
    log "Projet refusé : ${PROJECT_ID:-absent}."
    return 1
  }
  [[ "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]] || {
    log 'SHA main absent ou invalide.'
    return 1
  }
  current_sha="$(git rev-parse HEAD)"
  [[ "$current_sha" == "$EXPECTED_SHA" ]] || {
    log "Checkout différent du SHA autorisé : ${current_sha}."
    return 1
  }
  command_expected="/migrate-firestore-default project=${EXPECTED_PROJECT} sha=${EXPECTED_SHA}"
  [[ "$CONFIRMATION" == "$command_expected" ]] || {
    log 'Commande propriétaire exacte absente ou altérée.'
    return 1
  }
  [[ "${GITHUB_REPOSITORY:-}" == 'julfou7/seenit-app' ]] || {
    log 'Dépôt GitHub non canonique.'
    return 1
  }
  [[ "${GITHUB_EVENT_NAME:-}" == 'issue_comment' ]] || {
    log 'Le contrôleur ne peut être exécuté que depuis un commentaire d’issue.'
    return 1
  }

  mkdir -p "$STATE_DIR"
  databases="$(gcloud firestore databases list --project "$PROJECT_ID" --format=json)"
  jq -e --arg default "$DEFAULT_DATABASE" --arg ai "$AI_DATABASE" \
    '([.[] | select((.deleteTime // "") == "") | .name | split("/")[-1]] | sort)
      == ([$default, $ai] | sort)' <<<"$databases" >/dev/null || {
      log 'Topologie Firestore différente des deux bases attendues ; migration refusée.'
      return 1
    }

  default_meta="$(database_json "$DEFAULT_DATABASE")"
  ai_meta="$(database_json "$AI_DATABASE")"
  jq -e --arg location "$DEFAULT_LOCATION" '
    .locationId == $location
    and .databaseEdition == "STANDARD"
    and .type == "FIRESTORE_NATIVE"
    and .freeTier == false
    and .deleteProtectionState == "DELETE_PROTECTION_ENABLED"
    and .pointInTimeRecoveryEnablement == "POINT_IN_TIME_RECOVERY_DISABLED"
  ' <<<"$default_meta" >/dev/null || {
    log 'Métadonnées inattendues pour default.'
    return 1
  }
  jq -e --arg location "$AI_LOCATION" '
    .locationId == $location
    and .databaseEdition == "ENTERPRISE"
    and .type == "FIRESTORE_NATIVE"
    and .freeTier == true
    and .deleteProtectionState == "DELETE_PROTECTION_DISABLED"
    and .pointInTimeRecoveryEnablement == "POINT_IN_TIME_RECOVERY_DISABLED"
    and .firestoreDataAccessMode == "DATA_ACCESS_MODE_ENABLED"
  ' <<<"$ai_meta" >/dev/null || {
    log 'Métadonnées ou accès Firestore inattendus pour la base AI Studio.'
    return 1
  }
  printf '%s\n' "$default_meta" > "$STATE_DIR/default-before.json"
  printf '%s\n' "$ai_meta" > "$STATE_DIR/ai-before.json"

  gcloud eventarc triggers list --project "$PROJECT_ID" --location=- --format=json > "$STATE_DIR/eventarc-triggers.json"
  gcloud functions list --project "$PROJECT_ID" --v2 --format=json > "$STATE_DIR/cloud-functions.json"
  if jq -se '[.[] | .. | strings | select(test("firestore|document"; "i"))] | length > 0' \
      "$STATE_DIR/eventarc-triggers.json" "$STATE_DIR/cloud-functions.json" >/dev/null; then
    log 'Un trigger Firestore existe ; migration refusée sans inventaire manuel.'
    return 1
  fi

  for database_id in "$DEFAULT_DATABASE" "$AI_DATABASE"; do
    gcloud firestore indexes composite list \
      --project "$PROJECT_ID" \
      --database "$database_id" \
      --format=json > "$STATE_DIR/indexes-${database_id//[^a-zA-Z0-9]/_}.json"
    gcloud firestore fields ttls list \
      --project "$PROJECT_ID" \
      --database "$database_id" \
      --format=json > "$STATE_DIR/ttls-${database_id//[^a-zA-Z0-9]/_}.json"
    gcloud firestore indexes fields list \
      --project "$PROJECT_ID" \
      --database "$database_id" \
      --format=json > "$STATE_DIR/field-indexes-${database_id//[^a-zA-Z0-9]/_}.json"
  done
  if ! jq -se 'all(.[]; length == 0)' "$STATE_DIR"/indexes-*.json "$STATE_DIR"/ttls-*.json >/dev/null \
    || ! jq -se 'all(.[]; all(.[]; .name | contains("/collectionGroups/__default__/")))' \
      "$STATE_DIR"/field-indexes-*.json >/dev/null; then
    log 'Un index composite, une exemption de champ ou une politique TTL non restaurable automatiquement a été détecté.'
    return 1
  fi

  if database_exists "$VERIFY_DEFAULT" || database_exists "$VERIFY_AI"; then
    log 'Une base de répétition portant les identifiants de ce run existe déjà.'
    return 1
  fi
  PREFLIGHT_PASSED=true
}

create_export_bucket() {
  local bucket="$1"
  local location="$2"
  gcloud storage buckets create "gs://${bucket}" \
    --project "$PROJECT_ID" \
    --location "$location" \
    --default-storage-class=STANDARD \
    --uniform-bucket-level-access \
    --public-access-prevention \
    --soft-delete-duration=0s \
    --lifecycle-file=config/firestore-export-lifecycle.json
  gcloud storage buckets describe "gs://${bucket}" --format=json \
    | jq -e --arg location "${location^^}" \
      -f config/firestore-export-bucket-guard.jq >/dev/null
}

create_rehearsal_databases() {
  gcloud firestore databases create \
    --project "$PROJECT_ID" \
    --database "$VERIFY_DEFAULT" \
    --location "$DEFAULT_LOCATION" \
    --edition=standard \
    --type=firestore-native \
    --quiet
  gcloud firestore databases create \
    --project "$PROJECT_ID" \
    --database "$VERIFY_AI" \
    --location "$AI_LOCATION" \
    --edition=enterprise \
    --type=firestore-native \
    --enable-firestore-data-access \
    --no-enable-mongodb-compatible-data-access \
    --no-enable-realtime-updates \
    --quiet
}

run_migration() {
  local attempt default_etag ai_etag final_meta health_status
  preflight
  log 'Préflight canonique validé.'

  create_export_bucket "$DEFAULT_BUCKET" 'EU'
  create_export_bucket "$AI_BUCKET" "$AI_LOCATION"
  log 'Buckets privés à expiration 30 jours créés.'

  lock_public_traffic
  deploy_rules firebase.migration-lockdown.json
  sleep 30
  log 'Écritures client et backend figées.'

  write_digest "$DEFAULT_DATABASE" "$STATE_DIR/default-source-digest.json"
  write_digest "$AI_DATABASE" "$STATE_DIR/ai-source-digest.json"
  gcloud firestore export "$DEFAULT_EXPORT" \
    --project "$PROJECT_ID" \
    --database "$DEFAULT_DATABASE" \
    --quiet
  gcloud firestore export "$AI_EXPORT" \
    --project "$PROJECT_ID" \
    --database "$AI_DATABASE" \
    --quiet
  log 'Exports des deux bases terminés.'

  create_rehearsal_databases
  gcloud firestore import "$DEFAULT_EXPORT" \
    --project "$PROJECT_ID" \
    --database "$VERIFY_DEFAULT" \
    --quiet
  gcloud firestore import "$AI_EXPORT" \
    --project "$PROJECT_ID" \
    --database "$VERIFY_AI" \
    --quiet
  write_digest "$VERIFY_DEFAULT" "$STATE_DIR/default-rehearsal-digest.json"
  write_digest "$VERIFY_AI" "$STATE_DIR/ai-rehearsal-digest.json"
  compare_digests "$STATE_DIR/default-source-digest.json" "$STATE_DIR/default-rehearsal-digest.json"
  compare_digests "$STATE_DIR/ai-source-digest.json" "$STATE_DIR/ai-rehearsal-digest.json"
  log 'Les deux restaurations de répétition sont bit-à-bit équivalentes au niveau documentaire.'

  delete_database_if_present "$VERIFY_DEFAULT"
  delete_database_if_present "$VERIFY_AI"

  ai_etag="$(jq -r '.etag' "$STATE_DIR/ai-before.json")"
  gcloud firestore databases delete \
    --project "$PROJECT_ID" \
    --database "$AI_DATABASE" \
    --etag "$ai_etag" \
    --quiet
  AI_DELETED=true
  log 'Base AI Studio supprimée après preuve de restauration.'

  gcloud firestore databases update \
    --project "$PROJECT_ID" \
    --database "$DEFAULT_DATABASE" \
    --no-delete-protection \
    --quiet
  DEFAULT_PROTECTION_DISABLED=true
  default_etag="$(database_json "$DEFAULT_DATABASE" | jq -r '.etag')"
  gcloud firestore databases delete \
    --project "$PROJECT_ID" \
    --database "$DEFAULT_DATABASE" \
    --etag "$default_etag" \
    --quiet
  DEFAULT_DELETED=true
  log 'Ancienne default supprimée après export et répétition.'

  create_default_with_retry
  final_meta="$(database_json "$DEFAULT_DATABASE")"
  jq -e --arg location "$DEFAULT_LOCATION" '
    .locationId == $location
    and .databaseEdition == "STANDARD"
    and .type == "FIRESTORE_NATIVE"
    and .freeTier == true
    and .deleteProtectionState == "DELETE_PROTECTION_ENABLED"
    and .pointInTimeRecoveryEnablement == "POINT_IN_TIME_RECOVERY_DISABLED"
  ' <<<"$final_meta" >/dev/null || {
    log 'La nouvelle default n’a pas récupéré le quota gratuit ou sa configuration canonique.'
    return 1
  }

  gcloud firestore import "$DEFAULT_EXPORT" \
    --project "$PROJECT_ID" \
    --database "$DEFAULT_DATABASE" \
    --quiet
  write_digest "$DEFAULT_DATABASE" "$STATE_DIR/default-final-digest.json"
  compare_digests "$STATE_DIR/default-source-digest.json" "$STATE_DIR/default-final-digest.json"
  DEFAULT_RESTORED=true

  deploy_rules firebase.json
  restore_public_traffic
  health_status=''
  for attempt in $(seq 1 12); do
    health_status="$(curl --silent --show-error --max-time 15 --output "$STATE_DIR/health.json" --write-out '%{http_code}' https://seenit.ai.studio/api/health || true)"
    if [[ "$health_status" == '200' ]] \
      && jq -e '.status == "ok" and .service == "seenit-backend" and .identity == "canonical"' \
        "$STATE_DIR/health.json" >/dev/null; then
      break
    fi
    log "Smoke production en attente (tentative ${attempt}/12, HTTP ${health_status:-curl_error})."
    sleep 5
  done
  [[ "$health_status" == '200' ]] \
    && jq -e '.status == "ok" and .service == "seenit-backend" and .identity == "canonical"' \
      "$STATE_DIR/health.json" >/dev/null || {
        log "Smoke production en échec (HTTP ${health_status:-curl_error})."
        return 1
      }

  gcloud firestore databases list --project "$PROJECT_ID" --format=json > "$STATE_DIR/databases-after.json"
  jq -e --arg default "$DEFAULT_DATABASE" --arg project "$PROJECT_ID" '
    [.[] | select((.deleteTime // "") == "")] as $active
    | ($active | length) == 1
    and $active[0].name == ("projects/" + $project + "/databases/" + $default)
    and $active[0].freeTier == true
    and $active[0].deleteProtectionState == "DELETE_PROTECTION_ENABLED"
  ' "$STATE_DIR/databases-after.json" >/dev/null

  jq -n \
    --arg status 'success' \
    --arg defaultBucket "$DEFAULT_BUCKET" \
    --arg aiBucket "$AI_BUCKET" \
    --argjson defaultDocuments "$(jq '.documentCount' "$STATE_DIR/default-final-digest.json")" \
    --argjson aiDocuments "$(jq '.documentCount' "$STATE_DIR/ai-source-digest.json")" \
    --arg defaultDigest "$(jq -r '.digest' "$STATE_DIR/default-final-digest.json")" \
    --arg aiDigest "$(jq -r '.digest' "$STATE_DIR/ai-source-digest.json")" \
    '{status, defaultBucket, aiBucket, defaultDocuments, aiDocuments, defaultDigest, aiDigest, retentionDays: 30}' \
    > "$STATE_DIR/result.json"
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    printf 'result_file=%s\n' "$STATE_DIR/result.json" >> "$GITHUB_OUTPUT"
  fi
  MIGRATION_SUCCEEDED=true
  log 'Migration terminée : default est seule, en eur3 Standard, protégée et éligible au quota gratuit.'
}

run_migration
