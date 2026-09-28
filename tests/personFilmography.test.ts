import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  deduplicateAndSortPersonCredits,
  isExplicitSelfAppearance,
  partitionPersonActingCredits,
  PERSON_FILMOGRAPHY_PAGE_SIZE,
  personCreditIdentity,
  storedPersonShowIdentity,
  takeVisiblePersonCredits
} from '../src/features/people/personFilmography.ts';

test('SEENIT-UX-010 sépare films séries et apparitions sans exclure les documentaires', () => {
  const credits = deduplicateAndSortPersonCredits([
    { id: 42, media_type: 'movie', title: 'Documentaire joué', character: 'Le narrateur', genre_ids: [99], poster_path: null },
    { id: 42, media_type: 'tv', name: 'Série jouée', character: 'Inspecteur', poster_path: null },
    { id: 7, media_type: 'tv', name: 'Talk-show', character: 'Self', poster_path: null },
    { id: 8, media_type: 'movie', title: 'Archives', character: 'Herself (archive footage)', poster_path: null }
  ], 'cast');
  const groups = partitionPersonActingCredits(credits);

  assert.deepEqual(groups.movies.map(item => item.title), ['Documentaire joué']);
  assert.deepEqual(groups.series.map(item => item.name), ['Série jouée']);
  assert.deepEqual(groups.appearances.map(item => item.id), [7, 8]);
  assert.notEqual(personCreditIdentity(groups.movies[0]), personCreditIdentity(groups.series[0]));
});

test('SEENIT-UX-010 conserve un vrai rôle fusionné et les personnages TMDB affichables', () => {
  const [credit] = deduplicateAndSortPersonCredits([
    { id: 10, media_type: 'movie', title: 'Double crédit', character: 'Self', poster_path: null },
    { id: 10, media_type: 'movie', title: 'Double crédit', character: 'Capitaine', poster_path: '/captain.jpg' }
  ], 'cast');
  const groups = partitionPersonActingCredits([credit]);

  assert.equal(groups.movies.length, 1);
  assert.equal(groups.appearances.length, 0);
  assert.equal(groups.movies[0].character, 'Self / Capitaine');
  assert.deepEqual(groups.movies[0].rawCharacters, ['Self', 'Capitaine']);
  assert.equal(groups.movies[0].poster_path, '/captain.jpg');
  assert.equal(isExplicitSelfAppearance('Selfie Artist'), false);
});

test('SEENIT-UX-010 borne le premier rendu d’une très grande filmographie', () => {
  const credits = Array.from({ length: 250 }, (_, index) => ({ id: index + 1 }));
  const visible = takeVisiblePersonCredits(credits, PERSON_FILMOGRAPHY_PAGE_SIZE);

  assert.equal(visible.length, 48);
  assert.equal(visible[0].id, 1);
  assert.equal(visible.at(-1)?.id, 48);
  assert.equal(storedPersonShowIdentity({ tmdbId: 42 }), 'tv:42');
  assert.equal(storedPersonShowIdentity({ tmdbId: 42, mediaType: 'movie' }), 'movie:42');
});

test('SEENIT-UX-010 adapte compteurs et grille à la catégorie active sur PWA et APK', () => {
  const source = readFileSync('src/screens/PersonDetailModal.tsx', 'utf8');

  assert.match(source, /actingCredits\[actingCategory\]/);
  assert.match(source, /\['movies', 'Films', actingCredits\.movies\.length\]/);
  assert.match(source, /\['series', 'Séries', actingCredits\.series\.length\]/);
  assert.match(source, /\['appearances', 'Apparitions', actingCredits\.appearances\.length\]/);
  assert.match(source, /visibleCredits\.map/);
  assert.match(source, /visibleCreditWindow\.key === creditListKey/);
  assert.doesNotMatch(source, /setVisibleCreditCount/);
  assert.match(source, /storedPersonShowIdentity\(s\)/);
  assert.match(source, /showsByMediaIdentity\.get\(personCreditIdentity\(credit\)\)/);
});
