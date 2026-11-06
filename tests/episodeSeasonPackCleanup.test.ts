import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkEpisodeImportedInSonarr,
  cleanupSeasonPackFromSonarrAndQbit,
  getTrackedSeasonPacks,
  markTrackedSeasonPackCleaned,
  processTrackedSeasonPackFallbacks,
  pruneTrackedSeasonPacks,
  registerTrackedSeasonPack,
  removeTrackedSeasonPack,
  resetTrackedSeasonPacksInMemory,
  saveTrackedSeasonPacks,
  type TrackedSeasonPackFallback
} from '../src/features/downloads/episodeSeasonPackCleanup.ts';

test.beforeEach(() => {
  resetTrackedSeasonPacksInMemory();
});

test('partitionne les packs suivis par UID utilisateur', () => {
  registerTrackedSeasonPack({
    downloadId: 'ABCDEF1111',
    seriesId: 10,
    seasonNumber: 1,
    episodeNumber: 1,
    title: 'Show 1'
  }, 'uid-user-1');

  registerTrackedSeasonPack({
    downloadId: 'FEDCBA2222',
    seriesId: 20,
    seasonNumber: 2,
    episodeNumber: 3,
    title: 'Show 2'
  }, 'uid-user-2');

  const packsUser1 = getTrackedSeasonPacks('uid-user-1');
  const packsUser2 = getTrackedSeasonPacks('uid-user-2');

  assert.equal(packsUser1.length, 1);
  assert.equal(packsUser1[0].downloadId, 'abcdef1111');
  assert.equal(packsUser1[0].title, 'Show 1');

  assert.equal(packsUser2.length, 1);
  assert.equal(packsUser2[0].downloadId, 'fedcba2222');
  assert.equal(packsUser2[0].title, 'Show 2');
});

test('normalise les identifiants de torrent lors de l’enregistrement', () => {
  registerTrackedSeasonPack({
    downloadId: '  QBIT_12345ABCDE  ',
    seriesId: 15,
    seasonNumber: 3,
    episodeNumber: 5
  }, 'test-uid');

  const packs = getTrackedSeasonPacks('test-uid');
  assert.equal(packs.length, 1);
  assert.equal(packs[0].downloadId, '12345abcde');
});

test('mettre à jour un pack existant préserve l’unicité par downloadId', () => {
  registerTrackedSeasonPack({
    downloadId: 'hash999',
    seriesId: 42,
    seasonNumber: 1,
    episodeNumber: 1,
    title: 'Initial Title'
  }, 'uid-unique');

  registerTrackedSeasonPack({
    downloadId: 'HASH999',
    seriesId: 42,
    seasonNumber: 1,
    episodeNumber: 1,
    title: 'Updated Title'
  }, 'uid-unique');

  const packs = getTrackedSeasonPacks('uid-unique');
  assert.equal(packs.length, 1);
  assert.equal(packs[0].title, 'Updated Title');
});

test('marque un pack comme nettoyé et permet sa suppression manuelle', () => {
  registerTrackedSeasonPack({
    downloadId: 'to-clean-hash',
    seriesId: 100,
    seasonNumber: 1,
    episodeNumber: 4
  }, 'uid-clean');

  assert.equal(getTrackedSeasonPacks('uid-clean')[0].cleanedUp, false);

  markTrackedSeasonPackCleaned('TO-CLEAN-HASH', 'uid-clean');
  const cleaned = getTrackedSeasonPacks('uid-clean');
  assert.equal(cleaned[0].cleanedUp, true);
  assert.equal(typeof cleaned[0].cleanedAt, 'number');

  removeTrackedSeasonPack('to-clean-hash', 'uid-clean');
  assert.equal(getTrackedSeasonPacks('uid-clean').length, 0);
});

