import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/release-update-push.yml', 'utf8');
const notifyScript = readFileSync('scripts/notify-release-update.cjs', 'utf8');
const server = readFileSync('server.ts', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');

test('SEENIT-UPDATE-003 déclenche l’alerte seulement après un workflow de release réussi', () => {
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /Validate & Release SeenIt/);
  assert.match(workflow, /workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /workflow_run\.event == 'workflow_dispatch'/);
  assert.match(workflow, /workflow_run\.head_branch == 'main'/);
  assert.match(workflow, /RELEASE_RUN_ID: \$\{\{ github\.event\.workflow_run\.id \}\}/);
  assert.match(workflow, /RELEASE_HEAD_SHA: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
  assert.match(notifyScript, /const maxAttempts = 3/);
  assert.match(notifyScript, /https:\/\/seenit\.ai\.studio\/api\/releases\/notify/);
  assert.match(server, /app\.post\('\/api\/releases\/notify'/);
  assert.match(server, /processReleaseUpdateNotificationRequest/);
});

test('SEENIT-UPDATE-003 branche le clic Android sur le contrôle de mise à jour existant', () => {
  assert.match(app, /handleAppUpdateAvailablePush/);
  assert.match(app, /isAppUpdateAvailablePush/);
  assert.match(app, /useUpdateStore\.getState\(\)\.checkForUpdates/);
});
