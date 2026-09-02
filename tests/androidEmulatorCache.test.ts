import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/build-apk.yml', 'utf8');

test('la release réutilise un snapshot Android 36 au lieu de recréer l’émulateur', () => {
  assert.match(workflow, /Restore Android 36 AVD Snapshot/);
  assert.match(workflow, /actions\/cache@v5/);
  assert.match(workflow, /~\/\.android\/avd\/\*/);
  assert.match(workflow, /~\/\.android\/adb\*/);
  assert.match(workflow, /Create Android 36 AVD Snapshot[\s\S]*cache-hit != 'true'/);
  assert.match(workflow, /Run N to N\+1 Upgrade Smoke[\s\S]*force-avd-creation: false/);
  assert.match(workflow, /Run N to N\+1 Upgrade Smoke[\s\S]*-no-snapshot-save/);
});
