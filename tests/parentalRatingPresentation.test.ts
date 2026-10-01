import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const filterModal = readFileSync('src/components/FilterModal.tsx', 'utf8');
const tmdbFacade = readFileSync('src/features/shows/tmdbCore.ts', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');

test('SEENIT-PARENTAL-001 supprime PEGI et les heuristiques parentales de genre', () => {
  assert.doesNotMatch(filterModal, /Classification PEGI/i);
  assert.match(filterModal, /Âge conseillé maximum/);
  assert.match(filterModal, /id: 'age:0'/);
  assert.match(filterModal, /id: 'age:10'/);
  assert.match(filterModal, /id: 'age:18'/);
  assert.doesNotMatch(filterModal, /id: '10'/, 'l’UI ne doit plus émettre les anciens tokens qui déclenchaient les heuristiques de genre');
  assert.match(tmdbFacade, /originalDiscoverWithFilters\(\{[\s\S]*pegi:\s*'Tous'/, 'la façade neutralise systématiquement le filtre parental historique du client TMDB');
  assert.match(tmdbFacade, /resolveParentalRating\(/);
  assert.match(tmdbFacade, /getParentalRatingDetails\(tmdbId, mediaType\)/, 'Explorer doit récupérer uniquement la preuve parentale au lieu de charger une fiche complète');
  assert.match(tmdbFacade, /matchesMaxRecommendedAge\(rating, maxAge\)/);
  assert.doesNotMatch(tmdbFacade, /without_genres/, 'la décision parentale canonique ne doit jamais reposer sur une exclusion de genres');
});

test('issue #651 retire l’éditeur personnel de la fiche PWA et APK', () => {
  assert.equal(existsSync('src/components/ParentalRatingEditor.tsx'), false);
  assert.doesNotMatch(app, /<ParentalRatingEditor|Corriger l’âge|Âge perso/);
  assert.match(app, /selectedRatingRevision/, 'les overrides historiques synchronisés peuvent encore rafraîchir la fiche sans exposer d’éditeur');
});
