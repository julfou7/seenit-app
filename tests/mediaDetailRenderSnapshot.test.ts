import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PUBLIC_METADATA_CACHE_MAX_ENTRY_BYTES } from '../src/features/shows/publicMetadataCache.ts';
import {
  MEDIA_DETAIL_RENDER_SCHEMA_VERSION,
  MEDIA_DETAIL_RENDER_MAX_CAST,
  MEDIA_DETAIL_RENDER_MAX_GENRES,
  MEDIA_DETAIL_RENDER_MAX_KEYWORDS,
  MEDIA_DETAIL_RENDER_MAX_LOGOS,
  createMediaDetailRenderSnapshot,
} from '../src/features/shows/mediaDetailRenderSnapshot.ts';

test('SEENIT-PERF-001 garde Catégories et Thèmes persistables même quand le détail complet dépasse 1 Mio', () => {
  const hugeDetails = {
    id: 1396,
    name: 'Breaking Bad',
    overview: 'Synopsis',
    poster_path: '/poster.jpg',
    backdrop_path: '/backdrop.jpg',
    genres: Array.from({ length: 80 }, (_, index) => ({ id: index + 1, name: `Genre ${index}` })),
    keywords: {
      results: Array.from({ length: 120 }, (_, index) => ({ id: index + 1, name: `Thème ${index}` })),
    },
    images: {
      logos: Array.from({ length: 40 }, (_, index) => ({ file_path: `/logo-${index}.png`, iso_639_1: 'fr' })),
      posters: Array.from({ length: 8_000 }, (_, index) => ({ file_path: `/poster-${index}-${'x'.repeat(180)}.jpg` })),
    },
    credits: {
      cast: Array.from({ length: 8_000 }, (_, index) => ({ id: index, name: `Acteur ${index} ${'x'.repeat(180)}` })),
    },
    aggregate_credits: {
      cast: Array.from({ length: 8_000 }, (_, index) => ({ id: index, name: `Acteur agrégé ${index} ${'x'.repeat(180)}` })),
    },
  };

  const fullBytes = new TextEncoder().encode(JSON.stringify(hugeDetails)).byteLength;
  assert.ok(fullBytes > PUBLIC_METADATA_CACHE_MAX_ENTRY_BYTES);

  const snapshot = createMediaDetailRenderSnapshot(hugeDetails, 'tv');
  assert.ok(snapshot);
  const snapshotBytes = new TextEncoder().encode(JSON.stringify(snapshot)).byteLength;
  assert.ok(snapshotBytes < PUBLIC_METADATA_CACHE_MAX_ENTRY_BYTES / 8);
  assert.equal(snapshot.genres.length, MEDIA_DETAIL_RENDER_MAX_GENRES);
  assert.equal(snapshot.keywords.results.length, MEDIA_DETAIL_RENDER_MAX_KEYWORDS);
  assert.equal(snapshot.images.logos.length, MEDIA_DETAIL_RENDER_MAX_LOGOS);
  assert.equal(snapshot.seenit_render_schema_version, MEDIA_DETAIL_RENDER_SCHEMA_VERSION);
  assert.equal(snapshot.aggregate_credits.cast.length, MEDIA_DETAIL_RENDER_MAX_CAST);
  assert.equal(snapshot.aggregate_credits.cast[0].name, 'Acteur agrégé 0 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
  assert.equal(snapshot.overview, 'Synopsis');
  assert.equal(snapshot.credits, undefined);
  assert.equal(snapshot.images.posters, undefined);
});

test('SEENIT-PERF-001 sert le snapshot Catégories et Thèmes avant le détail complet après restart', () => {
  const client = readFileSync('src/features/shows/tmdbClient.ts', 'utf8');
  const app = readFileSync('src/App.tsx', 'utf8');
  const wrapper = readFileSync('src/screens/ShowDetailScreen.tsx', 'utf8');
  const core = readFileSync('src/screens/ShowDetailScreenCore.tsx', 'utf8');

  assert.match(client, /detailRenderCache = new BoundedCache<string, any>\(80\)/);
  assert.match(client, /writePublicMetadataCache\('detail_render', cacheKey, snapshot/);
  assert.match(client, /readPublicMetadataCache<any>\('detail_render', cacheKey\)/);
  assert.match(client, /peekRenderableMediaDetails/);

  const openStart = app.indexOf('const openShowSmooth');
  const openEnd = app.indexOf('const openLocalMedia', openStart);
  const openSource = app.slice(openStart, openEnd);
  assert.match(openSource, /await import\('\.\/features\/shows\/tmdb'\)/);
  assert.match(openSource, /primeMediaRenderSnapshotFromPersistentCache/);
  assert.doesNotMatch(openSource, /Promise\.race|MEDIA_DETAIL_CACHE_PRIME_BUDGET_MS/);

  assert.match(wrapper, /peekRenderableMediaDetails/);
  assert.match(core, /const cachedInitialDetails = effectiveTmdbId \? tmdb\.peekRenderableMediaDetails/);
  assert.match(core, /const cachedDetails = tmdb\.peekRenderableMediaDetails/);
});


test('SEENIT-PERF-001 persiste un aperçu casting borné pour stabiliser les onglets', () => {
  const tvSnapshot = createMediaDetailRenderSnapshot({
    id: 93405,
    name: 'Lioness',
    aggregate_credits: {
      cast: Array.from({ length: 30 }, (_, index) => ({
        id: index + 1,
        name: `Acteur ${index + 1}`,
        profile_path: `/actor-${index + 1}.jpg`,
        roles: [{ character: `Rôle ${index + 1}`, episode_count: index + 2 }],
        total_episode_count: index + 2,
      })),
    },
  }, 'tv');

  assert.ok(tvSnapshot);
  assert.equal(tvSnapshot.aggregate_credits.cast.length, MEDIA_DETAIL_RENDER_MAX_CAST);
  assert.deepEqual(tvSnapshot.aggregate_credits.cast[0], {
    id: 1,
    name: 'Acteur 1',
    profile_path: '/actor-1.jpg',
    roles: [{ character: 'Rôle 1', episode_count: 2 }],
    total_episode_count: 2,
    episode_count: undefined,
  });

  const movieSnapshot = createMediaDetailRenderSnapshot({
    id: 42,
    title: 'Film',
    credits: {
      cast: [{ id: 7, name: 'Actrice', profile_path: '/actrice.jpg', character: 'Personnage' }],
    },
  }, 'movie');

  assert.ok(movieSnapshot);
  assert.equal(movieSnapshot.credits.cast.length, 1);
  assert.equal(movieSnapshot.credits.cast[0].character, 'Personnage');
  assert.equal(movieSnapshot.aggregate_credits, undefined);
});
