import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFeatureSource } from './featureSource.ts';

const watchListSource = readFeatureSource('watchList');
const mainSource = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const carouselUxCss = readFileSync(new URL('../src/styles/watchlistCarouselUx.css', import.meta.url), 'utf8');
const continueCardSource = readFileSync(new URL('../src/components/cards/ContinueWatchingCard.tsx', import.meta.url), 'utf8');
const movieCardSource = readFileSync(new URL('../src/components/cards/MovieWatchCard.tsx', import.meta.url), 'utf8');
const seriesCardSource = readFileSync(new URL('../src/components/cards/SeriesEpisodeCard.tsx', import.meta.url), 'utf8');
const seriesCardCss = readFileSync(new URL('../src/components/cards/seriesEpisodeCard.css', import.meta.url), 'utf8');

const WATCHLIST_CAROUSEL_IDS = [
  'continue-watching-carousel',
  'nouveautes-carousel',
  'pas-vu-depuis-un-moment-carousel',
  'films-a-voir-carousel',
];

const SERIES_CAROUSEL_IDS = [
  'continue-watching-carousel',
  'nouveautes-carousel',
  'pas-vu-depuis-un-moment-carousel',
];

test('#229 conserve un premier lot borné puis rend les quatre carrousels progressifs', () => {
  assert.match(watchListSource, /const WATCHLIST_BATCH_SIZE = 8;/);
  assert.match(watchListSource, /const WATCHLIST_CAROUSEL_OVERSCAN = 3;/);
  assert.match(watchListSource, /data\.slice\(range\.start, range\.end\)/);
  assert.match(watchListSource, /leadingSpacerSize/);
  assert.match(watchListSource, /trailingSpacerSize/);

  for (const id of WATCHLIST_CAROUSEL_IDS) {
    assert.match(
      watchListSource,
      new RegExp(`id="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`),
      `${id} doit utiliser le rail progressif`
    );
  }

  assert.doesNotMatch(
    watchListSource,
    /\.slice\(0, WATCHLIST_BATCH_SIZE\)\.map/,
    'un carrousel réduit ne doit plus rester bloqué sur le lot initial'
  );
});

test('#690 fait avancer les rails séries 8f carte par carte sans modifier le rail films', () => {
  assert.match(mainSource, /import '\.\/styles\/watchlistCarouselUx\.css';/);
  assert.match(carouselUxCss, /scroll-snap-type:\s*x mandatory !important;/);
  assert.match(carouselUxCss, /#films-a-voir-carousel\s*\{\s*scroll-snap-type:\s*none !important;/);
  assert.match(seriesCardCss, /\.series-8f-host\s*\{[^}]*scroll-snap-align:start;[^}]*scroll-snap-stop:always;/);
  assert.match(seriesCardCss, /\.series-8f--rail\s*\{[^}]*width:88vw;/);

  for (const id of SERIES_CAROUSEL_IDS) {
    assert.match(carouselUxCss, new RegExp(`#${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  }
});

test('#229 recycle les cartes hors écran au lieu d’accumuler le DOM', () => {
  assert.match(watchListSource, /useHorizontalVirtualWindow/);
  assert.match(watchListSource, /ref=\{index === 0 \? itemMeasureRef : undefined\}/);
  assert.doesNotMatch(watchListSource, /data\.slice\(0, visibleCount\)\.map\(renderCard\)/);
  assert.doesNotMatch(watchListSource, /preloadSentinelRef/);
});

test('#229 retire le faux Voir tout terminal et conserve le vrai bouton d’en-tête', () => {
  assert.doesNotMatch(carouselUxCss, /::after/);
  assert.doesNotMatch(carouselUxCss, /Suite\\A|Voir tout/);
  assert.ok(
    (watchListSource.match(/'Voir tout'/g) || []).length >= 4,
    'chaque section conserve son vrai bouton Voir tout dans l’en-tête'
  );
});

test('#690 aligne la hiérarchie 8f et retire les compteurs redondants', () => {
  assert.match(continueCardSource, /<SeriesEpisodeCard/);
  assert.match(movieCardSource, /line-clamp-2/);
  assert.match(seriesCardCss, /\.series-8f__text h3\s*\{[^}]*color:#F2C36B;/);
  assert.match(seriesCardCss, /\.series-8f__code strong\s*\{[^}]*color:#fff;/);
  assert.match(seriesCardCss, /\.series-8f__check\s*\{[^}]*background:#0B0B0F !important;/);
  assert.doesNotMatch(seriesCardSource, /series-8f__season-label/);
  assert.doesNotMatch(continueCardSource, /restant/);
  assert.match(continueCardSource, /Sorti aujourd’hui/);
  assert.match(continueCardSource, /Sorti hier/);
  assert.match(seriesCardSource, /REMAINING_DETAIL/);
  assert.doesNotMatch(carouselUxCss, /-webkit-line-clamp:\s*1/);
  assert.match(seriesCardCss, /\.series-8f__text h3,\.series-8f__text p\s*\{[^}]*-webkit-line-clamp:2/);
  assert.match(
    carouselUxCss,
    /#films-a-voir-carousel \.line-clamp-2\s*\{\s*min-block-size:\s*2lh;/,
    'Films à voir conserve son slot titre sur deux lignes'
  );
  assert.equal(
    (carouselUxCss.match(/min-block-size:\s*2lh;/g) || []).length,
    1,
    'aucun rail série ne doit encore réserver une seconde ligne vide'
  );
  assert.doesNotMatch(
    carouselUxCss,
    /min-(?:block-size|height):\s*\d+(?:\.\d+)?px/,
    'la stabilisation ne doit pas reposer sur une hauteur fixe en pixels'
  );
  assert.match(
    watchListSource,
    /\{nouveautesShows\.length > 0 && \(\s*<div className="mt-8">/,
    'l’espace validé avant Nouveautés doit rester inchangé'
  );
});
