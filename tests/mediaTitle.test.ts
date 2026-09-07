import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  getTrackedMediaTitleConvergence,
  resolveMediaDisplayTitle,
} from '../src/features/shows/mediaTitle.ts';

const tmdbFacadeSource = readFileSync(new URL('../src/features/shows/tmdb.ts', import.meta.url), 'utf8');
const trackedTitleSource = readFileSync(new URL('../src/features/shows/trackedMediaTitle.ts', import.meta.url), 'utf8');
const productionTitleSource = `${tmdbFacadeSource}\n${trackedTitleSource}\n${readFileSync(new URL('../src/features/shows/mediaTitle.ts', import.meta.url), 'utf8')}`;

test('SEENIT-METADATA-001 préfère le titre TMDB fr-FR et conserve le titre persisté en fallback', () => {
  assert.equal(
    resolveMediaDisplayTitle('Rhythm + Flow France', { name: 'Nouvelle École' }, 'tv'),
    'Nouvelle École',
  );
  assert.equal(
    resolveMediaDisplayTitle('The Count of Monte-Cristo', { title: 'Le Comte de Monte-Cristo' }, 'movie'),
    'Le Comte de Monte-Cristo',
  );
  assert.equal(resolveMediaDisplayTitle('Titre hors ligne', null, 'tv'), 'Titre hors ligne');
});

test('SEENIT-METADATA-001 converge uniquement par mediaType et TMDB ID exacts', () => {
  const tracked = [
    { id: 'tv-doc', tmdbId: 123, mediaType: 'tv' as const, title: 'Ancien titre' },
    { id: 'movie-doc', tmdbId: 123, mediaType: 'movie' as const, title: 'Autre film' },
    { id: 'same-title-wrong-id', tmdbId: 999, mediaType: 'tv' as const, title: 'Nouvelle École' },
  ];

  assert.deepEqual(
    getTrackedMediaTitleConvergence(tracked, 'tv', 123, { name: 'Nouvelle École' }),
    { showId: 'tv-doc', title: 'Nouvelle École' },
  );
  assert.deepEqual(
    getTrackedMediaTitleConvergence(tracked, 'movie', 123, { title: 'Film français' }),
    { showId: 'movie-doc', title: 'Film français' },
  );
  assert.equal(getTrackedMediaTitleConvergence(tracked, 'tv', 456, { name: 'Nouvelle École' }), null);
  assert.doesNotMatch(productionTitleSource, /Nouvelle École|Rhythm \+ Flow France/);
});

test('SEENIT-METADATA-001 persiste uniquement le titre localisé après hydratation TMDB', () => {
  assert.match(tmdbFacadeSource, /convergeTrackedMediaTitleFromTmdb\('tv', Number\(id\), result\.value\)/);
  assert.match(tmdbFacadeSource, /convergeTrackedMediaTitleFromTmdb\('movie', Number\(id\), result\.value\)/);
  assert.match(trackedTitleSource, /updateDoc\(doc\(db, 'users', userId, 'shows', convergence\.showId\), \{\s*title: convergence\.title,\s*\}\)/s);
  assert.doesNotMatch(trackedTitleSource, /updatedAt|seenEpisodes|episodeRecords|isFavorite|userRating|status:/);
});
