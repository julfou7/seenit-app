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
  // Retour v1.4.300 : glisser vers le bas ou vers la droite ferme (règle unique, voir tests/toastSwipe.test.ts).
  assert.match(toastSource, /\n\s+drag\n\s+dragDirectionLock\n/);
  assert.match(toastSource, /toastSwipeDismissDirection\(info\.offset\.x, info\.offset\.y, info\.velocity\.x, info\.velocity\.y\)/);
  assert.match(toastSource, /touch-none/);
  assert.doesNotMatch(toastSource, /touch-pan-y|touch-pan-x/);
  assert.match(toastSource, /const direction = toastSwipeDismissDirection\(dx, dy\);/);
  assert.match(toastSource, /flex items-center gap-1\.5 shrink-0 ml-auto/);
});

// Retour terrain du 09/11 sur la v1.4.286 : « au clic sur le titre ou l'image du toast, je veux pouvoir rouvrir le film
// ou la série » — les toasts de Téléchargés, Programmés et de la fiche épisode déclarent leur fiche.
test('SEENIT-UX-006 un toast qui déclare sa fiche (identité TMDB exacte) l’ouvre, quel que soit son type', () => {
  for (const type of ['info', 'error', 'success'] as const) {
    assert.deepEqual(resolveToastMediaNavigationTarget({ type, message: { title: 'MobLand', action: 'N’est plus programmé.', media: { tmdbId: 247718, mediaType: 'tv' } } }), { showId: '', tmdbId: 247718, mediaType: 'tv' });
  }
  assert.deepEqual(resolveToastMediaNavigationTarget({ type: 'info', message: { action: 'Retiré de Radarr', media: { tmdbId: 4, mediaType: 'movie' } } }), { showId: '', tmdbId: 4, mediaType: 'movie' });
  assert.equal(resolveToastMediaNavigationTarget({ type: 'info', message: { action: 'x', media: { tmdbId: 0, mediaType: 'tv' } } }), null, 'identité invalide');
  assert.equal(resolveToastMediaNavigationTarget({ type: 'info', message: { action: 'x', media: null } }), null, 'sans fiche : pas cliquable');
  assert.equal(resolveToastMediaNavigationTarget({ type: 'unfollow', message: { action: 'Retiré d’À voir', media: { tmdbId: 4, mediaType: 'movie' } } }), null, 'un retrait d’À voir reste non navigable');
  assert.equal(resolveToastMediaNavigationTarget({ type: 'info', message: 'Texte seul' }), null);
  assert.match(readFileSync('src/components/RecentImportsRail.tsx', 'utf8'), /posterPath: item\.posterUrl \|\| null, media: toastMedia\(item\) \}, 'info'\);/, 'Téléchargés : affiche et fiche');
  assert.match(readFileSync('src/components/ProgrammedSection.tsx', 'utf8'), /'N’est plus programmé\.', posterPath, media \}, 'info'\);/, 'Programmés : affiche et fiche');
});
