import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/build-apk.yml', 'utf8');
const agentRules = readFileSync('AGENTS.md', 'utf8');
const specificationGuide = readFileSync('docs/specifications/README.md', 'utf8');
const auditIndex = readFileSync('docs/audits/README.md', 'utf8');
const globalAudit = readFileSync('docs/audits/audit-global-2026-08-31.md', 'utf8');
const requestRegistry = readFileSync('docs/requests/registry.md', 'utf8');
const issueTemplate = readFileSync('.github/ISSUE_TEMPLATE/engineering.yml', 'utf8');
const deliveryClassifier = readFileSync('scripts/classify-delivery.cjs', 'utf8');
const deliveryProcess = readFileSync('docs/process/delivery.md', 'utf8');

test('SEENIT-RELEASE-002 la CI valide puis publie sans modifier automatiquement main', () => {
  assert.doesNotMatch(workflow, /git\s+(commit|push)/);
  assert.match(workflow, /^\s{2}validate:/m);
  assert.match(workflow, /Validate Specification Integrity/);
  assert.match(workflow, /TypeScript Check/);
  assert.match(workflow, /Unit Tests/);
  assert.match(workflow, /npm run test:spec:changes/);
  assert.match(workflow, /cache: npm/);
  assert.match(workflow, /release_apk:/);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch'/);
  assert.match(workflow, /^\s{2}build:/m);
  assert.match(workflow, /\.\/gradlew --no-daemon :app:assembleDebug :app:assembleDebugAndroidTest/);
  assert.doesNotMatch(workflow, /\.\/gradlew\s+--no-daemon\s+assembleDebug\s+assembleDebugAndroidTest/);
  assert.doesNotMatch(workflow, /gradle-version:/);
  assert.match(workflow, /sha256sum "SeenIt-v\$\{VERSION\}\.apk"/);
  assert.match(workflow, /Production Dependency Audit[\s\S]*DEPENDENCIES_CHANGED/);
  assert.match(deliveryProcess, /push.*ne publie.*APK/is);
  assert.match(agentRules, /Fast path prioritaire.*publication APK seule/is);
  assert.match(agentRules, /release:status/);
  assert.match(agentRules, /release:prepare/);
  assert.match(agentRules, /release:dispatch/);
  assert.match(deliveryProcess, /Fast path de publication APK/);
  assert.match(deliveryProcess, /gh workflow run build-apk\.yml/);
  assert.match(deliveryProcess, /demande.*workflow/is);
});

test('SEENIT-APK-004 exécute le contrat Android avant le garde de release', () => {
  const contractIndex = workflow.indexOf('Android Contract for APK-impacting Changes');
  const releaseGuardIndex = workflow.indexOf('Validate Unpublished Release Version');
  assert.ok(contractIndex >= 0, 'le contrat Android doit exister dans la validation');
  assert.ok(releaseGuardIndex > contractIndex, 'le contrat Android doit précéder le garde de release');
});

