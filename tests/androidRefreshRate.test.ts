import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const activity = readFileSync('android/app/src/main/java/com/seenit/app/MainActivity.java', 'utf8');

test("SEENIT-APK-007 demande le mode d'affichage le plus rapide à résolution identique", () => {
  const method = activity.slice(activity.indexOf('private void requestHighestRefreshRate()'), activity.indexOf('private void configureSafeAreaInsets'));
  assert.ok(method.length > 0, 'méthode présente');
  assert.match(method, /display\.getSupportedModes\(\)/);
  assert.match(method, /mode\.getPhysicalWidth\(\) == current\.getPhysicalWidth\(\)\s*&& mode\.getPhysicalHeight\(\) == current\.getPhysicalHeight\(\)/, 'jamais de changement de résolution');
  assert.match(method, /mode\.getRefreshRate\(\) > best\.getRefreshRate\(\)/);
  assert.match(method, /params\.preferredDisplayModeId = best\.getModeId\(\);\s*getWindow\(\)\.setAttributes\(params\);/);
  assert.match(method, /if \(params\.preferredDisplayModeId == best\.getModeId\(\)\) return;/, 'aucune réécriture inutile des attributs');
  assert.match(method, /catch \(Exception e\)/, 'une erreur garde le taux système');
  assert.match(method, /Build\.VERSION\.SDK_INT >= Build\.VERSION_CODES\.R \? getDisplay\(\) : getWindowManager\(\)\.getDefaultDisplay\(\)/);

  // Appliqué à la création et à chaque reprise (écran pliable, écran externe).
  assert.match(activity, /super\.onCreate\(savedInstanceState\);\n\s*requestHighestRefreshRate\(\);/);
  assert.match(activity, /public void onResume\(\) \{\n\s*super\.onResume\(\);[\s\S]*?requestHighestRefreshRate\(\);/);
  assert.doesNotMatch(activity, /preferredRefreshRate\s*=|setFrameRate\(/, 'une seule préférence, par mode');
});
