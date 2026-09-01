import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/build-apk.yml', 'utf8');
const agentRules = readFileSync('AGENTS.md', 'utf8');
const livingSpecification = readFileSync('docs/specifications/seenit.md', 'utf8');
const specificationGuide = readFileSync('docs/specifications/README.md', 'utf8');
const auditIndex = readFileSync('docs/audits/README.md', 'utf8');
const globalAudit = readFileSync('docs/audits/audit-global-2026-08-31.md', 'utf8');
const requestRegistry = readFileSync('docs/requests/registry.md', 'utf8');
const issueTemplate = readFileSync('.github/ISSUE_TEMPLATE/engineering.yml', 'utf8');

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

test('SEENIT-QUALITY-004 maintient les issues et leurs checkboxes à jour pendant le travail', () => {
  assert.match(agentRules, /Suivi continu des issues/);
  assert.match(agentRules, /Après chaque jalon[\s\S]+actualisez l'état/);
  assert.match(agentRules, /Cochez chaque checkbox[\s\S]+réellement prouvé/);
  assert.match(livingSpecification, /SEENIT-QUALITY-004/);
  assert.match(livingSpecification, /source[\s\S]+de vérité opérationnelle/);
  assert.match(livingSpecification, /chaque critère d'acceptation/);
  assert.match(specificationGuide, /checkboxes des critères sont[\s\S]+réellement satisfaites/);
  assert.match(requestRegistry, /USR-2026-09-01-001/);
  assert.match(requestRegistry, /SEENIT-QUALITY-004/);
});
