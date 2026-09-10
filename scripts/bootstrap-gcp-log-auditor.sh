#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="gen-lang-client-0201895414"
PROJECT_NUMBER="799043440232"
POOL_ID="seenit-github"
REPOSITORY_ID="1338192018"
AUDITOR_SA_NAME="seenit-log-auditor"
AUDITOR_SA="${AUDITOR_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

printf 'Configuration de la lecture bornée des logs SeenIt dans %s...\n' "$PROJECT_ID"

gcloud services enable \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  cloudresourcemanager.googleapis.com \
  logging.googleapis.com \
  --project="$PROJECT_ID"

if ! gcloud iam service-accounts describe "$AUDITOR_SA" \
  --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$AUDITOR_SA_NAME" \
    --project="$PROJECT_ID" \
    --display-name="SeenIt read-only log auditor"
fi

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${AUDITOR_SA}" \
  --role="roles/logging.viewer" \
  --condition=None \
  --quiet >/dev/null

gcloud iam service-accounts add-iam-policy-binding "$AUDITOR_SA" \
  --project="$PROJECT_ID" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/attribute.repository_id/${REPOSITORY_ID}" \
  --quiet >/dev/null

printf '\nConfiguration terminée.\n'
printf 'Service account read-only: %s\n' "$AUDITOR_SA"
printf 'Provider WIF canonique réutilisé: %s\n' "$POOL_ID"
printf 'Aucune clé JSON durable ni permission de déploiement n’a été ajoutée.\n'
