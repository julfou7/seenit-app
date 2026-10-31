import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const { assertPosterBounds, assertLoadMoreSpacing } = createRequire(import.meta.url)('../scripts/home-terrain227-browser-checks.cjs');

test('le contrôle de rendu refuse une affiche rognée même de deux pixels', () => {
  assert.doesNotThrow(() => assertPosterBounds([{ top: 102, clip: 100 }]));
  assert.throws(() => assertPosterBounds([{ top: 98, clip: 100 }]), /affiche rognée/);
  assert.throws(() => assertPosterBounds([]), /affiche rognée/);
});
test('le contrôle de rendu refuse Afficher plus éloigné des cartes et collé à la suite', () => {
  assert.doesNotThrow(() => assertLoadMoreSpacing({ above: 12, below: 28 }));
  assert.throws(() => assertLoadMoreSpacing({ above: 28, below: 10 }), /espaces Afficher plus/);
  assert.throws(() => assertLoadMoreSpacing({ above: 12, below: 12 }), /espaces Afficher plus/);
});
test('la validation navigateur canonique exécute ces contrôles sur les composants réels', () => {
  const smoke = readFileSync(new URL('../scripts/pwa-browser-smoke.cjs', import.meta.url), 'utf8');
  assert.match(smoke, /\['homeTerrain227', client => testTerrain227Harness\(client, root\)\]/);
});
