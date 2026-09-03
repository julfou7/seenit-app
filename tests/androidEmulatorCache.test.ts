import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/build-apk.yml', 'utf8');

test('la release Android 36 repart d’un AVD propre pour éviter les snapshots obsolètes', () => {
  assert.doesNotMatch(workflow, /Restore Android 36 AVD Snapshot/);
  assert.doesNotMatch(workflow, /Create Android 36 AVD Snapshot/);
  assert.doesNotMatch(workflow, /seenit-avd-\$\{\{ runner\.os \}\}-36/);
  assert.doesNotMatch(workflow, /~\/\.android\/avd\/\*/);
  assert.doesNotMatch(workflow, /~\/\.android\/adb\*/);
  assert.match(workflow, /Run N to N\+1 Upgrade Smoke[\s\S]*force-avd-creation: true/);
  assert.doesNotMatch(workflow, /Run N to N\+1 Upgrade Smoke[\s\S]*-no-snapshot-save/);
});
