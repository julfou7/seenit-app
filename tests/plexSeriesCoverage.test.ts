import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { findPlexAvailabilityOnServers, type PlexServerResource } from '../src/backend/plexAvailabilityBackend.ts';
import { countAiredEpisodes, describePlexSeriesCoverage, isPlexEpisodePresent, needsPlexSeriesCoverage, readPlexEpisodeCoverage } from '../src/features/plex/plexSeriesCoverage.ts';

const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
const server: PlexServerResource = { name: 'PC-Julian', clientIdentifier: 'pms-1', accessToken: 'server-token', provides: 'server', connections: [{ uri: 'https://pms.example.test', local: false }] };
const tedLasso = { type: 'show', title: 'Ted Lasso', ratingKey: 'show-77', leafCount: 1, Guid: [{ id: 'tmdb://97546' }] };

function plexServer(allLeaves: (url: string) => Response | Promise<Response>) {
  const calls: string[] = [];
  const request: typeof fetch = async input => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/library/metadata/show-77/allLeaves')) return allLeaves(url);
    if (decodeURIComponent(url).includes('tmdb://97546')) return json({ MediaContainer: { Metadata: [tedLasso] } });
    return json({ MediaContainer: { Metadata: [] } });
  };
  return { calls, request };
}

const find = (request: typeof fetch) => findPlexAvailabilityOnServers({
  servers: [server], accountToken: 'account', tmdbId: 97546, mediaType: 'tv', request, fastTimeoutMs: 200, inventoryTimeoutMs: 200, inventoryBudgetMs: 500,
});

test('SEENIT-PLEX-013 une série partielle expose ses épisodes exacts en un seul appel allLeaves', async () => {
  const { calls, request } = plexServer(() => json({ MediaContainer: { size: 3, Metadata: [
    { type: 'episode', parentIndex: 2, index: 1, ratingKey: 'e21' },
    { type: 'episode', parentIndex: 1, index: 3, ratingKey: 'e13' },
    { type: 'episode', parentIndex: 0, index: 1, ratingKey: 's01' },
  ] } }));
  const result = await find(request);
  assert.equal(result?.available, true);
  assert.equal(result?.episodeCount, 3);
  assert.deepEqual(result?.episodes, ['0:1', '1:3', '2:1'], 'tri saison puis épisode, spéciaux compris');
  assert.equal(calls.filter(url => url.includes('/allLeaves')).length, 1, 'jamais un appel par épisode');
  assert.ok(calls.filter(url => url.includes('/allLeaves')).every(url => url.includes('/library/metadata/show-77/')), 'clé exacte de la série');
});

test('SEENIT-PLEX-013 une liste illisible ou tronquée ne produit jamais une couverture inventée', async () => {
  const failed = await find(plexServer(() => { throw new Error('timeout'); }).request);
  assert.equal(failed?.available, true, 'la série reste disponible');
  assert.equal(failed?.episodeCount, 1, 'décompte Plex (leafCount) conservé');
  assert.equal(failed?.episodes, undefined, 'aucune liste d’épisodes non prouvée');

  const truncated = await find(plexServer(() => json({ MediaContainer: { totalSize: 40, size: 1, Metadata: [{ type: 'episode', parentIndex: 1, index: 1 }] } })).request);
  assert.equal(truncated?.episodes, undefined);
  assert.equal(truncated?.episodeCount, 1);
});

test('SEENIT-PLEX-013 un film garde une disponibilité binaire, sans appel de couverture', async () => {
  const calls: string[] = [];
  const request: typeof fetch = async input => {
    const url = String(input);
    calls.push(url);
    if (decodeURIComponent(url).includes('tmdb://603')) return json({ MediaContainer: { Metadata: [{ type: 'movie', ratingKey: 'm1', leafCount: 1, Guid: [{ id: 'tmdb://603' }] }] } });
    return json({ MediaContainer: { Metadata: [] } });
  };
  const result = await findPlexAvailabilityOnServers({ servers: [server], accountToken: 'a', tmdbId: 603, mediaType: 'movie', request, fastTimeoutMs: 200 });
  assert.equal(result?.available, true);
  assert.equal(result?.episodeCount, undefined);
  assert.ok(!calls.some(url => url.includes('allLeaves')));
});

