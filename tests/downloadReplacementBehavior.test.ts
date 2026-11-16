import test from 'node:test';
import assert from 'node:assert/strict';
import { planReplacement, NOT_YET_AT_CLIENT } from '../src/features/downloads/releaseReplacement.ts';
import { collectTrackerRefusals, TRACKER_NOTE_MAX_AGE_MS, TRACKER_NOTE_TTL_MS, type TrackerNoteCache } from '../src/features/downloads/trackerRefusal.ts';
import type { LiveDownloadItem } from '../src/services/sonarrRadarrLive.ts';

// #1078 (audit du 16/11) : les 16 remarques Codex des PR #1070 à #1075 n'avaient été détectées par aucun test.
// Ces tests exécutent la logique réelle, un cas par remarque.

const HASH_A = 'a'.repeat(40), HASH_B = 'b'.repeat(40);
const dl = (patch: Partial<LiveDownloadItem>): LiveDownloadItem => ({
  id: 'qbit_x', mediaType: 'movie', title: 'Allen', tmdbId: 11, size: 1, sizeleft: 1, progress: 10, status: 'downloading',
  statusText: 'Téléchargement', downloadClient: 'qBittorrent', isRestored: false, ...patch,
} as LiveDownloadItem);

test('remplacement d’un film : l’ancien transfert est remplacé', () => {
  const old = dl({ id: 'radarr_1', downloadId: HASH_A });
  assert.deepEqual(planReplacement([old], { mediaType: 'movie', tmdbId: 11 }, { infoHash: HASH_B }), { kind: 'replace', replaced: [old] });
  assert.deepEqual(planReplacement([], { mediaType: 'movie', tmdbId: 11 }, { infoHash: HASH_B }), { kind: 'none' }, 'rien en cours : envoi simple');
  assert.deepEqual(planReplacement([dl({ id: 'radarr_2', tmdbId: 99 })], { mediaType: 'movie', tmdbId: 11 }, {}), { kind: 'none' }, 'autre film intouché');
});

test('revue Codex #1070 : la version choisie déjà en cours n’est jamais annulée', () => {
  const a = dl({ id: 'qbit_a', downloadId: HASH_A }), b = dl({ id: 'qbit_b', downloadId: HASH_B });
  const plan = planReplacement([a, b], { mediaType: 'movie', tmdbId: 11 }, { infoHash: HASH_B });
  assert.deepEqual(plan, { kind: 'replace', replaced: [a] });
});

test('revue Codex #1070 : une demande pas encore chez le client bloque le remplacement', () => {
  const plan = planReplacement([dl({ id: 'opt_123', isOptimistic: true })], { mediaType: 'movie', tmdbId: 11 }, { infoHash: HASH_B });
  assert.deepEqual(plan, { kind: 'blocked', reason: NOT_YET_AT_CLIENT });
});

test('revue Codex #1070 : un épisode seul n’annule ni le pack de saison ni les autres épisodes', () => {
  const tv = (patch: Partial<LiveDownloadItem>) => dl({ mediaType: 'tv', seasonNumber: 2, ...patch });
  const pack = tv({ id: 'sonarr_pack' }), e1 = tv({ id: 'sonarr_e1', episodeNumber: 1 }), e2 = tv({ id: 'sonarr_e2', episodeNumber: 2 });
  const season = { mediaType: 'tv' as const, tmdbId: 11, seasonNumber: 2 };
  assert.deepEqual(planReplacement([pack, e1, e2], season, { episodes: [1] }), { kind: 'replace', replaced: [e1] });
  assert.deepEqual(planReplacement([pack, e1, e2], season, { episodes: 'season' }), { kind: 'replace', replaced: [pack, e1, e2] }, 'un pack remplace tout');
  assert.deepEqual(planReplacement([pack, e1, e2], season, { episodes: [] }), { kind: 'none' }, 'couverture inconnue : rien n’est annulé');
});

const stalled = (hash: string) => ({ hash, state: 'stalledDL', dlspeed: 0, progress: 0 });
const ratio = [{ url: 'https://t.example/a', status: 4, msg: 'Ratio too low' }];

test('revue Codex #1072 : une note de moins d’une minute n’est pas relue', async () => {
  const cache: TrackerNoteCache = new Map(); let reads = 0;
  const read = async () => { reads++; return ratio; };
  assert.equal((await collectTrackerRefusals(cache, [stalled(HASH_A)], 'uid|qbit', read, 0)).get(HASH_A), 'Bloqué par le tracker : ratio insuffisant.');
  await collectTrackerRefusals(cache, [stalled(HASH_A)], 'uid|qbit', read, TRACKER_NOTE_TTL_MS - 1);
  assert.equal(reads, 1);
  await collectTrackerRefusals(cache, [stalled(HASH_A)], 'uid|qbit', read, TRACKER_NOTE_TTL_MS + 1);
  assert.equal(reads, 2, 'relue après une minute');
});

test('revue Codex #1072 : au-delà de 5 torrents, chacun finit par être relu', async () => {
  const cache: TrackerNoteCache = new Map(); const seen = new Set<string>();
  const torrents = Array.from({ length: 7 }, (_, index) => stalled(String(index).repeat(40)));
  const read = async (hash: string) => { seen.add(hash); return ratio; };
  await collectTrackerRefusals(cache, torrents, 's', read, 0);
  assert.equal(seen.size, 5, '5 relectures par passage');
  const notes = await collectTrackerRefusals(cache, torrents, 's', read, TRACKER_NOTE_TTL_MS + 1);
  assert.equal(seen.size, 7, 'le passage suivant relit d’abord les jamais lus');
  assert.equal(notes.size, 7);
});

test('revue Codex #1072 : une note non reconfirmée depuis 3 minutes n’est plus rendue', async () => {
  const cache: TrackerNoteCache = new Map();
  await collectTrackerRefusals(cache, [stalled(HASH_A)], 's', async () => ratio, 0);
  const failing = async () => { throw new Error('qBittorrent injoignable'); };
  assert.equal((await collectTrackerRefusals(cache, [stalled(HASH_A)], 's', failing, TRACKER_NOTE_TTL_MS + 1)).size, 1, 'encore récente');
  assert.equal((await collectTrackerRefusals(cache, [stalled(HASH_A)], 's', failing, TRACKER_NOTE_MAX_AGE_MS + 1)).size, 0, 'périmée');
});

test('revue Codex #1072 : une note n’est jamais réutilisée pour une autre connexion qBittorrent', async () => {
  const cache: TrackerNoteCache = new Map();
  await collectTrackerRefusals(cache, [stalled(HASH_A)], 'uid|serveur-1', async () => ratio, 0);
  const other = await collectTrackerRefusals(cache, [stalled(HASH_A)], 'uid|serveur-2', async () => [], 1);
  assert.equal(other.size, 0);
});

test('un torrent qui avance ou terminé n’est pas interrogé', async () => {
  const cache: TrackerNoteCache = new Map(); let reads = 0;
  await collectTrackerRefusals(cache, [{ hash: HASH_A, state: 'downloading', dlspeed: 5000, progress: 0.2 }, { hash: HASH_B, state: 'stalledDL', dlspeed: 0, progress: 1 }], 's', async () => { reads++; return ratio; }, 0);
  assert.equal(reads, 0);
});
