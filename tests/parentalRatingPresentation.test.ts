import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const filterModal = readFileSync('src/components/FilterModal.tsx', 'utf8');
const tmdbFacade = readFileSync('src/features/shows/tmdb.ts', 'utf8');
const editor = readFileSync('src/components/ParentalRatingEditor.tsx', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');

test('SEENIT-PARENTAL-001 supprime PEGI et les heuristiques parentales de genre', () => {
  assert.doesNotMatch(filterModal, /Classification PEGI/i);
  assert.match(filterModal, /Âge conseillé maximum/);
  assert.match(filterModal, /id: 'age:0'/);
  assert.match(filterModal, /id: 'age:10'/);
  assert.match(filterModal, /id: 'age:18'/);
  assert.doesNotMatch(filterModal, /id: '10'/,
    'l’UI ne doit plus émettre les anciens tokens qui déclenchaient les heuristiques de genre');

  assert.match(tmdbFacade, /originalDiscoverWithFilters\(\{[\s\S]*pegi:\s*'Tous'/,
    'la façade neutralise systématiquement le filtre parental historique du client TMDB');
  assert.match(tmdbFacade, /resolveParentalRating\(/);
  assert.match(tmdbFacade, /matchesMaxRecommendedAge\(rating, maxAge\)/);
  assert.doesNotMatch(tmdbFacade, /without_genres/,
    'la décision parentale canonique ne doit jamais reposer sur une exclusion de genres');
});

test('SEENIT-PARENTAL-001 expose la correction personnelle sur la fiche PWA et APK', () => {
  assert.match(app, /<ParentalRatingEditor/);
  assert.match(app, /selectedRatingRevision/,
    'une correction doit rafraîchir immédiatement la fiche ouverte');
  assert.match(editor, /setOverride\(mediaType, Number\(tmdbId\), age\)/);
  assert.match(editor, /clearOverride\(mediaType, Number\(tmdbId\)\)/);
  assert.match(editor, /0 = Tous publics/);
  assert.doesNotMatch(editor, /title|originalTitle|release_date|firstAirDate/,
    'la correction personnelle doit rester identifiée uniquement par type + TMDB ID');
});
