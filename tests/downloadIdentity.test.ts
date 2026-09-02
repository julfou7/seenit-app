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
  sameDownloadRequest,
  sameLegacyPhysicalTransfer,
  samePhysicalDownload,
  sameTransferPath
} from '../src/features/downloads/downloadIdentity.ts';
import {
  findUniqueRecentOptimisticAttachments,
  mergeLateOptimisticMetadata
} from '../src/features/downloads/downloadReconciliation.ts';
import { truncateDownloadProgressPercent } from '../src/features/downloads/downloadPresentation.ts';

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


test('la synchro partagée rattache un titre français à l’unique torrent anglais sans comparer les noms', () => {
  const now = 1_700_000_320_000;
  const requests = [{
    id: 'opt_robin',
    requestId: 'opt_robin',
    isOptimistic: true,
    mediaType: 'movie' as const,
    tmdbId: 1181198,
    title: 'On l’appelait Robin des Bois',
    quality: '1080p',
    addedAt: now - 12_000,
    size: 0,
    sizeleft: 0,
    progress: 0,
    status: 'searching',
    statusText: 'Recherche en cours'
  }];
  const remotes = [{
    id: 'qbit_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    mediaType: 'movie' as const,
    title: 'The.Death.Of.Robin.Hood.2026.1080p.WEB-DL',
    releaseTitle: 'The.Death.Of.Robin.Hood.2026.1080p.WEB-DL',
    quality: '1080p WEB-DL',
    addedAt: now - 6_000,
    size: 2_300_000_000,
    sizeleft: 2_300_000_000,
    progress: 0,
    status: 'downloading',
    statusText: 'Téléchargement en cours'
  }];

  assert.deepEqual(
    findUniqueRecentOptimisticAttachments(requests, remotes, now),
    [{ requestIndex: 0, remoteIndex: 0 }]
  );
});

test('la synchro partagée refuse le rattachement transitoire dès que deux torrents sont plausibles', () => {
  const now = 1_700_000_420_000;
  const request = {
    id: 'opt_robin',
    isOptimistic: true,
    mediaType: 'movie' as const,
    tmdbId: 1181198,
    title: 'On l’appelait Robin des Bois',
    quality: '1080p',
    addedAt: now - 10_000,
    size: 0,
    sizeleft: 0,
    progress: 0,
    status: 'searching',
    statusText: 'Recherche en cours'
  };
  const remotes = ['a', 'b'].map((suffix, index) => ({
    id: `qbit_${suffix.repeat(40)}`,
    mediaType: 'movie' as const,
    title: `Release ${index}`,
    quality: '1080p WEB-DL',
    addedAt: now - 5_000 + index,
    size: 2_300_000_000,
    sizeleft: 2_300_000_000,
    progress: 0,
    status: 'downloading',
    statusText: 'Téléchargement en cours'
  }));

  assert.deepEqual(findUniqueRecentOptimisticAttachments([request], remotes, now), []);
});


