#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="gen-lang-client-0201895414"
PROJECT_NUMBER="799043440232"
REGION="us-west1"
SERVICE="seenit-app"
POOL_ID="seenit-github"
PROVIDER_ID="seenit-main"
REPOSITORY_ID="1338192018"
DEPLOY_SA_NAME="seenit-github-deployer"
DEPLOY_SA="${DEPLOY_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

printf 'Configuration du déploiement backend SeenIt dans %s...\n' "$PROJECT_ID"
gcloud config set project "$PROJECT_ID" >/dev/null

gcloud services enable \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com

if ! gcloud iam service-accounts describe "$DEPLOY_SA" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$DEPLOY_SA_NAME" \
    --display-name="SeenIt GitHub backend deployer"
fi

for role in roles/run.sourceDeveloper roles/serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${DEPLOY_SA}" \
    --role="$role" \
    --condition=None \
    --quiet >/dev/null
done

RUNTIME_SA="$(gcloud run services describe "$SERVICE" \
  --region "$REGION" \
  --format='value(spec.template.spec.serviceAccountName)')"
if [[ -z "$RUNTIME_SA" ]]; then
  RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
fi

gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --member="serviceAccount:${DEPLOY_SA}" \
  --role="roles/iam.serviceAccountUser" \
  --quiet >/dev/null

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/run.builder" \
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

gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/attribute.repository_id/${REPOSITORY_ID}" \
  --quiet >/dev/null

printf '\nConfiguration terminée.\n'
printf 'Provider: projects/%s/locations/global/workloadIdentityPools/%s/providers/%s\n' "$PROJECT_NUMBER" "$POOL_ID" "$PROVIDER_ID"
printf 'Service account: %s\n' "$DEPLOY_SA"
printf 'Le workflow GitHub peut maintenant être rejoué sans clé JSON durable.\n'
