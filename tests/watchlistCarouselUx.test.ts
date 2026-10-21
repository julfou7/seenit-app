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
const nextCss = readFileSync(new URL('../src/screens/watchNext18c.css', import.meta.url), 'utf8');

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

  // 18c remplace les quatre rails par une liste séries et un rail de tickets bornés.
  assert.match(watchListSource, /series\.slice\(0, seriesCount\)/);
  assert.match(watchListSource, /orderedMovies\.slice\(0, filmsExpanded \? filmCount : 8\)/);
  assert.match(watchListSource, /id="films-a-voir-18c"/);

  assert.doesNotMatch(
    watchListSource,
    /\.slice\(0, WATCHLIST_BATCH_SIZE\)\.map/,
    'un carrousel réduit ne doit plus rester bloqué sur le lot initial'
  );
});

test('#712 remplace les rails séries par la liste 18c et donne un snap aux tickets films', () => {
  assert.match(mainSource, /import '\.\/styles\/watchlistCarouselUx\.css';/);
  assert.match(nextCss, /scroll-snap-type:x proximity/);
  assert.match(nextCss, /\.watch-next-18c__series\s*\{[^}]*flex-direction:column/);
  assert.match(seriesCardCss, /\.series-8f-host\s*\{[^}]*scroll-snap-align:start;[^}]*scroll-snap-stop:always;/);
  assert.match(seriesCardCss, /\.series-8f--rail\s*\{[^}]*width:88vw;/);

  for (const id of SERIES_CAROUSEL_IDS) assert.doesNotMatch(watchListSource, new RegExp(`id="${id}"`));
});

test('#229 recycle les cartes hors écran au lieu d’accumuler le DOM', () => {
  assert.match(watchListSource, /useHorizontalVirtualWindow/);
  assert.match(watchListSource, /ref=\{index === 0 \? itemMeasureRef : undefined\}/);
  assert.doesNotMatch(watchListSource, /data\.slice\(0, visibleCount\)\.map\(renderCard\)/);
  assert.doesNotMatch(watchListSource, /preloadSentinelRef/);
});

test('#712 conserve deux vrais accès Voir tout vers la même grille paginée', () => {
  assert.doesNotMatch(carouselUxCss, /::after/);
  assert.doesNotMatch(carouselUxCss, /Suite\\A|Voir tout/);
  assert.match(watchListSource, /className="watch-next-18c__all-films" onClick=\{onToggleFilms\}/);
  assert.match(watchListSource, /onClick=\{onToggleFilms\}>\{filmsExpanded \? 'Réduire' : 'Voir tout'\}/);
  assert.match(watchListSource, /filmCount < orderedMovies\.length/);
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
  assert.match(watchListSource, /groups=\{\[continueWatchingShows, nouveautesShows, pasVuDepuisUnMomentShows\]\}/);
});
