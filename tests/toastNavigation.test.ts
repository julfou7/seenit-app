import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Show } from '../src/types.ts';
import { resolveToastMediaNavigationTarget } from '../src/features/toasts/toastNavigation.ts';

const toastSource = readFileSync(new URL('../src/components/ToastContainer.tsx', import.meta.url), 'utf8');

const series = {
  id: 'firestore-series-id',
  tmdbId: 66732,
  mediaType: 'tv',
  title: 'Série test',
} as Show;

const movie = {
  id: 'firestore-movie-id',
  tmdbId: 550,
  mediaType: 'movie',
  title: 'Film test',
} as Show;

test('SEENIT-UX-006 les quatre toasts média À voir/Vu résolvent la cible exacte TMDB', () => {
  assert.deepEqual(resolveToastMediaNavigationTarget({ type: 'follow', show: movie }), {
    showId: 'firestore-movie-id',
    tmdbId: 550,
    mediaType: 'movie',
  });
  assert.deepEqual(resolveToastMediaNavigationTarget({ type: 'follow', show: series }), {
    showId: 'firestore-series-id',
    tmdbId: 66732,
    mediaType: 'tv',
  });
  assert.deepEqual(resolveToastMediaNavigationTarget({ type: 'success', show: movie }), {
    showId: 'firestore-movie-id',
    tmdbId: 550,
    mediaType: 'movie',
  });
  assert.deepEqual(resolveToastMediaNavigationTarget({ type: 'success', show: series }), {
    showId: 'firestore-series-id',
    tmdbId: 66732,
    mediaType: 'tv',
  });
});

test('SEENIT-UX-006 un toast de retrait ne navigue jamais, même avec une fiche associée', () => {
  assert.equal(resolveToastMediaNavigationTarget({ type: 'unfollow', show: series }), null);
});

test('SEENIT-UX-006 aucune navigation n’est fabriquée sans identité TMDB exacte', () => {
  assert.equal(resolveToastMediaNavigationTarget({ type: 'success', show: { ...series, tmdbId: 0 } }), null);
  assert.equal(resolveToastMediaNavigationTarget({ type: 'success', show: { ...series, mediaType: undefined } }), null);
  assert.equal(resolveToastMediaNavigationTarget({ type: 'success', show: undefined }), null);
});

test('SEENIT-UX-006 le conteneur protège navigation clavier, actions secondaires et drag', () => {
  assert.match(toastSource, /role=\{navigationTarget \? 'button' : undefined\}/);
  assert.match(toastSource, /tabIndex=\{navigationTarget \? 0 : undefined\}/);
  assert.match(toastSource, /e\.key === 'Enter' \|\| e\.key === ' '/);
  assert.match(toastSource, /e\.target !== e\.currentTarget/);
  assert.match(toastSource, /didDragRef\.current = true/);
  assert.match(toastSource, /e\.stopPropagation\(\)/);
});
