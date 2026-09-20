import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const nativePatchSource = readFileSync('scripts/patch-local-notifications.cjs', 'utf8').replace(/\r\n/g, '\n');

test('issue #443 conserve l’affiche complète et supprime le doublon visuel Android', () => {
  assert.match(
    nativePatchSource,
    /fitSeenItBitmapInside\(/,
    'le patch natif doit adapter le bitmap dans son cadre sans crop',
  );
  assert.match(
    nativePatchSource,
    /Math\.min\(targetWidth\.toFloat\(\) \/ source\.width, targetHeight\.toFloat\(\) \/ source\.height\)/,
    'le redimensionnement doit utiliser un contain explicite et conserver le ratio',
  );
  assert.match(
    nativePatchSource,
    /\.bigLargeIcon\(null\)/,
    'BigPicture doit masquer le largeIcon dupliqué quand l’affiche riche est visible',
  );
  assert.doesNotMatch(
    nativePatchSource,
    /Bitmap\.createScaledBitmap\([^\n]+targetWidth[^\n]+targetHeight/,
    'l’affiche ne doit jamais être étirée directement aux dimensions du cadre',
  );
});
