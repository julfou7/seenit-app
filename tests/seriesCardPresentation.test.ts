import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSeriesSeasonProgress, seriesCardPosterCandidates, seriesCardPosterCrossOrigin, seriesEpisodeCode, upcomingCardTone } from '../src/features/watchlist/seriesCardPresentation.ts';
import { dominantPosterHue, readPosterHue, rememberPosterHue, POSTER_HUE_CACHE_LIMIT } from '../src/features/watchlist/posterHue.ts';

test('SEENIT-UX-014 conserve les états de saison sans inventer les diffusions', () => {
  const episode = { season_number: 5, episode_number: 4, episode_count: 8, aired_episodes_in_season: 5 };
  const show = { seenEpisodes: ['5x1', '5x2', '5x3'], seasonsCache: [], nextEpisodeToWatch: episode, nextEpisodeToAir: null };
  const progress = buildSeriesSeasonProgress(show, episode, 'watch', '2026-10-21');
  assert.equal(progress.label, 'S5 · 3/8');
  assert.deepEqual(progress.segments.map(item => item.state), ['seen', 'seen', 'seen', 'current', 'unseen', 'future', 'future', 'future']);
  assert.equal(seriesEpisodeCode(episode), 'S05 · E04');
  const legacy = buildSeriesSeasonProgress({ ...show, seenEpisodes: ['S05E01', '5x1', 's05e02', '5x3'] }, episode, 'watch', '2026-10-21');
  assert.equal(legacy.label, progress.label, 'les clés historiques sont normalisées et dédoublonnées sans modifier les données');
  assert.deepEqual(legacy.segments, progress.segments);
  const history = buildSeriesSeasonProgress({ ...show, seenEpisodes: [...show.seenEpisodes, '5x4'] }, episode, 'history', '2026-10-21');
  assert.equal(history.segments[3].state, 'history');
  const unknown = buildSeriesSeasonProgress(show, { season_number: 3, episode_number: 2, episode_count: 4 }, 'upcoming', '2026-10-21');
  assert.equal(unknown.segments[0].state, 'unknown');
  assert.equal(unknown.segments[1].state, 'current');
  const missing = buildSeriesSeasonProgress(show, { season_number: 3, episode_number: 2 }, 'watch', '2026-10-21');
  assert.equal(missing.label, 'S3 · 0/—');
  assert.deepEqual(missing.segments, []);
});

test('SEENIT-UX-014 borne le rendu des saisons longues et conserve les proportions', () => {
  const episode = { season_number: 1, episode_number: 3, episode_count: 40, aired_episodes_in_season: 20 };
  const progress = buildSeriesSeasonProgress({ seenEpisodes: ['1x1', '1x2'], nextEpisodeToWatch: episode }, episode, 'watch', '2026-10-21');
  assert.equal(progress.continuous, true);
  assert.ok(progress.segments.length <= 6);
  assert.equal(progress.segments.reduce((total, segment) => total + segment.count, 0), 40);
  assert.equal(progress.segments.find(segment => segment.state === 'future')?.count, 20);
  const invalid = buildSeriesSeasonProgress({ seenEpisodes: [] }, { ...episode, episode_count: Number.MAX_SAFE_INTEGER }, 'watch', '2026-10-21');
  assert.deepEqual(invalid.segments, []);
});

test('la carte 8f respecte les dates et les épisodes vus indépendamment', () => {
  const episode = { season_number: 0, episode_number: 2 };
  const progress = buildSeriesSeasonProgress({
    seenEpisodes: ['0x3', '1x1'], seasonsCache: [{ season_number: 0, episodes: [
      { episode_number: 1, air_date: '2026-10-20' }, { episode_number: 2, air_date: '2026-10-21' },
      { episode_number: 3, air_date: '2026-11-01' }, { episode_number: 4, air_date: '2026-11-02' },
    ] }],
  }, episode, 'watch', '2026-10-21');
  assert.deepEqual(progress.segments.map(item => item.state), ['unseen', 'current', 'seen', 'future']);
  assert.equal(progress.label, 'S0 · 1/4');
  assert.deepEqual([0, 1, 7, 8, 365].map(upcomingCardTone), ['today', 'soon', 'soon', 'later', 'later']);
});

test('la couleur 8f provient des pixels dominants et son cache reste borné', () => {
  assert.equal(dominantPosterHue([255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255]), 0);
  assert.equal(dominantPosterHue([0, 0, 0, 255, 250, 250, 250, 255]), 260);
  assert.equal(dominantPosterHue([0, 255, 0, 255]), 120);
  for (let i = 0; i <= POSTER_HUE_CACHE_LIMIT; i++) rememberPosterHue(`fixture:${i}`, i);
  assert.equal(readPosterHue('fixture:0'), undefined);
  assert.equal(readPosterHue(`fixture:${POSTER_HUE_CACHE_LIMIT}`), POSTER_HUE_CACHE_LIMIT);
});

test('la carte 8f réutilise un visuel déjà connu quand le poster manque ou casse', () => {
  assert.deepEqual(
    seriesCardPosterCandidates({ posterPath: null, backdropPath: '/into-the-night-backdrop.jpg' }),
    ['https://image.tmdb.org/t/p/w300/into-the-night-backdrop.jpg'],
  );
  assert.deepEqual(
    seriesCardPosterCandidates({ posterPath: '/poster.jpg', backdropPath: '/backdrop.jpg' }),
    ['https://image.tmdb.org/t/p/w185/poster.jpg', 'https://image.tmdb.org/t/p/w300/backdrop.jpg'],
  );
  const same = 'https://cdn.example.test/card.jpg';
  assert.deepEqual(seriesCardPosterCandidates({ posterPath: same, backdropPath: same }), [same]);
});

test('la carte 8f ne sacrifie pas le poster Android au calcul de teinte CORS', () => {
  const tmdbPoster = 'https://image.tmdb.org/t/p/w185/slow-horses.jpg';
  assert.equal(seriesCardPosterCrossOrigin(tmdbPoster, true), undefined);
  assert.equal(seriesCardPosterCrossOrigin(tmdbPoster, false), 'anonymous');
  assert.equal(seriesCardPosterCrossOrigin('https://cdn.example.test/poster.jpg', false), undefined);

  const cardSource = readFileSync(new URL('../src/components/cards/SeriesEpisodeCard.tsx', import.meta.url), 'utf8');
  assert.match(cardSource, /seriesCardPosterCrossOrigin\(poster, Capacitor\.isNativePlatform\(\)\)/);
  assert.match(cardSource, /<img src=\{poster\} crossOrigin=\{posterCrossOrigin\}/);
  assert.match(cardSource, /catch \{ \/\* Une image sans CORS garde sa présentation et la teinte de secours\. \*\/ \}/);
});

test('la carte 8f reste partagée par les adapters de production et leurs actions existantes', () => {
  for (const file of ['src/components/cards/ContinueWatchingCard.tsx', 'src/components/cards/UpcomingShowCard.tsx', 'src/components/HistoryFeed.tsx']) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(source, /<SeriesEpisodeCard/);
    assert.match(source, /usePassiveWatchProvider/);
  }
  const history = readFileSync(new URL('../src/components/HistoryFeed.tsx', import.meta.url), 'utf8');
  assert.match(history, /onUnseen: \(\) => setUnseenModalItem\(item\)/);
  assert.match(history, /onOpen=\{handleRowClick\}/);
  const expanded = readFileSync(new URL('../src/screens/watchListPresentation.tsx', import.meta.url), 'utf8');
  assert.match(expanded, /<ContinueWatchingCard show=\{show\} layout="list"/);
});
