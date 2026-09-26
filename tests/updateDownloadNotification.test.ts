import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { getVerifiedUpdateDownloadNotification } from '../src/features/release/updateDownloadNotification.ts';

const updater = readFileSync('src/services/appUpdater.ts', 'utf8');
const helper = readFileSync('src/features/release/updateDownloadNotification.ts', 'utf8');

test('SEENIT-UPDATE-007 notifie seulement après les contrôles de l’APK et avant PackageInstaller', () => {
  const statIndex = updater.indexOf('Filesystem.stat');
  const digestIndex = updater.indexOf('calculateCachedApkSha256(fileName)');
  const notificationIndex = updater.indexOf('notifyVerifiedUpdateDownload(release.version)');
  const installIndex = updater.indexOf('SeenItUpdate.installApk');
  assert.ok(statIndex >= 0);
  assert.ok(digestIndex > statIndex);
  assert.ok(notificationIndex > digestIndex);
  assert.ok(installIndex > notificationIndex);

  const presentation = getVerifiedUpdateDownloadNotification('1.4.199');
  assert.equal(presentation.title, 'Mise à jour téléchargée ✅');
  assert.match(presentation.body, /1\.4\.199/);
  assert.equal(
    getVerifiedUpdateDownloadNotification('1.4.199').id,
    getVerifiedUpdateDownloadNotification('1.4.199').id
  );
});

test('SEENIT-UPDATE-007 garde la notification non bloquante', () => {
  assert.ok(helper.includes('LocalNotifications.checkPermissions'));
  assert.ok(helper.includes('LocalNotifications.schedule'));
  assert.ok(helper.includes('catch {'));
  assert.ok(helper.includes('Le feedback de notification ne doit jamais bloquer'));
});
