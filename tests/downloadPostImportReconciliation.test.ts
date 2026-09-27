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
        sourceTitle: 'Release.A.1080p'
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
    /if \(serverMatch\) \{[\s\S]*?void removeSharedDownloadRequest\(optimistic\);[\s\S]*?continue;/
  );
  assert.match(
    source,
    /historyOutcome\.state === 'completed'[\s\S]*?void removeSharedDownloadRequest\(oldItem\);[\s\S]*?isOptimistic: false/
  );
  assert.match(
    source,
    /historyOutcome\.state === 'failed'[\s\S]*?void removeSharedDownloadRequest\(oldItem\);[\s\S]*?isOptimistic: false/
  );
  assert.match(
    source,
    /shouldResolveMissingDownloadFromHistory\(oldItem, historyCheckNow\)/
  );
});
