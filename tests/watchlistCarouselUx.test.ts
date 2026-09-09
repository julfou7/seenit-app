import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const watchListSource = readFileSync(new URL('../src/screens/WatchListScreen.tsx', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const carouselUxCss = readFileSync(new URL('../src/styles/watchlistCarouselUx.css', import.meta.url), 'utf8');

const WATCHLIST_CAROUSEL_IDS = [
  'continue-watching-carousel',
  'nouveautes-carousel',
  'pas-vu-depuis-un-moment-carousel',
  'films-a-voir-carousel',
];

test('#229 conserve le premier lot borné des quatre carrousels À voir', () => {
  assert.match(watchListSource, /const WATCHLIST_BATCH_SIZE = 8;/);
  assert.equal(
    (watchListSource.match(/\.slice\(0, WATCHLIST_BATCH_SIZE\)\.map/g) || []).length,
    4,
    'les quatre carrousels réduits restent bornés à huit cartes'
  );
});

test('#229 rend le scroll horizontal libre sans supprimer le guidage de proximité', () => {
  assert.match(mainSource, /import '\.\/styles\/watchlistCarouselUx\.css';/);
  assert.match(carouselUxCss, /scroll-snap-type:\s*x proximity !important;/);
  assert.doesNotMatch(carouselUxCss, /scroll-snap-type:\s*x mandatory/);

  for (const id of WATCHLIST_CAROUSEL_IDS) {
    assert.match(carouselUxCss, new RegExp(`#${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  }
});

test('#229 explique la fin du lot et conserve Voir tout comme alternative accessible', () => {
  assert.match(carouselUxCss, /content:\s*"Suite\\A« Voir tout » ↑";/);
  assert.match(carouselUxCss, /pointer-events:\s*none;/);
  assert.ok(
    (watchListSource.match(/'Voir tout'/g) || []).length >= 4,
    'chaque section conserve son vrai bouton Voir tout dans l’en-tête'
  );
});