test('corrèle *Arr et qBittorrent par la demande SeenIt même si leurs IDs distants divergent', () => {
  const requestId = 'opt_1700000000000_test';
  assert.equal(sameDownloadRequest(
    { requestId, downloadId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    { requestId, downloadId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }
  ), true);
});

test('une mutation optimiste tardive ne peut jamais figer la télémétrie distante', () => {
  const remote = {
    id: 'radarr_42',
    requestId: 'opt_42',
    mediaType: 'movie' as const,
    title: 'Michael',
    size: 4_800_000_000,
    sizeleft: 3_000_000_000,
    progress: 37.5,
    speedBytesPerSec: 8_000_000,
    speedFormatted: '7.6 Mo/s',
    timeleft: '6m 15s',
    timeleftSeconds: 375,
    status: 'downloading',
    statusText: 'Téléchargement 37.5%',
    isOptimistic: false
  };
  const lateOptimistic = {
    id: 'opt_42',
    requestId: 'opt_42',
    mediaType: 'movie' as const,
    title: 'Michael',
    tmdbId: 1234,
    posterPath: '/poster.jpg',
    size: 0,
    sizeleft: 0,
    progress: 0,
    status: 'searching',
    statusText: 'Recherche en cours',
    isOptimistic: true
  };

  const merged = mergeLateOptimisticMetadata(remote, lateOptimistic);
  assert.equal(merged.progress, 37.5);
  assert.equal(merged.status, 'downloading');
  assert.equal(merged.speedBytesPerSec, 8_000_000);
  assert.equal(merged.timeleftSeconds, 375);
  assert.equal(merged.tmdbId, 1234);
  assert.equal(merged.posterPath, '/poster.jpg');
  assert.equal(merged.isOptimistic, false);
});

test('la fusion conserve le titre SeenIt localisé tout en gardant la télémétrie distante', () => {
  const remote = {
    id: 'radarr_robin',
    requestId: 'opt_robin',
    mediaType: 'movie' as const,
    title: 'The Death Of Robin Hood',
    movieTitle: 'The Death Of Robin Hood',
    tmdbId: 1181198,
    size: 2_300_000_000,
    sizeleft: 1_200_000_000,
    progress: 47.8,
    speedBytesPerSec: 4_000_000,
    status: 'downloading',
    statusText: 'Téléchargement en cours',
    isOptimistic: false
  };
  const seenItRequest = {
    id: 'opt_robin',
    requestId: 'opt_robin',
    mediaType: 'movie' as const,
    title: 'On l’appelait Robin des Bois',
    tmdbId: 1181198,
    posterPath: '/robin.jpg',
    size: 0,
    sizeleft: 0,
    progress: 0,
    status: 'searching',
    statusText: 'Recherche en cours',
    isOptimistic: true
  };

  const merged = mergeLateOptimisticMetadata(remote, seenItRequest);
  assert.equal(merged.movieTitle, 'On l’appelait Robin des Bois');
  assert.equal(merged.progress, 47.8);
  assert.equal(merged.speedBytesPerSec, 4_000_000);
  assert.equal(merged.status, 'downloading');
});

test('tronque le pourcentage affiché sans modifier la précision interne', () => {
  assert.equal(truncateDownloadProgressPercent(0), 0);
  assert.equal(truncateDownloadProgressPercent(0.9), 0);
  assert.equal(truncateDownloadProgressPercent(42.9), 42);
  assert.equal(truncateDownloadProgressPercent(99.99), 99);
  assert.equal(truncateDownloadProgressPercent(100.4), 100);
  assert.equal(truncateDownloadProgressPercent(-4.2), 0);
});


test('les GET Android de suivi sont uniques et explicitement non cachables', async () => {
  const { buildFreshGetUrl, buildNoCacheHeaders } = await import('../src/features/downloads/downloadNetwork.ts');
  assert.equal(
    buildFreshGetUrl('https://example.test/api/v3/queue?page=1', 12345),
    'https://example.test/api/v3/queue?page=1&_seenitFresh=12345'
  );
  assert.equal(
    buildFreshGetUrl('https://example.test/api/v2/torrents/info', 67890),
    'https://example.test/api/v2/torrents/info?_seenitFresh=67890'
  );
  const headers = buildNoCacheHeaders({ 'X-Api-Key': 'abc', 'cache-control': 'public, max-age=3600' });
  assert.equal(headers['X-Api-Key'], 'abc');
  assert.equal(headers['Cache-Control'], 'no-cache, no-store, max-age=0');
  assert.equal(headers.Pragma, 'no-cache');
  assert.equal(headers.Expires, '0');
});

test('canAttachRecentOptimisticRequest rattache une demande optimiste même si tvdbId diffère mais que le titre concorde', () => {
  const now = 1_700_000_000_000;
  const request = {
    id: 'req_123',
    requestId: 'req_123',
    mediaType: 'tv' as const,
    seriesTitle: 'Dark Matter',
    title: 'Dark Matter (S02E01)',
    tmdbId: 218738,
    tvdbId: 423527,
    seasonNumber: 2,
    episodeNumber: 1,
    addedAt: now - 3_000,
    isOptimistic: true
  };

  const remote = {
    id: 'sonarr_55',
    mediaType: 'tv' as const,
    seriesTitle: 'Dark Matter',
    title: 'Dark Matter - S02E01 - Episode 1',
    // Sonarr pointe parfois sur un ID TVDB alternatif
    tvdbId: 292115,
    seasonNumber: 2,
    episodeNumber: 1,
    addedAt: now - 1_000,
    isOptimistic: false
  };

  assert.equal(canAttachRecentOptimisticRequest(request, remote, now), true);
});

test('canAttachRecentOptimisticRequest ne rattache pas deux séries aux titres différents même si les identifiants sont absents', () => {
  const now = 1_700_000_000_000;
  const request = {
    id: 'req_123',
    mediaType: 'tv' as const,
    seriesTitle: 'Dark Matter',
    title: 'Dark Matter (S02E01)',
    seasonNumber: 2,
    episodeNumber: 1,
    addedAt: now - 3_000,
    isOptimistic: true
  };

  const remote = {
    id: 'sonarr_99',
    mediaType: 'tv' as const,
    seriesTitle: 'Severance',
    title: 'Severance - S02E01',
    seasonNumber: 2,
    episodeNumber: 1,
    addedAt: now - 1_000,
    isOptimistic: false
  };

  assert.equal(canAttachRecentOptimisticRequest(request, remote, now), false);
});

