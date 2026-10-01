import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { readFeatureSource } from './featureSource.ts';

const facade = readFileSync('src/features/shows/tmdbCore.ts', 'utf8');
const filterModal = readFileSync('src/components/FilterModal.tsx', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');
const detail = readFeatureSource('showDetail');

test('SEENIT-PARENTAL-001 unifie fiche, cartes et Explorer sur le résolveur parental', () => {
  assert.match(facade, /decorateParentalRatingDetails\(\s*'tv'/); assert.match(facade, /decorateParentalRatingDetails\(\s*'movie'/); assert.match(facade, /matchesMaxRecommendedAge\(rating, maxAge\)/); assert.match(facade, /seenitParentalRating:\s*rating/, 'les résultats filtrés destinés aux cartes transportent le même rating résolu'); assert.match(detail, /tmdb\.getMediaDetails\(/, 'la fiche doit passer par la façade TMDB canonique décorée');
});

test('SEENIT-PARENTAL-001 remplace PEGI par une borne d’âge maximale cumulative', () => {
  assert.doesNotMatch(filterModal, /Classification PEGI/i); assert.match(filterModal, /Âge conseillé maximum/); assert.match(filterModal, /id: 'age:0'/); assert.match(filterModal, /id: 'age:10'/); assert.match(filterModal, /id: 'age:18'/); assert.doesNotMatch(filterModal, /id: '10'/, 'les anciens tokens exacts ne doivent plus réactiver les heuristiques legacy'); assert.match(facade, /pegi:\s*'Tous'/, 'la façade doit neutraliser le filtre parental historique du client TMDB');
});

test('issue #651 retire le CTA de correction d’âge des fiches sans casser les overrides historiques', () => {
  assert.equal(existsSync('src/components/ParentalRatingEditor.tsx'), false, 'le composant d’édition ne doit plus exister');
  assert.doesNotMatch(app, /ParentalRatingEditor|Corriger l’âge|Âge perso/, 'la fiche ne doit plus exposer de CTA ou libellé d’édition');
  assert.match(app, /useParentalRatingStore/, 'les overrides historiques restent lisibles sans UI d’édition');
  assert.match(app, /selectedRatingRevision/, 'une valeur historique synchronisée peut encore rafraîchir la fiche sans action utilisateur');
});
