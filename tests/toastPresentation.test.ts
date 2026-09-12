import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isDownloadToastPresentation } from '../src/features/toasts/toastPresentation.ts';

const toastSource = readFileSync(new URL('../src/components/ToastContainer.tsx', import.meta.url), 'utf8');

test('un toast Explorer contenant recherche reste un toast info', () => {
  assert.equal(
    isDownloadToastPresentation('info', 'Filtres et recherche réinitialisés'),
    false,
  );
});

test('un toast explicitement download reste un toast téléchargement', () => {
  assert.equal(isDownloadToastPresentation('download', 'Recherche en cours'), true);
});

test('un message qui parle réellement de téléchargement conserve la présentation download', () => {
  assert.equal(isDownloadToastPresentation('success', 'Téléchargement lancé.'), true);
});

test('les toasts restent au-dessus de la safe area avec un léger écart supplémentaire', () => {
  assert.match(
    toastSource,
    /bottom-\[calc\(5\.5rem\+env\(safe-area-inset-bottom,0px\)\)\]/,
  );
});
