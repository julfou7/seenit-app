import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { absoluteRatingHeight, ratingTone } from '../src/features/shows/detailPlanning.ts';

// Retour terrain du 17/11 (fiche épisode, Dexter S02 / Je les braque à Noël) : « lecture des notes très difficile, je
// ne différencie pas un 8 d'un 3 ; sur un épisode pas encore sorti je n'ai aucune idée des précédents ».
test('échelle fixe 0–10 : une 3,2 fait environ le tiers d’une 8,3, jamais relative à la saison', () => {
  assert.equal(absoluteRatingHeight(8.3, 52), 43);
  assert.equal(absoluteRatingHeight(3.2, 52), 17);
  assert.equal(absoluteRatingHeight(0.1, 52), 4, 'jamais invisible');
  assert.equal(absoluteRatingHeight(12, 52), 52, 'bornée');
  assert.deepEqual([8.3, 7.4, 6.2, 3.2].map(ratingTone), ['top', 'good', 'fair', 'poor']);
});

test('fiche épisode : note écrite par épisode, à venir en pointillé, moyenne et rang séparés', () => {
  const card = readFileSync('src/screens/mediaDetail/episodeSections.tsx', 'utf8');
  assert.doesNotMatch(card, /<polyline/, 'plus de courbe à échelle relative');
  assert.match(card, /const value = cell\.rating !== null \? formatRating\(cell\.rating\) : cell\.aired \? '–' : '';/, 'note écrite ; inconnue « – » ; à venir vide');
  assert.match(card, /height: absoluteRatingHeight\(cell\.rating, BAR_MAX\)/);
  assert.match(card, /border-dashed/, 'épisode à venir : barre pointillée');
  assert.match(card, /aria-label=\{`Épisode \$\{cell\.n\}\$\{cell\.rating !== null \? `, note \$\{formatRating\(cell\.rating\)\}` : cell\.aired \? ', note inconnue' : ', pas encore diffusé'\}/);
  const modal = readFileSync('src/screens/EpisodeDetailModalCore.tsx', 'utf8');
  assert.match(modal, /const seasonRatings = reliableEpisodeRatings\(seasonEpisodes\);/, 'mêmes notes fiables que la fiche série');
  assert.match(modal, /const ratingSummary = seasonAverage !== null \? `Moyenne ★ \$\{formatRating\(seasonAverage\)\}` : null;/, 'moyenne toujours dite, même sur un épisode à venir');
  assert.match(modal, /aired: Boolean\(episode\.air_date\) && episode\.air_date! <= todayStr/);
});
