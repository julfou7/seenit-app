import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { toastSwipeDismissDirection } from '../src/features/toasts/toastPresentation.ts';

test('SEENIT-UX-004 retour v1.4.300 : tout toast, Plex compris, se ferme en glissant vers le bas ou vers la droite', () => {
  assert.equal(toastSwipeDismissDirection(0, 30), 'down');
  assert.equal(toastSwipeDismissDirection(60, 0), 'right');
  assert.equal(toastSwipeDismissDirection(0, 5, 0, 400), 'down', 'un geste rapide suffit');
  assert.equal(toastSwipeDismissDirection(10, 0, 500, 0), 'right');
  assert.equal(toastSwipeDismissDirection(90, 30), 'right', 'l’axe dominant l’emporte');
  assert.equal(toastSwipeDismissDirection(0, -90), null, 'vers le haut : rien');
  assert.equal(toastSwipeDismissDirection(-140, 0), null, 'vers la gauche : rien');
  assert.equal(toastSwipeDismissDirection(15, 10), null, 'un effleurement reste un toucher');
  // Revue Codex #969 : un geste surtout vers le haut (ou la gauche) ne ferme pas, même avec une dérive vers la droite (ou le bas).
  assert.equal(toastSwipeDismissDirection(60, -150), null);
  assert.equal(toastSwipeDismissDirection(-150, 40), null);
  assert.equal(toastSwipeDismissDirection(30, -10, 0, -400), null);
  const toast = readFileSync(new URL('../src/components/ToastContainer.tsx', import.meta.url), 'utf8');
  // Glisser libre sur les deux axes, sans geste natif concurrent (touch-pan-x laissait la droite au navigateur).
  assert.match(toast, /\n\s+drag\n\s+dragDirectionLock\n/);
  assert.match(toast, /dragElastic=\{\{ top: 0\.05, bottom: 0\.8, left: 0\.05, right: 0\.8 \}\}/);
  assert.match(toast, /pointer-events-auto touch-none select-none/);
  assert.doesNotMatch(toast, /touch-pan-x|drag="y"/);
  assert.equal((toast.match(/toastSwipeDismissDirection\(/g) || []).length, 2, 'même règle pour motion et le repli tactile');
  assert.match(readFileSync(new URL('../scripts/navbar-browser-checks.cjs', import.meta.url), 'utf8'), /\[\[0,90,true\],\[140,0,true\],\[0,-90,false\],\[-140,0,false\],\[60,-150,false\]\]/);
});
