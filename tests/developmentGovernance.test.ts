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

test('SEENIT-RELEASE-002 la CI valide puis publie sans modifier automatiquement main', () => {
  assert.doesNotMatch(workflow, /git\s+(commit|push)/);
  assert.match(workflow, /npm run test:spec:changes/);
  assert.match(workflow, /npm run test:android/);
  assert.match(workflow, /npx cap sync android[\s\S]+npm run test:android/);
  assert.match(workflow, /\.\/gradlew --no-daemon :app:assembleDebug :app:assembleDebugAndroidTest/);
  assert.doesNotMatch(workflow, /\.\/gradlew\s+--no-daemon\s+assembleDebug\s+assembleDebugAndroidTest/);
  assert.doesNotMatch(workflow, /gradle-version:/);
  assert.match(workflow, /sha256sum "SeenIt-v\$\{VERSION\}\.apk"/);
});

test('SEENIT-APK-004 exécute le contrat Android avant le garde de release', () => {
  const contractIndex = workflow.indexOf('Specifications, Android Contract & Automated Tests');
  const releaseGuardIndex = workflow.indexOf('Validate Unpublished Release Version');
  assert.ok(contractIndex >= 0, 'le contrat Android doit exister dans la CI');
  assert.ok(releaseGuardIndex > contractIndex, 'le contrat Android doit précéder le garde de release');
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
  assert.match(specificationGuide, /qualifier la demande/);
  assert.match(requestRegistry, /USR-2026-08-31-003/);
  assert.match(requestRegistry, /SEENIT-QUALITY-002/);
  assert.match(requestRegistry, /SEENIT-QUALITY-003/);
});

test('SEENIT-QUALITY-006 réserve le pipeline APK aux changements qui le nécessitent', () => {
  assert.match(workflow, /Classify Delivery Path/);
  assert.match(workflow, /delivery:classify/);
  assert.match(workflow, /if: steps\.delivery\.outputs\.DELIVERY_MODE == 'apk'[\s\S]+npx cap sync android/);
  assert.match(workflow, /if: needs\.build\.outputs\.delivery_mode == 'apk'/);
  assert.match(workflow, /FORCED_DELIVERY_MODE/);
  assert.doesNotMatch(workflow, /options:\s*[\s\S]*- light/);
  assert.match(deliveryClassifier, /Le parcours léger est refusé par sécurité/);
  assert.match(agentRules, /interdit de forcer le mode light/);
  assert.match(requestRegistry, /USR-2026-09-01-003/);
});
