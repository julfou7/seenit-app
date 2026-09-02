import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/build-apk.yml', 'utf8');
const deliveryProcess = readFileSync('docs/process/delivery.md', 'utf8');

function extractJob(name: string, nextName: string) {
  const start = workflow.indexOf(`  ${name}:`);
  const end = workflow.indexOf(`\n  ${nextName}:`, start + 1);
  assert.ok(start >= 0, `job ${name} absent`);
  assert.ok(end > start, `borne du job ${name} absente`);
  return workflow.slice(start, end);
}

test('la release manuelle ne paie pas deux fois la validation rapide', () => {
  const validate = extractJob('validate', 'build');
  const build = extractJob('build', 'android_upgrade_smoke');

  assert.match(
    validate,
    /if: github\.event_name != 'workflow_dispatch' \|\| inputs\.release_apk != true/,
    'le job de validation continue doit être sauté pour une vraie release manuelle'
  );
  assert.doesNotMatch(build, /needs:\s*validate/);

  assert.match(build, /Specification Change Contract/);
  assert.match(build, /npm run test:spec/);
  assert.match(build, /npm run lint/);
  assert.match(build, /npm run test:unit/);
  assert.match(build, /npm run test:android/);
  assert.match(build, /npm audit --omit=dev --audit-level=high/);
  assert.match(build, /npm run build/);
});

test('la simplification conserve le smoke Android 36 bloquant', () => {
  const smoke = extractJob('android_upgrade_smoke', 'android12_upgrade_smoke');
  const publish = workflow.slice(workflow.indexOf('  publish:'));

  assert.match(smoke, /api-level: 36/);
  assert.match(smoke, /android-upgrade-smoke\.sh/);
  assert.match(publish, /needs\.android_upgrade_smoke\.result == 'success'/);
  assert.match(deliveryProcess, /Android cible courant \(API 36 actuellement\) : \*\*bloquant\*\*/);
});

test('la release documente explicitement la suppression du doublon npm ci et build Web', () => {
  assert.match(deliveryProcess, /une seule fois sur le même runner/);
  assert.match(deliveryProcess, /npm ci.*build Web.*plus payés deux fois/is);
});
