import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFeatureSource } from './featureSource.ts';
import {
  matchesMovieReleaseAfterYear,
  movieReleaseDateGteForAfterYear,
  parseMovieReleaseAfterYear,
} from '../src/features/discover/filterPolicy.ts';

const filterModalSource = readFileSync(new URL('../src/components/FilterModal.tsx', import.meta.url), 'utf8');
const discoverSource = readFeatureSource('discover');
const tmdbCoreSource = readFileSync(new URL('../src/features/shows/tmdbCore.ts', import.meta.url), 'utf8');
const progressiveSource = readFileSync(new URL('../src/features/discover/progressiveAgeFilter.ts', import.meta.url), 'utf8');

test('SEENIT-DISCOVER-002 applique une borne strictement supérieure à l’année choisie', () => {
  assert.equal(parseMovieReleaseAfterYear('2020'), 2020);
  assert.equal(movieReleaseDateGteForAfterYear('2020'), '2021-01-01');
  assert.equal(matchesMovieReleaseAfterYear({ media_type: 'movie', release_date: '2020-12-31' }, '2020'), false);
  assert.equal(matchesMovieReleaseAfterYear({ media_type: 'movie', release_date: '2021-01-01' }, '2020'), true);
  assert.equal(matchesMovieReleaseAfterYear({ media_type: 'movie' }, '2020'), false);
  assert.equal(matchesMovieReleaseAfterYear({ media_type: 'tv', first_air_date: '2021-01-01' }, '2020'), false);
});

test('SEENIT-DISCOVER-002 force le filtre sur les films et le propage au moteur canonique', () => {
  assert.match(filterModalSource, /handleMovieReleaseAfterYearChange[\s\S]*setDraftCategory\('Films'\)/);
  assert.match(filterModalSource, /initialMovieReleaseAfterYear/);
  assert.match(filterModalSource, /onApply\(selectedPlatforms, selectedGenres, pegi, rating, movieReleaseAfterYear\)/);
  assert.match(discoverSource, /movieReleaseAfterYear,/);
  assert.match(tmdbCoreSource, /effectiveType = movieReleaseDateGte \? 'movie' : type/);
  assert.match(tmdbCoreSource, /params\.set\('primary_release_date\.gte', movieReleaseDateGte\)/);
});

test('SEENIT-DISCOVER-002 conserve le seuil dans le cache progressif d’âge et la recherche texte', () => {
  assert.match(progressiveSource, /movieReleaseAfterYear: options\.movieReleaseAfterYear \|\| 'Toutes'/);
  assert.match(discoverSource, /matchesMovieReleaseAfterYear\(item, movieReleaseAfterYear\)/);
  assert.match(discoverSource, /movieReleaseAfterYear !== 'Toutes'/);
  assert.match(discoverSource, /setMovieReleaseAfterYear\('Toutes'\)/);
});
