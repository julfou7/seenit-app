import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  discoverTypeForCategory,
  getGenreIdsForMediaType,
  isSearchCompatibleCategory,
  matchesSelectedGenres,
  parseMinimumRating,
} from '../src/features/discover/filterPolicy.ts';

const discoverSource = readFileSync(new URL('../src/screens/DiscoverScreen.tsx', import.meta.url), 'utf8');
const filterModalSource = readFileSync(new URL('../src/components/FilterModal.tsx', import.meta.url), 'utf8');
const tmdbFacadeSource = readFileSync(new URL('../src/features/shows/tmdb.ts', import.meta.url), 'utf8');
const gridCardSource = readFileSync(new URL('../src/components/GridMediaCard.tsx', import.meta.url), 'utf8');

test('la politique de genres applique un OU intra-famille et reste spécifique au type', () => {
  assert.deepEqual(getGenreIdsForMediaType(['Action', 'Sci-Fi'], 'movie'), [28, 878]);
  assert.deepEqual(getGenreIdsForMediaType(['Action', 'Sci-Fi'], 'tv'), [10759, 10765]);
  assert.equal(matchesSelectedGenres({ media_type: 'movie', genre_ids: [878] }, ['Action', 'Sci-Fi']), true);
  assert.equal(matchesSelectedGenres({ media_type: 'movie', genre_ids: [35] }, ['Action', 'Sci-Fi']), false);
});

test('le type Explorer est converti sans perdre Au cinéma', () => {
  assert.equal(discoverTypeForCategory('Séries'), 'tv');
  assert.equal(discoverTypeForCategory('Films'), 'movie');
  assert.equal(discoverTypeForCategory('Au cinéma'), 'movie');
  assert.equal(discoverTypeForCategory('Pépites'), 'all');
  assert.equal(discoverTypeForCategory('Top 100'), 'all');
});

test('la recherche texte n’annonce que les catégories réellement compatibles', () => {
  assert.equal(isSearchCompatibleCategory('Tout'), true);
  assert.equal(isSearchCompatibleCategory('Séries'), true);
  assert.equal(isSearchCompatibleCategory('Films'), true);
  assert.equal(isSearchCompatibleCategory('Personnes'), true);
  assert.equal(isSearchCompatibleCategory('Pépites'), false);
  assert.equal(isSearchCompatibleCategory('Au cinéma'), false);
});

test('la note minimum est normalisée de façon stable', () => {
  assert.equal(parseMinimumRating('Toutes'), null);
  assert.equal(parseMinimumRating('7.5+'), 7.5);
  assert.equal(parseMinimumRating('9+'), 9);
});

test('la modale de filtres est transactionnelle et Réinitialiser restaure Tout', () => {
  assert.match(filterModalSource, /const \[draftCategory, setDraftCategory\] = useState\(activeCategory\)/);
  assert.match(filterModalSource, /setDraftCategory\('Tout'\)/);
  assert.doesNotMatch(filterModalSource, /onClick=\{\(\) => setActiveCategory\('Séries'\)\}/);

  const validateStart = filterModalSource.indexOf('const handleValidate');
  const validateEnd = filterModalSource.indexOf('\n  };', validateStart);
  const validateSource = filterModalSource.slice(validateStart, validateEnd);
  assert.match(validateSource, /setActiveCategory\(draftCategory\)/);
  assert.match(validateSource, /onApply\(selectedPlatforms, selectedGenres, pegi, rating\)/);
});

test('toute combinaison de filtres ou de tri passe par le moteur canonique', () => {
  assert.match(discoverSource, /else if \(hasActiveFilters \|\| sortBy !== 'popular'\)/);
  assert.match(discoverSource, /discoverSeenIt\(\{/);
  assert.match(discoverSource, /category: activeCategory/);
  assert.match(discoverSource, /watchProviders: selectedPlatforms/);
  assert.match(discoverSource, /genres: selectedGenres/);
  assert.match(discoverSource, /sortOrder/);
});

test('un filtre restrictif ne peut plus vider la grille parce que le HERO a pris les résultats', () => {
  assert.match(discoverSource, /debouncedQuery\.trim\(\) \|\| activeCategory === 'Personnes' \|\| hasActiveFilters \|\| sortBy !== 'popular'\) return \[\]/);
  assert.match(discoverSource, /showHeroSurface = !debouncedQuery\.trim\(\)\s*&& !hasActiveFilters\s*&& sortBy === 'popular'/s);
});

test('les réponses obsolètes Explorer et recherche texte ne peuvent plus écraser le nouvel état', () => {
  assert.match(discoverSource, /homeRequestGenerationRef/);
  assert.match(discoverSource, /searchRequestGenerationRef/);
  assert.match(discoverSource, /if \(!isCurrentRequest\(\)\) return;/);
});

test('la recherche texte applique réellement genre, note et type', () => {
  assert.match(discoverSource, /selectedGenres\.length > 0 && qClean/);
  assert.match(discoverSource, /matchesSelectedGenres\(item, selectedGenres\)/);
  assert.match(discoverSource, /minRating !== 'Toutes' && qClean/);
  assert.match(discoverSource, /activeCategory === 'Séries'/);
  assert.match(discoverSource, /activeCategory === 'Films'/);
});

test('Explorer ne réimplémente plus une classification parentale contradictoire', () => {
  assert.doesNotMatch(discoverSource, /content_ratings\?\.results/);
  assert.doesNotMatch(discoverSource, /ratingStr === 'R'/);
  assert.doesNotMatch(discoverSource, /itemG\.includes\(27\).*PE?GI/s);
  assert.match(tmdbFacadeSource, /applyCanonicalAgeFilter/);
  assert.match(tmdbFacadeSource, /matchesMaxRecommendedAge/);
});

test('les catégories spéciales gardent leurs contraintes avec les filtres', () => {
  assert.match(tmdbFacadeSource, /category === 'Top 100'\) minVotes = 3000/);
  assert.match(tmdbFacadeSource, /category === 'Pépites'\) minVotes = 100/);
  assert.match(tmdbFacadeSource, /category === 'Documentaires'/);
  assert.match(tmdbFacadeSource, /params\.set\('with_genres', '99'\)/);
  assert.match(tmdbFacadeSource, /category === 'Au cinéma'/);
  assert.match(tmdbFacadeSource, /params\.set\('with_release_type', '2\|3'\)/);
  assert.match(tmdbFacadeSource, /total_pages: Math\.max/);
});

test('les cartes ne confondent plus réseau TV et diffuseur public FR', () => {
  assert.doesNotMatch(gridCardSource, /hasKnownProvider:\s*Boolean\(show\?\.networks\?\.length\)/);
  assert.match(gridCardSource, /usePassiveWatchProvider\(\{/);
});
