import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSeriesSeasonProgress, seriesCardPosterCandidates, seriesCardPosterCrossOrigin, seriesCardStaleDetail, seriesEpisodeCode, upcomingCardTone } from '../src/features/watchlist/seriesCardPresentation.ts';
import { dominantPosterHue, readPosterHue, rememberPosterHue, POSTER_HUE_CACHE_LIMIT } from '../src/features/watchlist/posterHue.ts';

test('SEENIT-UX-014 conserve les états de saison sans inventer les diffusions', () => {
  const episode = { season_number: 5, episode_number: 4, episode_count: 8, aired_episodes_in_season: 5 };
  const show = { seenEpisodes: ['5x1', '5x2', '5x3'], seasonsCache: [], nextEpisodeToWatch: episode, nextEpisodeToAir: null, seriesEnded: true, tmdbStatus: 'Ended' };
  const progress = buildSeriesSeasonProgress(show, episode, 'watch', '2026-10-21');
  assert.equal(progress.label, 'S5 · 3/8');
  assert.equal(progress.unknownTail, false);
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
  const missing = buildSeriesSeasonProgress({ seenEpisodes: [], seasonsCache: [], nextEpisodeToWatch: null, nextEpisodeToAir: null, seriesEnded: false, tmdbStatus: 'Returning Series' }, { season_number: 3, episode_number: 2 }, 'watch', '2026-10-21');
  assert.equal(missing.label, 'S3 · 0/?');
  assert.deepEqual(missing.segments.map(item => item.state), ['unknown', 'current']);
  assert.equal(missing.unknownTail, true, 'une vieille fiche sans cache garde les épisodes prouvés et une suite inconnue');
});

test('SEENIT-UX-014 représente Harry Potter et toute saison ouverte sans faux total', () => {
  const episode = {
    season_number: 1,
    episode_number: 3,
    episode_count: 4,
    aired_episodes_in_season: 3,
    known_episodes_in_season: 4,
    season_total_unknown: true,
    last_season_number: 1,
    last_known_episode_type: 'standard',
    last_known_episode_air_date: null,
  };
  const show = {
    seenEpisodes: ['1x1', '1x2'],
    seasonsCache: [],
    nextEpisodeToWatch: episode,
    nextEpisodeToAir: { season_number: 1, episode_number: 4, episode_count: 4, air_date: '2026-11-01' },
    seriesEnded: false,
    tmdbStatus: 'Returning Series',
  };
  const progress = buildSeriesSeasonProgress(show, episode, 'watch', '2026-10-21');
  assert.equal(progress.label, 'S1 · 2/?');
  assert.equal(progress.unknownTail, true);
  assert.equal(progress.knownEpisodes, 4);
  assert.equal(progress.availableUnseen, 1);
  assert.equal(progress.detail, '1 dispo · total inconnu');
  assert.deepEqual(progress.segments.map(item => item.state), ['seen', 'seen', 'current', 'future']);
  assert.equal(progress.description, 'Saison 1 : 2 épisodes vus sur 4 connus, nombre total encore inconnu');

  const finale = buildSeriesSeasonProgress({ ...show, nextEpisodeToAir: null }, {
    ...episode,
    season_total_unknown: false,
    last_known_episode_type: 'finale',
    last_known_episode_air_date: '2026-11-01',
  }, 'watch', '2026-11-02');
  assert.equal(finale.unknownTail, false, 'une preuve explicite de finale retire la traîne inconnue');
  assert.equal(finale.label, 'S1 · 2/4');
  const cachedFinale = buildSeriesSeasonProgress({ ...show, nextEpisodeToWatch: null, nextEpisodeToAir: null,
    seasonsCache: [{ season_number: 1, episode_count: 4, episodes: [{ episode_number: 4, episode_type: 'finale', air_date: '2026-11-01' }] }],
  }, { season_number: 1, episode_number: 3, episode_type: 'standard' }, 'watch', '2026-11-02');
  assert.equal(cachedFinale.unknownTail, false, 'le type de l’épisode courant ne remplace pas celui du dernier épisode');
});

