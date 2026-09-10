import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  calculateGridWindow,
  calculateHorizontalWindow,
  getVirtualSpacerSize,
} from '../src/hooks/useBoundedVirtualWindow.ts';

test('SEENIT-PERF-001 borne un rail horizontal long et conserve sa largeur logique', () => {
  const range = calculateHorizontalWindow(200, 50 * 262, {
    itemSize: 256,
    gap: 6,
    viewportSize: 1080,
  }, 6, 3);

  assert.deepEqual(range, { start: 47, end: 58 });
  assert.equal(range.end - range.start, 11);
  assert.equal(getVirtualSpacerSize(47, 256, 6), 47 * 256 + 46 * 6);
  assert.equal(getVirtualSpacerSize(142, 256, 6), 142 * 256 + 141 * 6);
});

test('SEENIT-PERF-001 borne Explorer par lignes complètes malgré le scroll infini', () => {
  const range = calculateGridWindow(500, 100 * 330, {
    itemSize: 314,
    gap: 16,
    columns: 3,
    viewportSize: 780,
    contentOffset: 0,
  }, 30, 3);

  assert.equal(range.start % 3, 0);
  assert.equal(range.end % 3, 0);
  assert.ok(range.end - range.start <= 30);
  assert.ok(range.start > 0);
  assert.ok(range.end < 500);
});

test('#229 garde l’image des cartes À Regarder stable au montage', () => {
  const source = readFileSync(new URL('../src/components/cards/ContinueWatchingCard.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /getEpisodeDetails/);
  assert.doesNotMatch(source, /setFetchedStillMap/);
  assert.match(source, /const rawPath = episodeStill \|\| showBackdrop \|\| showPoster/);
});

test('#229 applique le même enrichissement diffuseur passif aux cartes hors Explorer', () => {
  const sources = [
    '../src/components/cards/ContinueWatchingCard.tsx',
    '../src/components/cards/MovieWatchCard.tsx',
    '../src/components/cards/UpToDateShowCard.tsx',
    '../src/components/cards/UpcomingShowCard.tsx',
    '../src/components/HistoryFeed.tsx',
    '../src/components/EpisodeCard.tsx',
  ].map(path => readFileSync(new URL(path, import.meta.url), 'utf8'));

  for (const source of sources) {
    assert.match(source, /usePassiveWatchProvider/);
    assert.doesNotMatch(source, /getWatchProviders\(/);
  }
});

test('#229 ne charge les détails décoratifs des films qu’après stabilisation du geste', () => {
  const watchListSource = readFileSync(new URL('../src/screens/WatchListScreen.tsx', import.meta.url), 'utf8');
  const movieCardSource = readFileSync(new URL('../src/components/cards/MovieWatchCard.tsx', import.meta.url), 'utf8');
  const passiveProviderSource = readFileSync(new URL('../src/hooks/usePassiveWatchProvider.ts', import.meta.url), 'utf8');

  assert.match(watchListSource, /createWatchProviderRequestLimiter\(2\)/);
  assert.match(watchListSource, /onEnrich: enrichMovieDetails/);
  assert.match(passiveProviderSource, /onEnrich\?\.\(\)/);
  assert.match(movieCardSource, /peekMediaDetails/);
  assert.doesNotMatch(movieCardSource, /getMovieDetails/);
});
