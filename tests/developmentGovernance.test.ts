import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/build-apk.yml', 'utf8');
const agentRules = readFileSync('AGENTS.md', 'utf8');

test('SEENIT-RELEASE-002 la CI valide puis publie sans modifier automatiquement main', () => {
  assert.doesNotMatch(workflow, /git\s+(commit|push)/);
  assert.match(workflow, /npm run test:spec:changes/);
  assert.match(workflow, /npm run test:android/);
  assert.match(workflow, /npx cap sync android[\s\S]+npm run test:android/);
  assert.match(workflow, /\.\/gradlew --no-daemon assembleDebug/);
  assert.match(workflow, /sha256sum "SeenIt-v\$\{VERSION\}\.apk"/);
});

test('SEENIT-QUALITY-001 les règles imposent SPEC, tests et validation APK à chaque évolution', () => {
  assert.match(agentRules, /SPEC avant code/);
  assert.match(agentRules, /Contrat APK immuable/);
  assert.match(agentRules, /npm run test:android/);
});
