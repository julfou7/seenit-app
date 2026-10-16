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
  assert.match(workflow, /jsonPayload\.seenitEvent\.schemaVersion=1/);
  assert.match(workflow, /jsonPayload\.seenitDiagnostic\.code="TMDB_REQUEST_CACHE_SUMMARY"/);
  assert.match(workflow, /summarize-tmdb-cache-diagnostics\.cjs/);
  assert.match(workflow, /log_id\("run\.googleapis\.com\/requests"\)/);
  assert.match(workflow, /summarize-cloud-run-traffic\.cjs/);
  assert.match(workflow, /seenit-cloud-run-traffic-\$\{\{ github\.run_id \}\}/);
  assert.match(workflow, /retention-days: 40/);
  assert.match(workflow, /seenit-tmdb-cache-baseline-\$\{\{ github\.run_id \}\}/);
  assert.match(workflow, /push:[\s\S]*branches:[\s\S]*main[\s\S]*summarize-tmdb-cache-diagnostics\.cjs/);
  assert.match(workflow, /--limit=5000/);
  assert.match(workflow, /--limit=10000/);
  assert.match(workflow, /scripts\/audit-structured-logs\.cjs/);
  assert.match(workflow, /src\/features\/runtime\/operationalEvent\.ts/);
  assert.match(workflow, /src\/features\/runtime\/backendRuntime\.ts/);
  assert.match(workflow, /server\.ts/);
  assert.match(workflow, /src\/features\/providers\/mediaProviderBackendCore\.ts/);
  assert.match(workflow, /src\/features\/logging\/clientOperationalSignals\.ts/);
  assert.match(workflow, /src\/features\/logging\/clientOperationalDiagnostics\.ts/);
  assert.match(workflow, /src\/services\/appUpdater\.ts/);
  assert.match(workflow, /scripts\/report-log-auditor-health\.cjs/);
  assert.match(workflow, /Report auditor health to GitHub/);
  assert.match(workflow, /SEENIT_AUDITOR_STRUCTURED_SOURCE_STATUS/);
  assert.match(workflow, /SEENIT_AUDITOR_TMDB_SOURCE_STATUS/);
  assert.match(workflow, /SEENIT_AUDITOR_TRAFFIC_SOURCE_STATUS/);
  assert.match(workflow, /SEENIT_AUDITOR_TRAFFIC_SUMMARY_OUTCOME/);
  assert.match(workflow, /steps\.health_watchdog\.outcome == 'failure'/);
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
  assert.match(processDoc, /fenêtre temporelle explicite/);
  assert.match(processDoc, /stale/);
  assert.match(processDoc, /10 000/);
});

test('SEENIT-OBSERVABILITY-001 borne les lectures Cloud Logging par timestamps explicites', () => {
  assert.doesNotMatch(workflow, /--freshness=/);
  assert.equal((workflow.match(/timestamp>=/g) || []).length, 3);
  assert.equal((workflow.match(/timestamp<=/g) || []).length, 3);
  assert.equal((workflow.match(/--order=desc/g) || []).length, 3);
  assert.match(workflow, /date -u -d '12 hours ago'/);
  assert.equal((workflow.match(/date -u -d '6 hours ago'/g) || []).length, 2);
  assert.match(workflow, /echo "window_start=\$window_start" >> "\$GITHUB_OUTPUT"/);
  assert.match(workflow, /echo "window_end=\$window_end" >> "\$GITHUB_OUTPUT"/);
  assert.match(workflow, /SEENIT_CLOUD_RUN_TRAFFIC_WINDOW_START: \$\{\{ steps\.collect_cloud_run_traffic\.outputs\.window_start \}\}/);
  assert.match(workflow, /SEENIT_CLOUD_RUN_TRAFFIC_WINDOW_END: \$\{\{ steps\.collect_cloud_run_traffic\.outputs\.window_end \}\}/);
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