test('SEENIT-UX-014 restaure le nombre de jours pour une série laissée de côté', () => {
  const now = Date.UTC(2026, 9, 21, 12, 0, 0);
  const watchedAt = Date.UTC(2026, 7, 1, 20, 0, 0);
  const show = {
    seenEpisodes: ['1x1'],
    episodeRecords: { 'S01E01': { watchedAt } },
    lastWatchedAt: watchedAt - 86_400_000,
  };
  assert.equal(seriesCardStaleDetail(show, now), '⏳ Il y a 81 jours');
  assert.equal(seriesCardStaleDetail({ ...show, episodeRecords: { '1x1': { watchedAt: now - (60 * 86_400_000) } } }, now), undefined);
  assert.equal(seriesCardStaleDetail({ seenEpisodes: [], episodeRecords: {}, lastWatchedAt: watchedAt }, now), undefined, 'une série jamais commencée ne reçoit pas une fausse date de visionnage');
  assert.equal(seriesCardStaleDetail({ ...show, lastWatchedAt: now, episodeRecords: { '1x1': { watchedAt }, '1x2': { watchedAt: now } } }, now), '⏳ Il y a 81 jours', 'les épisodes retirés de Vu ne modifient pas la récence');
});

test('SEENIT-UX-014 borne le rendu des saisons longues et conserve les proportions', () => {
  const episode = { season_number: 1, episode_number: 3, episode_count: 40, aired_episodes_in_season: 20 };
  const progress = buildSeriesSeasonProgress({ seenEpisodes: ['1x1', '1x2'], nextEpisodeToWatch: episode, seriesEnded: true, tmdbStatus: 'Ended' }, episode, 'watch', '2026-10-21');
  assert.equal(progress.continuous, true);
  assert.ok(progress.segments.length <= 6);
  assert.equal(progress.segments.reduce((total, segment) => total + segment.count, 0), 40);
  assert.equal(progress.segments.find(segment => segment.state === 'future')?.count, 20);
  const invalid = buildSeriesSeasonProgress({ seenEpisodes: [], seriesEnded: true, tmdbStatus: 'Ended' }, { ...episode, episode_count: Number.MAX_SAFE_INTEGER }, 'watch', '2026-10-21');
  assert.equal(invalid.segments.length, 3, 'le pointeur de reprise garde une progression minimale même si le total est invalide');
  assert.equal(invalid.totalUnknown, true);
  const malformed = buildSeriesSeasonProgress({ seenEpisodes: [`1x${Number.MAX_SAFE_INTEGER}`], nextEpisodeToAir: { season_number: 1, episode_number: Number.MAX_SAFE_INTEGER } }, { ...episode, episode_count: 4 }, 'watch', '2026-10-21');
  assert.equal(malformed.knownEpisodes, 4, 'les identifiants corrompus ne provoquent pas une boucle non bornée');
});

test('la carte 8f respecte les dates et les épisodes vus indépendamment', () => {
  const episode = { season_number: 0, episode_number: 2 };
  const progress = buildSeriesSeasonProgress({
    seenEpisodes: ['0x3', '1x1'], seriesEnded: true, tmdbStatus: 'Ended', seasonsCache: [{ season_number: 0, episodes: [
      { episode_number: 1, air_date: '2026-10-20' }, { episode_number: 2, air_date: '2026-10-21' },
      { episode_number: 3, air_date: '2026-11-01' }, { episode_number: 4, air_date: '2026-11-02' },
    ] }],
  }, episode, 'watch', '2026-10-21');
  assert.deepEqual(progress.segments.map(item => item.state), ['unseen', 'current', 'seen', 'future']);
  assert.equal(progress.label, 'S0 · 1/?');
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
  const continueWatching = readFileSync(new URL('../src/components/cards/ContinueWatchingCard.tsx', import.meta.url), 'utf8');
  assert.match(continueWatching, /seriesCardStaleDetail\(show\)/, 'le rail réel restaure la récence sans dépendre du cache saison');
  const card = readFileSync(new URL('../src/components/cards/SeriesEpisodeCard.tsx', import.meta.url), 'utf8');
  assert.match(card, /series-8f__unknown-tail/);
  assert.match(card, /Nombre d'épisodes encore inconnu/);
  const history = readFileSync(new URL('../src/components/HistoryFeed.tsx', import.meta.url), 'utf8');
  assert.match(history, /onUnseen: \(\) => setUnseenModalItem\(item\)/);
  assert.match(history, /onOpen=\{handleRowClick\}/);
  const expanded = readFileSync(new URL('../src/screens/watchListPresentation.tsx', import.meta.url), 'utf8');
  assert.match(expanded, /<ContinueWatchingCard show=\{show\} layout="list"/);
});
