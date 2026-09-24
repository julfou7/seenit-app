import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/build-apk.yml', 'utf8');
const upgradeSmoke = readFileSync('scripts/android-upgrade-smoke.sh', 'utf8');
const upgradeInstrumentation = readFileSync(
  'android/app/src/androidTest/java/com/seenit/app/UpgradeContractInstrumentedTest.java',
  'utf8'
);

test('la release Android 36 repart d’un AVD propre et borne sa pression mémoire', () => {
  assert.doesNotMatch(workflow, /Restore Android 36 AVD Snapshot/);
  assert.doesNotMatch(workflow, /Create Android 36 AVD Snapshot/);
  assert.doesNotMatch(workflow, /seenit-avd-\$\{\{ runner\.os \}\}-36/);
  assert.doesNotMatch(workflow, /~\/\.android\/avd\/\*/);
  assert.doesNotMatch(workflow, /~\/\.android\/adb\*/);
  assert.match(workflow, /Run N to N\+1 Upgrade Smoke[\s\S]*ram-size: 2048M/);
  assert.match(workflow, /Run N to N\+1 Upgrade Smoke[\s\S]*force-avd-creation: true/);
  assert.doesNotMatch(workflow, /Run N to N\+1 Upgrade Smoke[\s\S]*-no-snapshot-save/);
  assert.match(workflow, /Capture Android 36 Host Diagnostics[\s\S]*free -m/);
  assert.match(workflow, /Capture Android 36 Host Diagnostics[\s\S]*dmesg --ctime/);
});


test('le smoke API 36 vérifie l’accessibilité via UiAutomation sans shell uiautomator', () => {
  assert.doesNotMatch(upgradeSmoke, /uiautomator\s+dump/);
  assert.match(upgradeSmoke, /UpgradeContractInstrumentedTest#verifyLoginAccessibility/);
  assert.match(upgradeSmoke, /SEENIT_ACCESSIBILITY_OK:/);
  assert.match(upgradeInstrumentation, /verifyLoginAccessibility\(\)/);
  assert.match(upgradeInstrumentation, /getUiAutomation\(\)/);
  assert.match(upgradeInstrumentation, /getRootInActiveWindow\(\)/);
  assert.match(upgradeInstrumentation, /findAccessibilityNodeInfosByText\("Continuer avec Google"\)/);
  assert.match(upgradeInstrumentation, /isClickable\(\)/);
  assert.match(upgradeInstrumentation, /SystemClock\.elapsedRealtime\(\) \+ 15_000L/);
});
