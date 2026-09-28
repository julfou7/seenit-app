import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  resolveDownloadHistoryOutcome,
  shouldResolveMissingDownloadFromHistory,
  type DownloadHistorySnapshot
} from '../src/features/downloads/downloadHistoryPolicy.ts';
import type { LiveDownloadItem } from '../src/services/sonarrRadarr.ts';

const now = Date.parse('2026-09-27T21:35:00Z');

function movieIntent(patch: Partial<LiveDownloadItem> = {}): LiveDownloadItem {
  return {
    id: 'opt_one_last_shot',
    requestId: 'opt_one_last_shot',
    mediaType: 'movie',
    title: 'One Last Shot',
    movieTitle: 'One Last Shot',
    tmdbId: 990001,
    releaseTitle: 'One Last Shot',
    size: 0,
    sizeleft: 0,
    progress: 0,
    status: 'searching',
    statusText: 'Recherche en cours',
    addedAt: now - 60_000,
    isOptimistic: true,
    ...patch
  };
}

function snapshot(records: unknown[]): DownloadHistorySnapshot {
  return {
    checkedAt: now,
    sonarr: { configured: false, ok: false, records: [] },
    radarr: { configured: true, ok: true, records }
  };
}

function tvSnapshot(records: unknown[]): DownloadHistorySnapshot {
  return {
    checkedAt: now,
    sonarr: { configured: true, ok: true, records },
    radarr: { configured: false, ok: false, records: [] }
  };
}

function tvIntent(patch: Partial<LiveDownloadItem> = {}): LiveDownloadItem {
  return {
    ...movieIntent(),
    id: 'opt_exact_episode',
    requestId: 'opt_exact_episode',
    mediaType: 'tv',
    title: 'Exact Show',
    seriesTitle: 'Exact Show',
    movieTitle: undefined,
    tmdbId: 990002,
    seasonNumber: 2,
    episodeNumber: 8,
    ...patch
  };
}

test('SEENIT-DOWNLOAD-010 clôt une intention optimiste depuis un import Arr exact même si la queue a disparu', () => {
  const outcome = resolveDownloadHistoryOutcome(
    movieIntent(),
    snapshot([
      {
        eventType: 'downloadFolderImported',
        date: '2026-09-27T21:34:45Z',
        downloadId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        movie: { tmdbId: 990001 },
        sourceTitle: 'Totally.Different.Release.2026.1080p.WEB-DL',
        quality: { quality: { name: 'WEBDL-1080p' } }
      }
    ])
  );

  assert.equal(outcome.state, 'completed');
  assert.equal(outcome.quality, '1080p WEB-DL');
});

test('SEENIT-DOWNLOAD-010 refuse deux imports canoniques concurrents sans preuve physique', () => {
  const outcome = resolveDownloadHistoryOutcome(
    movieIntent(),
    snapshot([
      {
        eventType: 'downloadFolderImported',
        date: '2026-09-27T21:34:40Z',
        downloadId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        movie: { tmdbId: 990001 },
        sourceTitle: 'One Last Shot'
      },
      {
        eventType: 'downloadFolderImported',
        date: '2026-09-27T21:34:50Z',
        downloadId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        movie: { tmdbId: 990001 },
        sourceTitle: 'Release.B.1080p'
      }
    ])
  );

  assert.equal(outcome.state, 'unknown');
});

test('SEENIT-DOWNLOAD-010 exige chaque composante du scope TV dans l’historique', () => {
  const baseRecord = {
    eventType: 'downloadFolderImported',
    date: '2026-09-27T21:34:45Z',
    series: { tmdbId: 990002 }
  };

  assert.equal(resolveDownloadHistoryOutcome(
    tvIntent(),
    tvSnapshot([{ ...baseRecord, episode: { seasonNumber: 2 } }])
  ).state, 'unknown');
  assert.equal(resolveDownloadHistoryOutcome(
    tvIntent(),
    tvSnapshot([{ ...baseRecord, episode: { episodeNumber: 8 } }])
  ).state, 'unknown');
  assert.equal(resolveDownloadHistoryOutcome(
    tvIntent(),
    tvSnapshot([{ ...baseRecord, episode: { seasonNumber: 2, episodeNumber: 8 } }])
  ).state, 'completed');
});

test('SEENIT-DOWNLOAD-010 refuse un événement canonique antérieur à la demande', () => {
  const outcome = resolveDownloadHistoryOutcome(
    movieIntent({ addedAt: now - 20_000 }),
    snapshot([{
      eventType: 'downloadFolderImported',
      date: '2026-09-27T21:34:38Z',
      movie: { tmdbId: 990001 }
    }])
  );

  assert.equal(outcome.state, 'unknown');
});

