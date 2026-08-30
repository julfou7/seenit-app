import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getPhysicalDownloadId,
  getPhysicalDownloadIds,
  hasConflictingStrongPhysicalIds,
  mergeDownloadIdAliases,
  normalizeDownloadClientId,
  sameLegacyPhysicalTransfer,
  samePhysicalDownload
} from '../src/features/downloads/downloadIdentity.ts';

test('normalise le hash qBittorrent et le downloadId *Arr sans dépendre de la casse', () => {
  assert.equal(normalizeDownloadClientId(' ABCDEF123 '), 'abcdef123');
  assert.equal(normalizeDownloadClientId('qbit_ABCDEF123'), 'abcdef123');
  assert.equal(normalizeDownloadClientId('urn:btih:ABCDEF123'), 'abcdef123');
});

test('rattache le même torrent physique malgré des titres localisés différents', () => {
  const radarr = {
    id: 'radarr_42',
    downloadId: 'ABCDEF123'
  };
  const qbitPersisted = {
    id: 'qbit_abcdef123'
  };

  assert.equal(getPhysicalDownloadId(radarr), 'abcdef123');
  assert.equal(getPhysicalDownloadId(qbitPersisted), 'abcdef123');
  assert.equal(samePhysicalDownload(radarr, qbitPersisted), true);
});

test('deux hashes différents restent deux téléchargements physiques distincts', () => {
  assert.equal(
    samePhysicalDownload(
      { downloadId: 'aaaaaaaa' },
      { id: 'qbit_bbbbbbbb' }
    ),
    false
  );
});


test('rattache un ancien doublon sans hash grâce à la release et la taille', () => {
  const arr = {
    mediaType: 'movie',
    title: 'Disclosure Day',
    releaseTitle: 'Disclosure.Day.2026.1080p.BluRay',
    size: 4_400_000_000
  };
  const persistedQbit = {
    mediaType: 'movie',
    title: 'Disclosure.Day.2026.1080p.BluRay-GROUP',
    releaseTitle: 'Disclosure.Day.2026.1080p.BluRay-GROUP',
    size: 4_410_000_000
  };

  assert.equal(sameLegacyPhysicalTransfer(arr, persistedQbit), true);
});

test('ne fusionne pas deux releases de tailles différentes', () => {
  assert.equal(
    sameLegacyPhysicalTransfer(
      { mediaType: 'movie', releaseTitle: 'Film.1080p', size: 4_000_000_000 },
      { mediaType: 'movie', releaseTitle: 'Film.1080p', size: 8_000_000_000 }
    ),
    false
  );
});


test('rattache un torrent hybride grâce aux alias infohash v1/v2', () => {
  const v1 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const v2 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const arr = { id: 'radarr_77', downloadId: v1 };
  const qbit = {
    id: 'qbit_cccccccccccccccccccccccccccccccccccccccc',
    downloadId: 'cccccccccccccccccccccccccccccccccccccccc',
    downloadIdAliases: [v1, v2]
  };

  assert.equal(samePhysicalDownload(arr, qbit), true);
  assert.deepEqual(new Set(getPhysicalDownloadIds(qbit)), new Set([
    'cccccccccccccccccccccccccccccccccccccccc',
    v1,
    v2
  ]));
});

test('conserve les alias appris entre deux polls même si *Arr change temporairement de downloadId', () => {
  const learned = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const transient = 'not-a-real-hash';
  const aliases = mergeDownloadIdAliases(
    { id: 'radarr_42', downloadId: learned },
    { id: 'radarr_42', downloadId: transient }
  );

  assert.ok(aliases.includes(learned));
  assert.ok(aliases.includes(transient));
  assert.equal(
    samePhysicalDownload(
      { id: 'radarr_42', downloadId: transient, downloadIdAliases: aliases },
      { id: `qbit_${learned}` }
    ),
    true
  );
});

test('deux vrais infohash différents ne sont jamais fusionnés par le fallback release + taille', () => {
  const a = {
    id: 'radarr_1',
    downloadId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    mediaType: 'movie',
    releaseTitle: 'Film.2026.2160p.WEB-DL',
    size: 10_000_000_000
  };
  const b = {
    id: 'qbit_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    downloadId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    mediaType: 'movie',
    releaseTitle: 'Film.2026.2160p.WEB-DL',
    size: 10_000_000_000
  };

  assert.equal(hasConflictingStrongPhysicalIds(a, b), true);
  assert.equal(sameLegacyPhysicalTransfer(a, b), false);
});