test('SEENIT-APK-001 matérialise la clé release avant les tests de release et Gradle', () => {
  const materializeIndex = workflow.indexOf('Materialize SeenIt Release Keystore');
  const releaseTestsIndex = workflow.indexOf('Release Automated Tests');
  const gradleIndex = workflow.indexOf('./gradlew --no-daemon');

  assert.ok(materializeIndex >= 0, 'la release doit matérialiser le keystore release');
  assert.ok(releaseTestsIndex > materializeIndex, 'le keystore doit exister avant le contrat Android de release');
  assert.ok(gradleIndex > materializeIndex, 'le keystore doit exister avant Gradle');
  assert.match(workflow, /SEENIT_ANDROID_RELEASE_KEYSTORE_B64:\s*\$\{\{ secrets\.SEENIT_ANDROID_RELEASE_KEYSTORE_B64 \}\}/);
  assert.match(workflow, /SEENIT_ANDROID_RELEASE_STORE_PASSWORD:\s*\$\{\{ secrets\.SEENIT_ANDROID_RELEASE_STORE_PASSWORD \}\}/);
  assert.match(workflow, /SEENIT_ANDROID_RELEASE_KEY_PASSWORD:\s*\$\{\{ secrets\.SEENIT_ANDROID_RELEASE_KEY_PASSWORD \}\}/);
  assert.match(workflow, /SEENIT_REQUIRE_ANDROID_KEYSTORE:\s*['"]true['"]/);
});

test('SEENIT-APK-004 restaure le droit d’exécution Gradle avant le build', () => {
  const permissionIndex = workflow.indexOf('chmod +x android/gradlew');
  const gradleIndex = workflow.indexOf('./gradlew --no-daemon');
  assert.ok(permissionIndex >= 0, 'la CI doit rendre gradlew exécutable');
  assert.ok(gradleIndex > permissionIndex, 'le droit d’exécution doit être restauré avant Gradle');
});

test('SEENIT-QUALITY-001 les règles imposent SPEC, tests et validation APK à chaque évolution', () => {
  assert.match(agentRules, /SPEC avant code/);
  assert.match(agentRules, /Contrat APK immuable/);
  assert.match(agentRules, /npm run test:android/);
  assert.match(agentRules, /zones sensibles/);
  assert.match(agentRules, /test automatisé/);
});

test('SEENIT-QUALITY-002 impose un audit daté relié à des issues priorisées', () => {
  assert.match(agentRules, /Tout audit doit être enregistré/);
  assert.match(agentRules, /issue GitHub priorisée/);
  assert.match(specificationGuide, /protocole de.*audits\/README\.md/s);
  assert.match(auditIndex, /AUDIT-2026-08-31-GLOBAL/);
  assert.match(globalAudit, /Matrice exhaustive des constats/);
  for (let issue = 9; issue <= 19; issue += 1) {
    assert.match(globalAudit, new RegExp(`issues/${issue}`));
  }
  assert.match(issueTemplate, /id: source/);

  for (const file of readdirSync('docs/audits').filter(name => /^audit-.+\.md$/.test(name))) {
    const audit = readFileSync(`docs/audits/${file}`, 'utf8');
    assert.match(audit, /Identifiant/);
    assert.match(audit, /commit/i);
    assert.match(audit, /Périmètre/);
    assert.match(audit, /preuves/i);
    assert.match(audit, /Matrice exhaustive/);
    assert.match(auditIndex, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('SEENIT-QUALITY-003 mémorise chaque demande durable dans la SPEC et le registre', () => {
  assert.match(agentRules, /Demande durable/);
  assert.match(agentRules, /docs\/requests\/registry\.md/);
  assert.match(specificationGuide, /qualifier la demande/i);
  assert.match(requestRegistry, /USR-2026-08-31-003/);
  assert.match(requestRegistry, /SEENIT-QUALITY-002/);
  assert.match(requestRegistry, /SEENIT-QUALITY-003/);
});

test('SEENIT-QUALITY-006 réserve le pipeline APK aux changements qui le nécessitent', () => {
  assert.match(workflow, /Classify Delivery Path/);
  assert.match(workflow, /delivery:classify/);
  assert.match(workflow, /DELIVERY_MODE == 'apk'/);
  assert.match(workflow, /release_apk == true/);
  assert.match(workflow, /android12_smoke:/);
  assert.match(workflow, /api-level: 36/);
  assert.match(workflow, /api-level: 31/);
  assert.match(deliveryClassifier, /mode = 'backend'/);
  assert.match(deliveryClassifier, /server\.ts/);
  assert.match(deliveryClassifier, /Le doute conserve la classe APK/);
  assert.match(agentRules, /interdit de forcer le mode light/);
  assert.match(agentRules, /version.*une seule fois/is);
  assert.match(requestRegistry, /USR-2026-09-01-003/);
});

test('SEENIT-QUALITY-009 borne le fast path des correctifs ciblés sans réduire les preuves', () => {
  assert.match(agentRules, /Fast path prioritaire — correctif ciblé/);
  assert.match(agentRules, /SPEC avant code.*ordre de travail.*pas une obligation de commit/is);
  assert.match(agentRules, /tests ciblés.*une seule fois la validation complète/is);
  assert.match(agentRules, /GitHub Actions confirme un\s+état local vert.*ne sert pas de debugger/is);
  assert.match(agentRules, /Après dix minutes sans fichier modifié, test ciblé exécuté, commit, PR ou blocage précis/is);
  assert.match(agentRules, /ne réduit aucun contrôle de sécurité.*test terrain.*release/is);
  assert.match(deliveryProcess, /Fast path de correctif ciblé/);
  assert.match(deliveryProcess, /un commit cohérent et une PR/);
  assert.match(requestRegistry, /USR-2026-09-05-005/);
});
