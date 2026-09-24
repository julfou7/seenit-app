import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const updater = readFileSync('src/services/appUpdater.ts', 'utf8');
const nativePlugin = readFileSync(
  'android/app/src/main/java/com/seenit/app/SeenItUpdatePlugin.kt',
  'utf8'
);
const handoffActivity = readFileSync(
  'android/app/src/main/java/com/seenit/app/UpdateInstallActivity.kt',
  'utf8'
);
const mainActivity = readFileSync(
  'android/app/src/main/java/com/seenit/app/MainActivity.java',
  'utf8'
);
const manifest = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
const styles = readFileSync('android/app/src/main/res/values/styles.xml', 'utf8');
const specification = readFileSync('docs/specifications/seenit.md', 'utf8');

test("SEENIT-UPDATE-006 utilise PackageInstaller.Session au lieu d'abandonner la reprise à FileOpener", () => {
  assert.ok(specification.includes('SEENIT-UPDATE-006'));
  assert.ok(specification.includes('PackageInstaller.Session'));
  assert.ok(updater.includes("registerPlugin<SeenItUpdateNativePlugin>('SeenItUpdate')"));
  assert.ok(updater.includes('SeenItUpdate.installApk({ filePath: targetPath })'));
  assert.ok(!updater.includes('FileOpener.open'));
  assert.ok(nativePlugin.includes('PackageInstaller.SessionParams'));
  assert.ok(nativePlugin.includes('session.commit(statusPendingIntent.intentSender)'));
  assert.ok(nativePlugin.includes('PendingIntent.getActivity'));
});

test('SEENIT-UPDATE-006 traite la confirmation système puis relance SeenIt sur succès', () => {
  assert.ok(handoffActivity.includes('PackageInstaller.STATUS_PENDING_USER_ACTION'));
  assert.ok(handoffActivity.includes('PackageInstaller.STATUS_SUCCESS'));
  assert.ok(handoffActivity.includes('Intent.EXTRA_INTENT'));
  assert.ok(handoffActivity.includes('getLaunchIntentForPackage(packageName)'));
  assert.ok(nativePlugin.includes('FLAG_MUTABLE'));
  assert.ok(nativePlugin.includes('setPendingIntentCreatorBackgroundActivityStartMode'));
  assert.ok(nativePlugin.includes('MODE_BACKGROUND_ACTIVITY_START_ALLOW_ALWAYS'));
});

test('SEENIT-UPDATE-006 garde le handoff interne non exporté et sans receiver de relance', () => {
  assert.ok(mainActivity.includes('registerPlugin(SeenItUpdatePlugin.class);'));
  assert.ok(manifest.includes('android:name=".UpdateInstallActivity"'));
  assert.ok(manifest.includes('android:exported="false"'));
  assert.ok(manifest.includes('android:noHistory="true"'));
  assert.ok(manifest.includes('android:theme="@style/AppTheme.UpdateHandoff"'));
  assert.ok(styles.includes('<style name="AppTheme.UpdateHandoff"'));
  assert.ok(!manifest.includes('android.intent.action.MY_PACKAGE_REPLACED'));
});