test('purge les packs nettoyés expirés et conserve les packs actifs récents', () => {
  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000;
  const ONE_DAY = 24 * ONE_HOUR;

  const items: TrackedSeasonPackFallback[] = [
    {
      downloadId: 'active-recent',
      seriesId: 1,
      seasonNumber: 1,
      episodeNumber: 1,
      createdAt: now - 2 * ONE_HOUR,
      cleanedUp: false
    },
    {
      downloadId: 'active-too-old',
      seriesId: 2,
      seasonNumber: 1,
      episodeNumber: 1,
      createdAt: now - 15 * ONE_DAY,
      cleanedUp: false
    },
    {
      downloadId: 'cleaned-recent',
      seriesId: 3,
      seasonNumber: 1,
      episodeNumber: 1,
      createdAt: now - 10 * ONE_HOUR,
      cleanedUp: true,
      cleanedAt: now - 2 * ONE_HOUR
    },
    {
      downloadId: 'cleaned-expired',
      seriesId: 4,
      seasonNumber: 1,
      episodeNumber: 1,
      createdAt: now - 3 * ONE_DAY,
      cleanedUp: true,
      cleanedAt: now - 25 * ONE_HOUR
    }
  ];

  const pruned = pruneTrackedSeasonPacks(items, now);
  const remainingIds = pruned.map(p => p.downloadId);

  assert.deepEqual(remainingIds, ['active-recent', 'cleaned-recent']);
});

test('checkEpisodeImportedInSonarr vérifie hasFile via episodeId direct ou liste de série', async () => {
  const mockTransport = {
    get: async (url: string) => {
      if (url.includes('/api/v3/episode/101')) {
        return { id: 101, title: 'Pilot', hasFile: true };
      }
      if (url.includes('/api/v3/episode/102')) {
        return { id: 102, title: 'Episode 2', hasFile: false };
      }
      if (url.includes('/api/v3/episode?seriesId=99')) {
        return [
          { seasonNumber: 1, episodeNumber: 1, hasFile: true },
          { seasonNumber: 1, episodeNumber: 2, hasFile: false }
        ];
      }
      return [];
    },
    del: async () => ({}),
    post: async () => ({})
  };

  const is101Imported = await checkEpisodeImportedInSonarr('http://localhost:8989', 'apikey', {
    seriesId: 99,
    seasonNumber: 1,
    episodeNumber: 1,
    episodeId: 101
  }, mockTransport);
  assert.equal(is101Imported, true);

  const is102Imported = await checkEpisodeImportedInSonarr('http://localhost:8989', 'apikey', {
    seriesId: 99,
    seasonNumber: 1,
    episodeNumber: 2,
    episodeId: 102
  }, mockTransport);
  assert.equal(is102Imported, false);

  const fallbackImported = await checkEpisodeImportedInSonarr('http://localhost:8989', 'apikey', {
    seriesId: 99,
    seasonNumber: 1,
    episodeNumber: 1
  }, mockTransport);
  assert.equal(fallbackImported, true);
});

test('cleanupSeasonPackFromSonarrAndQbit purge les éléments de file Sonarr et supprime le torrent qBit', async () => {
  const deletedUrls: string[] = [];
  const postedBodies: any[] = [];

  const mockTransport = {
    get: async (url: string) => {
      if (url.includes('/api/v3/queue')) {
        return {
          records: [
            { id: 45, downloadId: 'TARGETHASH123', title: 'Season 1 Pack' },
            { id: 46, downloadId: 'OTHERHASH456', title: 'Other Torrent' }
          ]
        };
      }
      return [];
    },
    del: async (url: string) => {
      deletedUrls.push(url);
      return {};
    },
    post: async (_url: string, body: any) => {
      postedBodies.push(body);
      return {};
    }
  };

  const result = await cleanupSeasonPackFromSonarrAndQbit('targethash123', {
    sonarrUrl: 'http://localhost:8989',
    sonarrApiKey: 'apikey',
    qbittorrentUrl: 'http://localhost:8080'
  }, mockTransport);

  assert.equal(result.sonarrCleaned, true);
  assert.equal(result.qbitCleaned, true);
  assert.deepEqual(result.removedQueueIds, [45]);

  assert.equal(deletedUrls.length, 1);
  assert.match(deletedUrls[0], /\/api\/v3\/queue\/45\?removeFromClient=true&blocklist=false/);

  assert.equal(postedBodies.length, 1);
  assert.equal(postedBodies[0], 'hashes=targethash123&deleteFiles=false');
});

