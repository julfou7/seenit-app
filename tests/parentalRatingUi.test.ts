import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const facade = readFileSync('src/features/shows/tmdb.ts', 'utf8');
const filterModal = readFileSync('src/components/FilterModal.tsx', 'utf8');
const editor = readFileSync('src/components/ParentalRatingEditor.tsx', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');
const detail = readFileSync('src/screens/ShowDetailScreen.tsx', 'utf8');

test('SEENIT-PARENTAL-001 unifie fiche, cartes et Explorer sur le résolveur parental', () => {
  assert.match(facade, /decorateParentalRatingDetails\(\s*'tv'/);
  assert.match(facade, /decorateParentalRatingDetails\(\s*'movie'/);
  assert.match(facade, /matchesMaxRecommendedAge\(rating, maxAge\)/);
  assert.match(facade, /seenitParentalRating:\s*rating/,
    'les résultats filtrés destinés aux cartes transportent le même rating résolu');
  assert.match(detail, /tmdb\.getMediaDetails\(/,
    'la fiche doit passer par la façade TMDB canonique décorée');
});

test('SEENIT-PARENTAL-001 remplace PEGI par une borne d’âge maximale cumulative', () => {
  assert.doesNotMatch(filterModal, /Classification PEGI/i);
  assert.match(filterModal, /Âge conseillé maximum/);
  assert.match(filterModal, /id: 'age:0'/);
  assert.match(filterModal, /id: 'age:10'/);
  assert.match(filterModal, /id: 'age:18'/);
  assert.doesNotMatch(filterModal, /id: '10'/,
    'les anciens tokens exacts ne doivent plus réactiver les heuristiques legacy');
  assert.match(facade, /pegi:\s*'Tous'/,
    'la façade doit neutraliser le filtre parental historique du client TMDB');
});

test('SEENIT-PARENTAL-001 expose une correction personnelle partageable sans titre ni année', () => {
  assert.match(app, /<ParentalRatingEditor/);
  assert.match(app, /selectedRatingRevision/,
    'un changement de correction doit remonter immédiatement dans la fiche ouverte');
  assert.match(editor, /setOverride\(mediaType, Number\(tmdbId\), age\)/);
  assert.match(editor, /clearOverride\(mediaType, Number\(tmdbId\)\)/);
  assert.match(editor, /0 = Tous publics/);
  assert.doesNotMatch(editor, /\.(?:title|originalTitle)\b|\b(?:release_date|firstAirDate)\b/,
    'l’éditeur personnel ne doit pas identifier un média par titre ou année');
});
