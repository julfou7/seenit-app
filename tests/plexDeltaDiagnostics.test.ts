import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  buildPlexDeltaDiagnosticLines,
  sanitizePlexSyncWatchEvidence
} from '../src/features/plex/plexWatchEvidence.ts';

test('SEENIT-PLEX-007 détaille la baseline, le snapshot courant et le verrou du non vu DELTA', () => {
  const payload = sanitizePlexSyncWatchEvidence({
    history: [
      {
        type: 'movie',
        sourceKind: 'library-watched',
        serverId: 'server-abcdefgh1234',
        ratingKey: '321',
        Guid: [{ id: 'tmdb://1375646' }]
      },
      {
        type: 'movie',
        sourceKind: 'pms-history',
        serverId: 'server-abcdefgh1234',
        ratingKey: '999'
      }
    ],
    watchlist: [],
    libraryWatchStates: [],
    stats: {
      deltaWatchedSnapshotItems: 3,
      deltaWatchedSnapshotServers: 1,
      deltaWatchedSnapshotSkippedServers: 1,
      deltaWatchedSnapshotIncompleteServers: 0,
      deltaPreviousLocatorItems: 4,
      deltaPreviousCanonicalLocatorItems: 4,
      deltaCurrentLocatorItems: 3,
      deltaCurrentCanonicalLocatorItems: 3,
      deltaUnresolvedWatchedItems: 0,
      deltaMissingUnwatchCandidates: 0,
      deltaBlockedUnwatchCandidates: 0,
      deltaRecheckedUnwatchCandidates: 0,
      deltaExplicitUnwatchItems: 0
    },
    integrity: {
      deltaWatchedSnapshotComplete: false,
      deltaWatchedSnapshotServers: 1
    }
  });

  const lines = payload.deltaDiagnostics as string[];
  assert.ok(Array.isArray(lines));
  assert.ok(lines.some(line => /précédent=4 locator\(s\).*courant=3 locator\(s\).*écart brut=1/.test(line)));
  assert.ok(lines.some(line => /GARDE DESTRUCTIVE.*FERMÉE/.test(line)));
  assert.ok(lines.some(line => /1 disparition\(s\) brute\(s\).*0 candidat backend/.test(line)));
  assert.ok(lines.some(line => /CURRENT 1\/1.*ratingKey=321.*tmdb:1375646/.test(line)));
  assert.ok(lines.some(line => /États non vu reçus • 0/.test(line)));
});

test('SEENIT-PLEX-007 trace les watched=false reçus sans exposer URL, token ou UID', () => {
  const lines = buildPlexDeltaDiagnosticLines({
    history: [{
      type: 'episode',
      sourceKind: 'library-watched',
      serverId: 'machine-1234567890abcdef',
      ratingKey: '456',
      parentIndex: 2,
      index: 5,
      grandparentGuids: [{ id: 'tvdb://9876' }]
    }],
    libraryWatchStates: [{
      mediaType: 'episode',
      tmdbId: 1234,
      seasonNumber: 2,
      episodeNumber: 5,
      watched: false,
      serverId: 'machine-1234567890abcdef'
    }],
    stats: {
      deltaWatchedSnapshotItems: 1,
      deltaWatchedSnapshotServers: 1,
      deltaWatchedSnapshotSkippedServers: 0,
      deltaWatchedSnapshotIncompleteServers: 0,
      deltaPreviousLocatorItems: 2,
      deltaPreviousCanonicalLocatorItems: 2,
      deltaCurrentLocatorItems: 1,
      deltaCurrentCanonicalLocatorItems: 1,
      deltaUnresolvedWatchedItems: 0,
      deltaMissingUnwatchCandidates: 1,
      deltaBlockedUnwatchCandidates: 0,
      deltaRecheckedUnwatchCandidates: 1,
      deltaExplicitUnwatchItems: 1
    },
    integrity: { deltaWatchedSnapshotComplete: true }
  });

  assert.ok(lines.some(line => /WATCHED_FALSE 1\/1.*tmdb=1234/.test(line)));
  assert.doesNotMatch(lines.join('\n'), /https?:\/\//i);
  assert.doesNotMatch(lines.join('\n'), /x-plex-token|bearer\s|authorization/i);
  assert.doesNotMatch(lines.join('\n'), /machine-1234567890abcdef/);
});

test('SEENIT-PLEX-007 la PWA écrit chaque ligne du diagnostic backend dans AppLog', () => {
  const source = fs.readFileSync(new URL('../src/lib/apiAuth.ts', import.meta.url), 'utf8');
  assert.match(source, /deltaDiagnostics/);
  assert.match(source, /\[Plex Delta Debug\]/);
  assert.match(source, /response\.clone\(\)\.json\(\)/);
});
