import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Show } from '../src/types.ts';
import { compareContinueWatching, continueWatchingKey, isSeasonStartNouveaute, newEpisodeArrival } from '../src/features/watchlist/homeSections.ts';

// Retour terrain du 08/11 : « Un nouvel épisode d'une série en cours, genre MobLand, où je suis à jour doit
// apparaître dans Continuer à regarder, en 1er, et pas dans Nouveautés. Exclusivement réservé aux nouvelles
// saisons où j'en suis à l'épisode 1. »
const DAY = 86_400_000;
const now = Date.parse('2026-11-08T14:00:00');
const today = '2026-11-08';
const iso = (days: number) => new Date(now - days * DAY).toISOString().slice(0, 10);
const series = (overrides: Partial<Show>): Show => ({
  id: 'show', userId: 'u1', tmdbId: 1, title: 'Série', mediaType: 'tv', status: 'watching', seenEpisodes: [], createdAt: now - 400 * DAY,
  firstAirDate: iso(400), ...overrides,
} as Show);
const watchedAt = (days: number) => now - days * DAY;

test('SEENIT-UX-021 un nouvel épisode d’une saison en cours n’est jamais une nouveauté, même pour une série récente', () => {
  // Série lancée il y a 20 jours, à jour jusqu'à E4 : l'ancienne règle « première diffusion ≤ 60 jours » la classait en Nouveautés.
  const mobland = series({ id: 'mobland', firstAirDate: iso(20), seenEpisodes: ['1x1', '1x2', '1x3', '1x4'],
    nextEpisodeToWatch: { season_number: 1, episode_number: 5, air_date: iso(1) } as Show['nextEpisodeToWatch'] });
  assert.equal(isSeasonStartNouveaute(mobland, today, now), false);
  assert.ok(newEpisodeArrival(mobland, today, watchedAt(6), now) > 0, 'E5 est sorti après le dernier visionnage');
  // Saison 2 en cours (E1 à E3 vus), nouvel E4 : toujours Continuer.
  const season2 = series({ id: 's2', seenEpisodes: ['1x1', '2x1', '2x2', '2x3'], nextEpisodeToWatch: { season_number: 2, episode_number: 4, air_date: iso(0) } as Show['nextEpisodeToWatch'] });
  assert.equal(isSeasonStartNouveaute(season2, today, now), false);
});

test('SEENIT-UX-021 Nouveautés = une saison dont tu en es à l’épisode 1, sortie depuis 60 jours au plus', () => {
  const newSeason = series({ seenEpisodes: ['1x1', '1x2'], nextEpisodeToWatch: { season_number: 2, episode_number: 1, air_date: iso(10) } as Show['nextEpisodeToWatch'] });
  assert.equal(isSeasonStartNouveaute(newSeason, today, now), true, 'nouvelle saison, épisode 1');
  const unstarted = series({ firstAirDate: iso(5), nextEpisodeToWatch: { season_number: 1, episode_number: 1, air_date: iso(5) } as Show['nextEpisodeToWatch'] });
  assert.equal(isSeasonStartNouveaute(unstarted, today, now), true, 'série pas encore commencée, épisode 1');
  const oldSeason = series({ seenEpisodes: ['1x1'], nextEpisodeToWatch: { season_number: 2, episode_number: 1, air_date: iso(90) } as Show['nextEpisodeToWatch'] });
  assert.equal(isSeasonStartNouveaute(oldSeason, today, now), false, 'au-delà de 60 jours');
});

test('SEENIT-UX-021 Continuer : le nouvel épisode passe en tête, puis le visionnage le plus récent', () => {
  const mobland = series({ id: 'mobland', seenEpisodes: ['1x1', '1x2', '1x3', '1x4'], nextEpisodeToWatch: { season_number: 1, episode_number: 5, air_date: iso(1) } as Show['nextEpisodeToWatch'] });
  const other = series({ id: 'other', seenEpisodes: ['1x1'], nextEpisodeToWatch: { season_number: 1, episode_number: 2, air_date: iso(30) } as Show['nextEpisodeToWatch'] });
  const order = (otherWatched: number) => {
    const keys = new Map([[mobland.id, continueWatchingKey(mobland, watchedAt(6), today, now)], [other.id, continueWatchingKey(other, otherWatched, today, now)]]);
    return [other, mobland].sort((a, b) => compareContinueWatching(keys.get(a.id)!, keys.get(b.id)!)).map(show => show.id);
  };
  // MobLand vu il y a 6 jours, E5 sorti hier : passe devant une série vue il y a 3 jours.
  assert.deepEqual(order(watchedAt(3)), ['mobland', 'other'], 'le nouvel épisode passe en tête');
  // Une série regardée à l'instant (ici ou ailleurs) repasse devant : c'est l'activité la plus récente.
  assert.deepEqual(order(now - 60_000), ['other', 'mobland']);
  // Horloge ou fuseau décalés : une sortie postérieure à maintenant ne fige jamais la série en tête.
  const future = series({ seenEpisodes: ['1x1'], nextEpisodeToWatch: { season_number: 1, episode_number: 2, air_date: '2026-11-09' } as Show['nextEpisodeToWatch'] });
  assert.equal(newEpisodeArrival(future, '2026-11-09', watchedAt(3), now), 0);
  // En retard (épisode sorti avant le dernier visionnage) : pas de sortie à compter.
  assert.equal(newEpisodeArrival(series({ seenEpisodes: ['1x1'], nextEpisodeToWatch: { season_number: 1, episode_number: 2, air_date: iso(10) } as Show['nextEpisodeToWatch'] }), today, watchedAt(2), now), 0);
});

test('SEENIT-UX-021 l’accueil classe avec ces règles, et la section garde le même ordre', () => {
  const screen = readFileSync('src/screens/WatchListScreen.tsx', 'utf8');
  assert.match(screen, /const isNouveaute = \(s: Show\): boolean => isSeasonStartNouveaute\(s, todayIso, now\);/);
  assert.doesNotMatch(screen, /getUpToDateOrNewSeasonCategory\(s\)/, 'plus de « première diffusion ≤ 60 jours » pour Nouveautés');
  assert.match(screen, /\(isWatchedRecently\(s\) \|\| hasRecentArrival\(s\)\)/, 'un nouvel épisode fait entrer la série dans Continuer');
  assert.match(screen, /compareContinueWatching\(continueWatchingKeys\.get\(a\.id\)!, continueWatchingKeys\.get\(b\.id\)!\)/);
  const section = readFileSync('src/screens/WatchNextSection.tsx', 'utf8');
  assert.match(section, /keys \? compareContinueWatching\(keys\.get\(a\.id\)!, keys\.get\(b\.id\)!\)/);
});
