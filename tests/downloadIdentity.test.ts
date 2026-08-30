import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getPhysicalDownloadId,
  getPhysicalDownloadIds,
  hasConflictingStrongPhysicalIds,
  canAttachRecentOptimisticRequest,
  mergeDownloadIdAliases,
  normalizeDownloadClientId,
  normalizeQualityLabel,
  sameLegacyPhysicalTransfer,
  samePhysicalDownload,
  sameTransferPath
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


test('normalise de façon stable la qualité Radarr et qBittorrent', () => {
  const radarr = normalizeQualityLabel('Normal.2026.1080p.BluRay.x265', 'BluRay-1080p');
  const qbit = normalizeQualityLabel('Normal.2026.1080p.BluRay.x265');
  assert.equal(radarr, '1080p BluRay');
  assert.equal(qbit, '1080p BluRay');
});

test('normalise 2160p WEB-DL vers le même badge 4K', () => {
  assert.equal(normalizeQualityLabel('Film.2160p.WEB-DL.HDR'), '4K WEB-DL HDR');
  assert.equal(normalizeQualityLabel('Film 4K WEBDL HDR10'), '4K WEB-DL HDR');
});

test('rattache Radarr et qBittorrent par chemin de transfert quand le hash manque', () => {
  assert.equal(sameTransferPath(
    { transferPath: 'D:\\Downloads\\Normal.2026.1080p', size: 10_000_000_000 },
    { transferPath: 'd:/downloads/Normal.2026.1080p/', size: 10_000_000_000 }
  ), true);
});

test('le fallback release accepte un identifiant Arr temporaire non-hash', () => {
  assert.equal(sameLegacyPhysicalTransfer(
    { downloadId: 'radarr-temporary-id', mediaType: 'movie', releaseTitle: 'Normal.2026.1080p.BluRay', size: 10_000_000_000 },
    { mediaType: 'movie', releaseTitle: 'Normal 2026 1080p BluRay x265', size: 10_005_000_000 }
  ), true);
});


test('rattache le titre localisé à l’unique torrent apparu juste après la demande sans utiliser le nom', () => {
  const now = 1_700_000_020_000;
  assert.equal(canAttachRecentOptimisticRequest(
    { isOptimistic: true, mediaType: 'movie', tmdbId: 123, title: 'Le Virtuose', quality: '1080p', addedAt: now - 15_000 },
    { mediaType: 'movie', title: 'Tuner', releaseTitle: 'Tuner.2026.1080p.WEB-DL', quality: '1080p WEB-DL', addedAt: now - 8_000 },
    now
  ), true);
});

test('ne rattache jamais un vieux torrent à une nouvelle demande', () => {
  const now = 1_700_000_120_000;
  assert.equal(canAttachRecentOptimisticRequest(
    { isOptimistic: true, mediaType: 'movie', tmdbId: 123, quality: '1080p', addedAt: now - 5_000 },
    { mediaType: 'movie', quality: '1080p', addedAt: now - 120_000 },
    now
  ), false);
});

test('ne rattache pas une autre résolution pendant la fenêtre transitoire', () => {
  const now = 1_700_000_220_000;
  assert.equal(canAttachRecentOptimisticRequest(
    { isOptimistic: true, mediaType: 'movie', tmdbId: 123, quality: '1080p', addedAt: now - 5_000 },
    { mediaType: 'movie', quality: '4K WEB-DL', addedAt: now - 2_000 },
    now
  ), false);
});
