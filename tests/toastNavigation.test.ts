import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolveToastMediaNavigationTarget } from '../src/features/toasts/toastNavigation.ts';

const toastSource = readFileSync(new URL('../src/components/ToastContainer.tsx', import.meta.url), 'utf8');

const show = {
  id: 'firestore-show-id',
  tmdbId: 66732,
  mediaType: 'tv' as const,
};

test('les toasts À voir et Vu résolvent la cible exacte TMDB', () => {
  assert.deepEqual(resolveToastMediaNavigationTarget({ type: 'follow', show: show as any }), {
    showId: 'firestore-show-id',
    tmdbId: 66732,
    mediaType: 'tv',
  });
  assert.deepEqual(resolveToastMediaNavigationTarget({ type: 'success', show: show as any }), {
    showId: 'firestore-show-id',
    tmdbId: 66732,
    mediaType: 'tv',
  });
});

test('un toast de retrait ne navigue jamais, même avec une fiche associée', () => {
  assert.equal(resolveToastMediaNavigationTarget({ type: 'unfollow', show: show as any }), null);
});

test('aucune navigation n’est fabriquée sans identité TMDB valide', () => {
  assert.equal(resolveToastMediaNavigationTarget({ type: 'success', show: { ...show, tmdbId: 0 } as any }), null);
  assert.equal(resolveToastMediaNavigationTarget({ type: 'success', show: undefined }), null);
});

test('le conteneur protège navigation clavier, actions secondaires et drag', () => {
  assert.match(toastSource, /role=\{navigationTarget \? 'button' : undefined\}/);
  assert.match(toastSource, /tabIndex=\{navigationTarget \? 0 : undefined\}/);
  assert.match(toastSource, /e\.key === 'Enter' \|\| e\.key === ' '/);
  assert.match(toastSource, /e\.target !== e\.currentTarget/);
  assert.match(toastSource, /didDragRef\.current = true/);
  assert.match(toastSource, /e\.stopPropagation\(\)/);
});
