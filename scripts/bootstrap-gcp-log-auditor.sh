#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="gen-lang-client-0201895414"
PROJECT_NUMBER="799043440232"
POOL_ID="seenit-github"
PROVIDER_ID="seenit-main"
REPOSITORY_ID="1338192018"
AUDITOR_SA_NAME="seenit-log-auditor"
AUDITOR_SA="${AUDITOR_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

printf 'Configuration de la lecture bornée des logs SeenIt dans %s...\n' "$PROJECT_ID"
gcloud config set project "$PROJECT_ID" >/dev/null

gcloud services enable \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  cloudresourcemanager.googleapis.com \
  logging.googleapis.com

if ! gcloud iam service-accounts describe "$AUDITOR_SA" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$AUDITOR_SA_NAME" \
    --display-name="SeenIt read-only log auditor"
fi

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${AUDITOR_SA}" \
  --role="roles/logging.viewer" \
  --condition=None \
  --quiet >/dev/null

if ! gcloud iam workload-identity-pools describe "$POOL_ID" \
  --location=global >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$POOL_ID" \
    --location=global \
    --display-name="SeenIt GitHub Actions"
fi

if ! gcloud iam workload-identity-pools providers describe "$PROVIDER_ID" \
  --workload-identity-pool="$POOL_ID" \
  --location=global >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" \
    --workload-identity-pool="$POOL_ID" \
    --location=global \
    --display-name="SeenIt main" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.ref=assertion.ref" \
    --attribute-condition="assertion.repository_id=='${REPOSITORY_ID}' && assertion.ref=='refs/heads/main'"
fi

gcloud iam service-accounts add-iam-policy-binding "$AUDITOR_SA" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/attribute.repository_id/${REPOSITORY_ID}" \
  --quiet >/dev/null

printf '\nConfiguration terminée.\n'
printf 'Service account read-only: %s\n' "$AUDITOR_SA"
printf 'Aucune clé JSON durable ni permission de déploiement n’a été ajoutée.\n'
