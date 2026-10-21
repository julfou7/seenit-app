import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Show } from '../src/types.ts';
import { resolveWatchCardResume, markWatchCardEpisode } from '../src/features/watchlist/watchCardResume.ts';

const today = '2026-10-21';
const show: Show = {
  id: 'followed-identity', userId: 'fixture', tmdbId: 42, title: 'Série', mediaType: 'tv',
  posterPath: null, backdropPath: null, status: 'plan_to_watch', isArchived: false,
  createdAt: 1, updatedAt: 1, seenEpisodes: [], episodeRecords: {}, totalAiredEpisodes: 4,
  nextEpisodeToWatch: null, nextEpisodeToAir: { season_number: 1, episode_number: 5, air_date: '2026-10-30' },
  seasonsCache: [{ season_number: 1, episode_count: 8, episodes: [
    { episode_number: 1, name: 'Pilote', air_date: '2026-10-01' },
    { episode_number: 2, name: 'Suite', air_date: '2026-10-08' },
    { episode_number: 5, name: 'Futur', air_date: '2026-10-30' },
  ] }],
};

test('#693 résout la reprise sans transformer une diffusion future en épisode à voir', () => {
  const resume = resolveWatchCardResume(show, today);
  assert.equal(resume.episode?.episode_number, 1);
  assert.equal(resume.episode?.name, 'Pilote');
  assert.equal(resume.upToDate, false);
  assert.equal(resolveWatchCardResume({ ...show, seenEpisodes: ['S01E01'] }, today).episode?.episode_number, 2);
  assert.equal(resolveWatchCardResume({ ...show, nextEpisodeToWatch: show.nextEpisodeToAir }, today).episode?.episode_number, 1);
  assert.equal(resolveWatchCardResume({ ...show, seasonsCache: [] }, today).episode?.episode_number, 1);
  assert.equal(resolveWatchCardResume({ ...show, seasonsCache: [], nextEpisodeToAir: { season_number: 1, episode_number: 1, air_date: '2026-10-30' } }, today).episode, null, 'une date future connue gagne sur un compteur contradictoire');
  const unknown = resolveWatchCardResume({ ...show, seenEpisodes: ['1x1'], seasonsCache: [], totalAiredEpisodes: undefined }, today);
  assert.deepEqual(unknown, { episode: null, upToDate: false }, 'une reprise inconnue n’est pas À jour');
  assert.deepEqual(resolveWatchCardResume({ ...show, seenEpisodes: ['1x1'], totalAiredEpisodes: 1 }, today), { episode: null, upToDate: true });
  assert.equal(resolveWatchCardResume({ ...show, totalAiredEpisodes: undefined, seasonsCache: [] }, today).episode, null, 'sans preuve de diffusion, aucune invention S01E01');
});

test('#693 la façade de production marque exactement la reprise affichée et conserve le Show original', async () => {
  const writes: Array<{ target: Show; season: number; episode: number }> = [];
  const mark = async (target: Show, season: number, episode: number) => { writes.push({ target, season, episode }); };
  const original = JSON.stringify(show);
  assert.equal(await markWatchCardEpisode(show, today, mark), true);
  assert.deepEqual(writes, [{ target: show, season: 1, episode: 1 }]);
  assert.equal(writes[0].target, show, 'identité et snapshot Annuler ne sont pas reconstruits');
  assert.equal(JSON.stringify(show), original);
  assert.equal(await markWatchCardEpisode({ ...show, totalAiredEpisodes: undefined, seasonsCache: [] }, today, mark), false);
  assert.equal(await markWatchCardEpisode({ ...show, nextEpisodeToWatch: show.nextEpisodeToAir, seasonsCache: [], totalAiredEpisodes: undefined }, today, mark), false);
  assert.equal(writes.length, 1, 'un futur ou une reprise inconnue n’écrit rien');
  const card = readFileSync(new URL('../src/components/cards/ContinueWatchingCard.tsx', import.meta.url), 'utf8');
  const screen = readFileSync(new URL('../src/screens/WatchListScreen.tsx', import.meta.url), 'utf8');
  assert.match(card, /resolveWatchCardResume\(show, todayStr\)/);
  assert.doesNotMatch(card, /show\.nextEpisodeToWatch \|\| show\.nextEpisodeToAir/);
  assert.match(screen, /markWatchCardEpisode\(show, getTodayStr\(\), markEpisodeWatched\)/);
});