test('processTrackedSeasonPackFallbacks détecte l’import et nettoie automatiquement les packs partiels', async () => {
  registerTrackedSeasonPack({
    downloadId: 'auto-clean-hash-1',
    seriesId: 50,
    seasonNumber: 1,
    episodeNumber: 3,
    episodeId: 503,
    title: 'Show Auto Clean'
  }, 'uid-worker');

  const deletedQueueItems: string[] = [];

  const mockTransport = {
    get: async (url: string) => {
      if (url.includes('/api/v3/episode/503')) {
        return { id: 503, hasFile: true };
      }
      if (url.includes('/api/v3/queue')) {
        return {
          records: [
            { id: 88, downloadId: 'auto-clean-hash-1' }
          ]
        };
      }
      return [];
    },
    del: async (url: string) => {
      deletedQueueItems.push(url);
      return {};
    },
    post: async () => ({})
  };

  const result = await processTrackedSeasonPackFallbacks({
    sonarrUrl: 'http://localhost:8989',
    sonarrApiKey: 'apikey',
    qbittorrentUrl: 'http://localhost:8080'
  }, 'uid-worker', mockTransport);

  assert.equal(result.cleanedFallbacks.length, 1);
  assert.equal(result.cleanedFallbacks[0].downloadId, 'auto-clean-hash-1');
  assert.deepEqual(result.removedQueueIds, [88]);

  const stored = getTrackedSeasonPacks('uid-worker');
  assert.equal(stored[0].cleanedUp, true);
  assert.equal(typeof stored[0].cleanedAt, 'number');
});

test('SEENIT-DOWNLOAD-014 #879 un pack partagé par un lot n’est retiré qu’après l’import de tous ses épisodes', async () => {
  registerTrackedSeasonPack({
    downloadId: 'batch-pack-hash',
    seriesId: 60,
    seasonNumber: 2,
    episodeNumber: 1,
    episodeId: 601,
    extraEpisodes: [{ episodeNumber: 2, episodeId: 602 }, { episodeNumber: 3 }],
    title: 'Show Lot'
  }, 'uid-batch');

  const imported = new Set<number>([601]);
  const deleted: string[] = [];
  const transport = {
    get: async (url: string) => {
      const direct = url.match(/\/api\/v3\/episode\/(\d+)$/);
      if (direct) return { id: Number(direct[1]), hasFile: imported.has(Number(direct[1])) };
      if (url.includes('/api/v3/episode?seriesId=60')) return [{ seasonNumber: 2, episodeNumber: 3, hasFile: imported.has(603) }];
      if (url.includes('/api/v3/queue')) return { records: [{ id: 91, downloadId: 'batch-pack-hash' }] };
      return [];
    },
    del: async (url: string) => { deleted.push(url); return {}; },
    post: async () => ({})
  };
  const config = { sonarrUrl: 'http://localhost:8989', sonarrApiKey: 'apikey', qbittorrentUrl: 'http://localhost:8080' };
  const run = async () => {
    // Lever la temporisation entre deux vérifications pour rejouer le cycle du worker.
    saveTrackedSeasonPacks(getTrackedSeasonPacks('uid-batch').map(pack => ({ ...pack, lastCheckedAt: undefined })), 'uid-batch');
    return processTrackedSeasonPackFallbacks(config, 'uid-batch', transport);
  };

  // Premier épisode importé seulement : le torrent continue pour les épisodes 2 et 3.
  assert.equal((await run()).cleanedFallbacks.length, 0);
  imported.add(602);
  assert.equal((await run()).cleanedFallbacks.length, 0);
  assert.deepEqual(deleted, []);
  assert.equal(getTrackedSeasonPacks('uid-batch')[0].cleanedUp, false);

  // Tous importés (l'épisode 3 sans identifiant passe par la liste de la série) : le pack est retiré.
  imported.add(603);
  const done = await run();
  assert.equal(done.cleanedFallbacks.length, 1);
  assert.deepEqual(done.removedQueueIds, [91]);
  assert.equal(getTrackedSeasonPacks('uid-batch')[0].cleanedUp, true);
});