test('SEENIT-PLEX-013 sémantique aucun / inconnu / partiel / disponible, jamais « complet »', () => {
  const show = { seasons: [{ season_number: 0, episode_count: 5 }, { season_number: 1, episode_count: 10 }, { season_number: 2, episode_count: 12 }, { season_number: 3, episode_count: 12 }], last_episode_to_air: { season_number: 3, episode_number: 12 } };
  assert.equal(countAiredEpisodes(show), 34, 'hors spéciaux');
  assert.equal(countAiredEpisodes({ ...show, last_episode_to_air: { season_number: 3, episode_number: 4 } }), 26, 'saison en cours');
  assert.equal(countAiredEpisodes({ seasons: [], last_episode_to_air: { season_number: 2, episode_number: 1 } }), null, 'saison manquante : inconnu');
  assert.equal(countAiredEpisodes({ seasons: show.seasons }), null);

  assert.deepEqual(describePlexSeriesCoverage({ available: false }, 34), { state: 'none', label: null });
  assert.deepEqual(describePlexSeriesCoverage({ available: true }, 34), { state: 'unknown', label: null });
  assert.deepEqual(describePlexSeriesCoverage({ available: true, episodeCount: 1 }, 34), { state: 'partial', label: '1 épisode sur 34' });
  assert.deepEqual(describePlexSeriesCoverage({ available: true, episodeCount: 34 }, 34), { state: 'available', label: '34 épisodes' });
  assert.deepEqual(describePlexSeriesCoverage({ available: true, episodeCount: 12 }, null), { state: 'available', label: '12 épisodes' }, 'sans total TMDB : décompte seul, sans « sur »');
  for (const coverage of [describePlexSeriesCoverage({ available: true, episodeCount: 40 }, 34)]) assert.doesNotMatch(String(coverage.label), /complet/i);
});

test('SEENIT-PLEX-013 un épisode n’est annoncé sur Plex qu’avec la preuve de cet épisode précis', () => {
  const known = { available: true, episodes: ['1:3', '2:1'] };
  assert.equal(isPlexEpisodePresent(known, 1, 3), true);
  assert.equal(isPlexEpisodePresent(known, 1, 4), false, 'série sur Plex mais épisode absent');
  assert.equal(isPlexEpisodePresent({ available: true }, 1, 4), null, 'liste inconnue : aucune conclusion');
  assert.equal(isPlexEpisodePresent({ available: false, episodes: [] }, 1, 1), null);

  assert.deepEqual(readPlexEpisodeCoverage({ episodeCount: 2, episodes: ['1:3', '2:1'] }), { episodeCount: 2, episodes: ['1:3', '2:1'] });
  assert.deepEqual(readPlexEpisodeCoverage({ episodeCount: 3, episodes: ['1:3'] }), { episodeCount: 3 }, 'liste incohérente ignorée');
  assert.deepEqual(readPlexEpisodeCoverage({ episodeCount: 1, episodes: ['x'] }), { episodeCount: 1 });
  for (const invalid of [{}, { episodeCount: null }, { episodeCount: '4' }, { episodeCount: -1 }, null]) assert.deepEqual(readPlexEpisodeCoverage(invalid), {});
});

test('SEENIT-PLEX-013 une série reconstruite par la synchro relit sa couverture une fois, depuis une fiche seulement', () => {
  const rebuiltBySync = { available: true, lastChecked: Date.now() };
  assert.equal(needsPlexSeriesCoverage(rebuiltBySync, 'tv', true), true, 'fiche : une lecture réseau malgré le cache positif de 24 h');
  assert.equal(needsPlexSeriesCoverage(rebuiltBySync, 'tv', false), false, 'cartes cache-only : aucune requête');
  assert.equal(needsPlexSeriesCoverage({ ...rebuiltBySync, coverageCheckedAt: Date.now() }, 'tv', true), false, 'déjà lue : cache respecté');
  assert.equal(needsPlexSeriesCoverage(rebuiltBySync, 'movie', true), false, 'film binaire');
  assert.equal(needsPlexSeriesCoverage({ available: false }, 'tv', true), false);
  const source = readFileSync('src/features/plex/plexAvailability.ts', 'utf8');
  assert.match(source, /if \(!forceRefresh && cached && !needsSeriesCoverage\)/);
  assert.match(source, /\.\.\.\(mediaType === 'tv' \? \{ coverageCheckedAt: Date\.now\(\) \} : \{\}\)/);
});
