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

test('#229 conserve un premier lot borné puis rend les quatre carrousels progressifs', () => {
  assert.match(watchListSource, /const WATCHLIST_BATCH_SIZE = 8;/);
  assert.match(watchListSource, /const WATCHLIST_CAROUSEL_PRELOAD_MARGIN = '0px 50% 0px 0px';/);
  assert.match(watchListSource, /data\.slice\(0, visibleCount\)\.map\(renderCard\)/);

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

test('#229 rend le scroll horizontal réellement libre, sans snap obligatoire ni de proximité', () => {
  assert.match(mainSource, /import '\.\/styles\/watchlistCarouselUx\.css';/);
  assert.match(carouselUxCss, /scroll-snap-type:\s*none !important;/);
  assert.doesNotMatch(carouselUxCss, /scroll-snap-type:\s*x\s+(?:mandatory|proximity)/);
  assert.doesNotMatch(
    watchListSource,
    /scroll-px-4 sm:scroll-px-6 scrollbar-none snap-x snap-mandatory/,
    'les rails À Regarder ne doivent plus demander de snap à Tailwind'
  );

  for (const id of WATCHLIST_CAROUSEL_IDS) {
    assert.match(carouselUxCss, new RegExp(`#${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  }
});

test('#229 précharge la suite avant la fin du geste avec un fallback sans IntersectionObserver', () => {
  assert.match(watchListSource, /typeof IntersectionObserver === 'undefined'/);
  assert.match(watchListSource, /root:\s*container/);
  assert.match(watchListSource, /rootMargin:\s*WATCHLIST_CAROUSEL_PRELOAD_MARGIN/);
  assert.match(watchListSource, /preloadSentinelRef/);
  assert.match(watchListSource, /element\.clientWidth \* 0\.5/);
  assert.match(
    watchListSource,
    /setVisibleCount\(current => Math\.min\(data\.length, current \+ WATCHLIST_BATCH_SIZE\)\)/
  );
  assert.match(watchListSource, /startTransition\(\(\) =>/);
});

test('#229 retire le faux Voir tout terminal et conserve le vrai bouton d’en-tête', () => {
  assert.doesNotMatch(carouselUxCss, /::after/);
  assert.doesNotMatch(carouselUxCss, /Suite\\A|Voir tout/);
  assert.ok(
    (watchListSource.match(/'Voir tout'/g) || []).length >= 4,
    'chaque section conserve son vrai bouton Voir tout dans l’en-tête'
  );
});