test('SEENIT-DOWNLOAD-010 réconcilie un transfert en erreur disparu avec downloadFailed', () => {
  const hash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const failedItem = movieIntent({
    id: 'radarr_failed',
    downloadId: hash,
    isOptimistic: false,
    status: 'error',
    errorMessage: 'Erreur transitoire de la file'
  });

  assert.equal(shouldResolveMissingDownloadFromHistory(failedItem, now), true);
  assert.equal(shouldResolveMissingDownloadFromHistory({ ...failedItem, isOptimistic: true }, now), false);
  assert.equal(resolveDownloadHistoryOutcome(
    { ...failedItem, addedAt: now - 20_000, downloadId: undefined },
    snapshot([{
      eventType: 'downloadFolderImported',
      date: '2026-09-27T21:34:35Z',
      movie: { tmdbId: 990001 }
    }])
  ).state, 'unknown', 'un succès canonique plus ancien ne doit pas effacer l’erreur de la tentative courante');
  assert.deepEqual(resolveDownloadHistoryOutcome(
    failedItem,
    snapshot([{
      eventType: 'downloadFailed',
      date: '2026-09-27T21:34:45Z',
      downloadId: hash,
      data: { message: 'Import refusé par Radarr' }
    }])
  ), {
    state: 'failed',
    date: Date.parse('2026-09-27T21:34:45Z'),
    message: 'Import refusé par Radarr'
  });
});

test('un ancien import du même TMDB ne clôt jamais une nouvelle intention optimiste', () => {
  const outcome = resolveDownloadHistoryOutcome(
    movieIntent({ addedAt: now - 20_000 }),
    snapshot([
      {
        eventType: 'downloadFolderImported',
        date: '2026-09-27T21:30:00Z',
        downloadId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        movie: { tmdbId: 990001 },
        sourceTitle: 'Old.Release.1080p'
      }
    ])
  );

  assert.equal(outcome.state, 'unknown');
});

test('une intention optimiste refuse un événement terminal sans date exploitable', () => {
  const outcome = resolveDownloadHistoryOutcome(
    movieIntent(),
    snapshot([
      {
        eventType: 'downloadFolderImported',
        downloadId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        movie: { tmdbId: 990001 },
        sourceTitle: 'Undated.Release.1080p'
      }
    ])
  );

  assert.equal(outcome.state, 'unknown');
});

test('une preuve physique exacte reste prioritaire même si le titre de release diffère', () => {
  const hash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const outcome = resolveDownloadHistoryOutcome(
    movieIntent({
      isOptimistic: false,
      id: 'radarr_42',
      downloadId: hash,
      releaseTitle: 'Nom local sans rapport'
    }),
    snapshot([
      {
        eventType: 'downloadFolderImported',
        date: '2026-09-27T21:34:45Z',
        downloadId: hash,
        movie: { tmdbId: 123456 },
        sourceTitle: 'Another.Release.Name.1080p'
      }
    ])
  );

  assert.equal(outcome.state, 'completed');
});

test('une intention optimiste attend brièvement le handoff avant de consulter l’historique', () => {
  assert.equal(
    shouldResolveMissingDownloadFromHistory(movieIntent({ addedAt: now - 2_000 }), now),
    false
  );
  assert.equal(
    shouldResolveMissingDownloadFromHistory(movieIntent({ addedAt: now - 4_000 }), now),
    true
  );
  assert.equal(
    shouldResolveMissingDownloadFromHistory(movieIntent({ tmdbId: undefined, addedAt: now - 20_000 }), now),
    false
  );
});

test('SEENIT-DOWNLOAD-010 retire l’intention Firestore dès le handoff ou la preuve terminale', () => {
  const source = readFileSync('src/store/liveDownloadStoreCore.ts', 'utf8');

  assert.match(
    source,
    /const exactServerHandoffIds = new Set\([\s\S]*?hasExactDownloadHandoffProof\(optimistic, serverItem\)[\s\S]*?serverItems\.forEach\(serverItem =>[\s\S]*?if \(exactServerHandoffIds\.has\(optimistic\.id\)\) \{[\s\S]*?sharedRequestsToRetire\.set\(sharedRequestDocId\(optimistic\), optimistic\);[\s\S]*?continue;/
  );
  assert.match(
    source,
    /historyOutcome\.state === 'completed'[\s\S]*?sharedRequestsToRetire\.set\(sharedRequestDocId\(oldItem\), oldItem\);[\s\S]*?isOptimistic: false/
  );
  assert.match(
    source,
    /historyOutcome\.state === 'failed'[\s\S]*?sharedRequestsToRetire\.set\(sharedRequestDocId\(oldItem\), oldItem\);[\s\S]*?isOptimistic: false/
  );
  assert.match(
    source,
    /shouldResolveMissingDownloadFromHistory\(oldItem, historyCheckNow\)/
  );
  assert.doesNotMatch(
    source,
    /if \(oldItem\.isOptimistic \|\| removedSet\.has\(oldItem\.id\)\) continue;/
  );
  assert.match(
    source,
    /pendingOptimistic\.filter\(item => !historyResolvedOptimisticIds\.has\(item\.id\)\)/
  );
  assert.match(
    source,
    /for \(const latestLocal of latestLocalMutations\) \{\s+if \(historyResolvedOptimisticIds\.has\(latestLocal\.id\)\) continue;/
  );
  assert.match(
    source,
    /if \(existing && !existing\.isOptimistic && patch\.isOptimistic\) \{[\s\S]*?return;/
  );
  assert.match(
    source,
    /for \(const request of sharedRequestsToRetire\.values\(\)\) \{\s+void removeSharedDownloadRequest\(request\);/
  );
});
