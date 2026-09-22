#!/usr/bin/env bash
set -u

PROJECT_ID="${GCP_PROJECT_ID:-gen-lang-client-0201895414}"
REGION="${GCP_REGION:-us-west1}"
SERVICE="${GCP_SERVICE:-seenit-app}"
ARTIFACT_REPOSITORY="${GCP_ARTIFACT_REPOSITORY:-cloud-run-source-deploy}"
FIREBASE_BUCKET="${GCP_FIREBASE_BUCKET:-gen-lang-client-0201895414.firebasestorage.app}"
CLOUDBUILD_SOURCE_BUCKET="${PROJECT_ID}_cloudbuild"
STRICT="${FINOPS_STRICT:-false}"
DEEP_STORAGE_SCAN="${FINOPS_DEEP_STORAGE_SCAN:-false}"
VIOLATIONS=0

summary_line() {
  printf '%s\n' "$1"
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    printf '%s\n' "$1" >> "$GITHUB_STEP_SUMMARY"
  fi
}

console_json() {
  local prefix="$1"
  local payload="$2"
  printf '[FinOpsInventory] %s: %s\n' "$prefix" "$(jq -c . <<<"$payload")"
}

violation() {
  VIOLATIONS=$((VIOLATIONS + 1))
  summary_line "- ⚠️ ${1}"
}

unavailable() {
  summary_line "- ${1}: UNAVAILABLE (IAM/API)"
}

summary_line "## Inventaire FinOps GCP"
summary_line ""
summary_line "Projet: \`${PROJECT_ID}\`; région runtime canonique déclarée: \`${REGION}\`."
summary_line "Mode strict: \`${STRICT}\`; scan profond Storage: \`${DEEP_STORAGE_SCAN}\`."
summary_line ""

# Firestore: le fonctionnement cible de #23 impose une seule base `(default)`, Standard et free tier.
if firestore_json="$(gcloud firestore databases list --project "$PROJECT_ID" --format=json 2>/dev/null)"; then
  firestore_count="$(jq 'length' <<<"$firestore_json")"
  named_count="$(jq '[.[] | select((.name | split("/")[-1]) != "(default)")] | length' <<<"$firestore_json")"
  default_count="$(jq '[.[] | select((.name | split("/")[-1]) == "(default)")] | length' <<<"$firestore_json")"
  default_free_tier="$(jq -r '[.[] | select((.name | split("/")[-1]) == "(default)")][0].freeTier // false' <<<"$firestore_json")"
  default_edition="$(jq -r '[.[] | select((.name | split("/")[-1]) == "(default)")][0].databaseEdition // "UNKNOWN"' <<<"$firestore_json")"
  default_location="$(jq -r '[.[] | select((.name | split("/")[-1]) == "(default)")][0].locationId // "UNKNOWN"' <<<"$firestore_json")"
  delete_protection="$(jq -r '[.[] | select((.name | split("/")[-1]) == "(default)")][0].deleteProtectionState // "UNKNOWN"' <<<"$firestore_json")"

  summary_line "### Firestore"
  summary_line "- Bases actives: **${firestore_count}**; bases nommées hors \`(default)\`: **${named_count}**."
  summary_line "- \`(default)\`: région **${default_location}**, édition **${default_edition}**, free tier **${default_free_tier}**, protection suppression **${delete_protection}**."
  console_json "Firestore" "$(jq '[.[] | {database:(.name | split("/")[-1]), locationId, databaseEdition, freeTier, createTime, updateTime, firestoreDataAccessMode, mongodbCompatibleDataAccessMode, deleteProtectionState, pointInTimeRecoveryEnablement}]' <<<"$firestore_json")"

  if [[ "$firestore_count" != "1" || "$named_count" != "0" || "$default_count" != "1" ]]; then
    violation "Firestore doit contenir uniquement la base \`(default)\`."
  fi
  if [[ "$default_free_tier" != "true" || "$default_edition" != "STANDARD" ]]; then
    violation "La base \`(default)\` doit rester Standard et porteuse du free tier."
  fi
else
  summary_line "### Firestore"
  unavailable "Firestore databases"
fi
summary_line ""

# Cloud Run: inventaire global, sans limiter l'audit à us-west1.
if run_json="$(gcloud run services list --project "$PROJECT_ID" --platform managed --format=json 2>/dev/null)"; then
  run_count="$(jq 'length' <<<"$run_json")"
  run_regions="$(jq -r '[.[] | (.metadata.labels["cloud.googleapis.com/location"] // .metadata.annotations["run.googleapis.com/region"] // "UNKNOWN")] | unique | join(", ")' <<<"$run_json")"
  summary_line "### Cloud Run"
  summary_line "- Services actifs: **${run_count}**; régions: **${run_regions:-aucune}**."
  console_json "Cloud Run" "$(jq '[.[] | {name:.metadata.name, region:(.metadata.labels["cloud.googleapis.com/location"] // .metadata.annotations["run.googleapis.com/region"] // "UNKNOWN"), url:.status.url, minScale:.spec.template.metadata.annotations["autoscaling.knative.dev/minScale"], maxScale:.spec.template.metadata.annotations["autoscaling.knative.dev/maxScale"], vpcConnector:.spec.template.metadata.annotations["run.googleapis.com/vpc-access-connector"], directVpc:.spec.template.metadata.annotations["run.googleapis.com/network-interfaces"]}]' <<<"$run_json")"
  if (( run_count > 1 )); then
    violation "Plus d'un service Cloud Run est actif : vérifier qu'aucun runtime parasite ne peut générer de coût."
  fi
