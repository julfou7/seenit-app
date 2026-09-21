import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflow = fs.readFileSync('.github/workflows/audit-structured-logs.yml', 'utf8');
const bootstrap = fs.readFileSync('scripts/bootstrap-gcp-log-auditor.sh', 'utf8');
const deploymentBootstrap = fs.readFileSync('scripts/bootstrap-gcp-backend-deploy.sh', 'utf8');
const processDoc = fs.readFileSync('docs/process/log-auditor.md', 'utf8');

test('SEENIT-OBSERVABILITY-001 exécute un batch Cloud Run en dry-run désactivable', () => {
  assert.match(workflow, /cron: '23 \*\/6 \* \* \*'/);
  assert.match(workflow, /vars\.SEENIT_LOG_AUDITOR_MODE \|\| 'dry-run'/);
  assert.match(workflow, /env\.SEENIT_LOG_AUDITOR_MODE != 'off'/);
  assert.match(workflow, /jsonPayload\.seenitEvent\.schemaVersion=1[\s\S]*--freshness=12h/);
  assert.match(workflow, /jsonPayload\.seenitDiagnostic\.code="TMDB_REQUEST_CACHE_SUMMARY"/);
  assert.match(workflow, /summarize-tmdb-cache-diagnostics\.cjs/);
  assert.match(workflow, /log_id\("run\.googleapis\.com\/requests"\)/);
  assert.match(workflow, /summarize-cloud-run-traffic\.cjs/);
  assert.match(workflow, /seenit-cloud-run-traffic-\$\{\{ github\.run_id \}\}/);
  assert.match(workflow, /retention-days: 40/);
  assert.match(workflow, /seenit-tmdb-cache-baseline-\$\{\{ github\.run_id \}\}/);
  assert.match(workflow, /push:[\s\S]*branches:[\s\S]*main[\s\S]*summarize-tmdb-cache-diagnostics\.cjs/);
  assert.match(workflow, /--freshness=6h/);
  assert.match(workflow, /--limit=5000/);
  assert.match(workflow, /scripts\/audit-structured-logs\.cjs/);
  assert.match(workflow, /src\/features\/runtime\/operationalEvent\.ts/);
  assert.match(workflow, /src\/features\/runtime\/backendRuntime\.ts/);
  assert.match(workflow, /issues: write/);
  assert.match(workflow, /id: auth[\s\S]*continue-on-error: true/);
  assert.match(workflow, /id: gcloud[\s\S]*continue-on-error: true/);
  assert.match(workflow, /Remove temporary source logs/);
  assert.match(workflow, /path: \$\{\{ runner\.temp \}\}\/seenit-log-audit-report\.json/);
  assert.doesNotMatch(workflow, /path:.*seenit-structured-logs\.json/);
  assert.doesNotMatch(workflow, /path:.*seenit-tmdb-cache-diagnostics\.json/);
  assert.doesNotMatch(workflow, /path:.*seenit-cloud-run-traffic\.json/);
  assert.match(bootstrap, /roles\/logging\.viewer/);
  assert.match(bootstrap, /seenit-log-auditor/);
  assert.doesNotMatch(bootstrap, /roles\/run\.sourceDeveloper|roles\/run\.admin/);
  assert.doesNotMatch(deploymentBootstrap, /roles\/(?:viewer|logging\.viewer)/);
  assert.match(processDoc, /trois issues par run et trois issues/);
  assert.match(processDoc, /ne ferme jamais une issue/);
});

test('SEENIT-OBSERVABILITY-001 réutilise le provider WIF canonique sans le recréer', () => {
  assert.doesNotMatch(
    bootstrap,
    /gcloud iam workload-identity-pools(?: providers)? create/,
  );
  assert.match(bootstrap, /--project="\$PROJECT_ID"/);
  assert.match(
    bootstrap,
    /principalSet:\/\/iam\.googleapis\.com\/projects\/\$\{PROJECT_NUMBER\}\/locations\/global\/workloadIdentityPools\/\$\{POOL_ID\}\/attribute\.repository_id\/\$\{REPOSITORY_ID\}/,
  );
});
