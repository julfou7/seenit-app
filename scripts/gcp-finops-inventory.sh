#!/usr/bin/env bash
set -u

PROJECT_ID="${GCP_PROJECT_ID:-gen-lang-client-0201895414}"
REGION="${GCP_REGION:-us-west1}"
SERVICE="${GCP_SERVICE:-seenit-app}"
ARTIFACT_REPOSITORY="${GCP_ARTIFACT_REPOSITORY:-cloud-run-source-deploy}"
FIREBASE_BUCKET="${GCP_FIREBASE_BUCKET:-gen-lang-client-0201895414.firebasestorage.app}"
CLOUDBUILD_SOURCE_BUCKET="${PROJECT_ID}_cloudbuild"

summary_line() {
  printf '%s\n' "$1"
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    printf '%s\n' "$1" >> "$GITHUB_STEP_SUMMARY"
  fi
}

probe_json() {
  local label="$1"
  local jq_filter="$2"
  shift 2
  local output stderr_file
  stderr_file="$(mktemp)"

  if output="$("$@" --format=json 2>"$stderr_file")"; then
    summary_line "- ${label}: OK"
    if ! jq -c "$jq_filter" <<<"$output"; then
      printf '[FinOpsInventory] %s: réponse JSON invalide.\n' "$label"
      printf '%s\n' "$output"
    fi
    if [[ -s "$stderr_file" ]]; then
      sed 's/^/[FinOpsInventory] /' "$stderr_file"
    fi
  else
    summary_line "- ${label}: UNAVAILABLE (IAM/API)"
    printf '[FinOpsInventory] %s indisponible.\n' "$label"
    if [[ -s "$stderr_file" ]]; then
      sed 's/^/[FinOpsInventory] /' "$stderr_file"
    fi
  fi

  rm -f "$stderr_file"
}

summary_line "## Inventaire FinOps GCP"
summary_line ""
summary_line "Projet: ${PROJECT_ID}; région runtime: ${REGION}."

probe_json \
  "Firestore databases" \
  '[.[] | {database:(.name | split("/")[-1]), locationId, type, deleteProtectionState, pointInTimeRecoveryEnablement}]' \
  gcloud firestore databases list --project "$PROJECT_ID"

probe_json \
  "Firebase Storage bucket metadata" \
  '{name, location, storageClass, versioning, softDeletePolicy}' \
  gcloud storage buckets describe "gs://${FIREBASE_BUCKET}"

if bucket_size="$(gcloud storage du --summarize --readable-sizes "gs://${FIREBASE_BUCKET}" 2>&1)"; then
  summary_line "- Firebase Storage bucket size: OK"
  printf '[FinOpsInventory] Firebase Storage size: %s\n' "$bucket_size"
else
  summary_line "- Firebase Storage bucket size: UNAVAILABLE (IAM/API)"
fi

probe_json \
  "Cloud SQL instances" \
  '[.[] | {name, region, databaseVersion, state}]' \
  gcloud sql instances list --project "$PROJECT_ID"

probe_json \
  "Artifact Registry packages after cleanup" \
  '[.[] | {name}]' \
  gcloud artifacts packages list --project "$PROJECT_ID" --repository "$ARTIFACT_REPOSITORY" --location "$REGION"

probe_json \
  "Cloud Run service" \
  '{name:.metadata.name, region:.metadata.labels["cloud.googleapis.com/location"], minScale:.spec.template.metadata.annotations["autoscaling.knative.dev/minScale"], maxScale:.spec.template.metadata.annotations["autoscaling.knative.dev/maxScale"], cpuThrottling:.spec.template.metadata.annotations["run.googleapis.com/cpu-throttling"], vpcConnector:.spec.template.metadata.annotations["run.googleapis.com/vpc-access-connector"], directVpc:.spec.template.metadata.annotations["run.googleapis.com/network-interfaces"]}' \
  gcloud run services describe "$SERVICE" --project "$PROJECT_ID" --region "$REGION"

if source_size="$(gcloud storage du --summarize --readable-sizes "gs://${CLOUDBUILD_SOURCE_BUCKET}/source" 2>&1)"; then
  summary_line "- Cloud Build source archive size after cleanup: OK"
  printf '[FinOpsInventory] Cloud Build source size: %s\n' "$source_size"
else
  summary_line "- Cloud Build source archive size after cleanup: empty or unavailable"
fi

summary_line ""
summary_line "Les lignes UNAVAILABLE signalent uniquement une limite de lecture IAM/API ; elles ne bloquent pas le déploiement."