else
  summary_line "### Cloud Run"
  unavailable "Cloud Run services globaux"
fi
summary_line ""

# Artifact Registry: lister tous les dépôts, y compris hors de la région runtime déclarée.
if ar_json="$(gcloud artifacts repositories list --project "$PROJECT_ID" --location=all --format=json 2>/dev/null)"; then
  ar_count="$(jq 'length' <<<"$ar_json")"
  ar_nonzero="$(jq '[.[] | select(((.sizeBytes // "0") | tonumber?) > 0)] | length' <<<"$ar_json")"
  summary_line "### Artifact Registry"
  summary_line "- Dépôts: **${ar_count}**; dépôts avec taille déclarée > 0: **${ar_nonzero}**."
  console_json "Artifact Registry" "$(jq '[.[] | {name:(.name | split("/")[-1]), location:(.name | capture("/locations/(?<location>[^/]+)/").location // "UNKNOWN"), format, sizeBytes:(.sizeBytes // "0"), cleanupPolicyDryRun:(.cleanupPolicyDryRun // false)}]' <<<"$ar_json")"
else
  summary_line "### Artifact Registry"
  unavailable "Artifact Registry repositories globaux"
fi

# Conserver la vérification détaillée du dépôt canonique utilisé par le déploiement si elle est autorisée.
if packages_json="$(gcloud artifacts packages list --project "$PROJECT_ID" --repository "$ARTIFACT_REPOSITORY" --location "$REGION" --format=json 2>/dev/null)"; then
  package_count="$(jq 'length' <<<"$packages_json")"
  summary_line "- Dépôt canonique \`${REGION}/${ARTIFACT_REPOSITORY}\`: **${package_count} package(s)**."
else
  summary_line "- Dépôt canonique \`${REGION}/${ARTIFACT_REPOSITORY}\`: indisponible ou absent."
fi
summary_line ""

# Cloud Storage: le listing de métadonnées est léger. Le calcul des tailles objet par objet est opt-in
# pour éviter que l'audit quotidien ne crée lui-même des opérations inutiles.
if buckets_json="$(gcloud storage buckets list --project "$PROJECT_ID" --format=json 2>/dev/null)"; then
  bucket_count="$(jq 'length' <<<"$buckets_json")"
  summary_line "### Cloud Storage"
  summary_line "- Buckets: **${bucket_count}**."
  console_json "Cloud Storage buckets" "$(jq '[.[] | {name:(.name // .url), location, storageClass, versioning, softDeletePolicy, lifecycle}]' <<<"$buckets_json")"

  if [[ "$DEEP_STORAGE_SCAN" == "true" ]]; then
    summary_line "- Scan profond des tailles: activé pour ce run."
    while IFS= read -r bucket_name; do
      [[ -n "$bucket_name" ]] || continue
      if bucket_size="$(gcloud storage du --summarize --readable-sizes "gs://${bucket_name}" 2>/dev/null)"; then
        summary_line "  - \`gs://${bucket_name}\`: ${bucket_size}"
      else
        summary_line "  - \`gs://${bucket_name}\`: taille indisponible (IAM/API)."
      fi
    done < <(jq -r '.[] | (.name // .url // "") | sub("^gs://"; "")' <<<"$buckets_json")
  else
    summary_line "- Scan profond des tailles: désactivé (zéro opération objet ajoutée par l'audit quotidien)."
  fi
else
  summary_line "### Cloud Storage"
  unavailable "Cloud Storage buckets globaux"
fi
summary_line ""

# Cloud SQL n'est pas attendu pour SeenIt : toute instance visible est un signal de coût à investiguer.
if sql_json="$(gcloud sql instances list --project "$PROJECT_ID" --format=json 2>/dev/null)"; then
  sql_count="$(jq 'length' <<<"$sql_json")"
  summary_line "### Cloud SQL"
  summary_line "- Instances: **${sql_count}**."
  console_json "Cloud SQL" "$(jq '[.[] | {name, region, databaseVersion, state}]' <<<"$sql_json")"
  if (( sql_count > 0 )); then
    violation "Une instance Cloud SQL est présente alors que SeenIt n'en attend aucune."
  fi
else
  summary_line "### Cloud SQL"
  unavailable "Cloud SQL instances"
fi
summary_line ""

summary_line "### Verdict garde-fous"
if (( VIOLATIONS == 0 )); then
  summary_line "- ✅ Aucun écart structurel détecté par les garde-fous FinOps disponibles."
else
  summary_line "- ❌ **${VIOLATIONS} écart(s)** structurel(s) détecté(s)."
fi
summary_line "- Les lignes UNAVAILABLE restent des limites de lecture IAM/API et doivent être traitées comme une preuve manquante, pas comme une preuve d'absence de coût."

if [[ "$STRICT" == "true" && "$VIOLATIONS" -gt 0 ]]; then
  exit 1
fi
