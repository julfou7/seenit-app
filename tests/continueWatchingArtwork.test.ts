import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const cardSource = readFileSync(new URL('../src/components/cards/ContinueWatchingCard.tsx', import.meta.url), 'utf8');

test('À Regarder privilégie le still de l’épisode puis le visuel de la saison courante', () => {
  assert.match(cardSource, /const currentSeasonArtwork = cachedSeason\?\.poster_path \|\| null/);
  assert.match(cardSource, /const rawPath = episodeStill \|\| currentSeasonArtwork \|\| showBackdrop \|\| showPoster/);
});

test('le correctif de visuel reste cache-only et ne déclenche aucune hydratation depuis la carte', () => {
  assert.doesNotMatch(cardSource, /getSeasonDetails\(|getShowDetails\(|getMovieDetails\(|fetch\(/);
  assert.doesNotMatch(cardSource, /Nouvelle École|Rhythm \+ Flow France/);
});
