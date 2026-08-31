import assert from 'node:assert/strict';
import test from 'node:test';
import {
  inferTechnicalTvScope,
  normalizeUnresolvedQbitScope,
  shouldSuppressUnresolvedQbit
} from '../src/features/downloads/downloadTransientVisibility.ts';
import type { LiveDownloadItem } from '../src/services/sonarrRadarr.ts';

const now = 1_800_000_000_000;

function item(patch: Partial<LiveDownloadItem>): LiveDownloadItem {
  return {
    id: 'x',
    mediaType: 'movie',
    title: 'x',
    size: 1,
    sizeleft: 1,
    progress: 10,
    status: 'downloading',
    statusText: 'Téléchargement',
    addedAt: now,
    ...patch
  };
}

test('le scope TV technique est extrait sans utiliser le nom de la série', () => {
  assert.deepEqual(inferTechnicalTvScope('Whatever.Show.S02E07.1080p'), { seasonNumber: 2, episodeNumber: 7 });
  assert.deepEqual(inferTechnicalTvScope('Pack.S03.2160p'), { seasonNumber: 3, episodeNumber: undefined });
  assert.deepEqual(inferTechnicalTvScope('Show.4x09.MULTI'), { seasonNumber: 4, episodeNumber: 9 });
  assert.equal(inferTechnicalTvScope('Movie.2026.1080p'), null);
});

test('un qBit SxxEyy non résolu devient transitoirement une série', () => {
  const normalized = normalizeUnresolvedQbitScope(item({
    id: 'qbit_abc',
    downloadClient: 'qBittorrent',
    title: 'Daredevil.S01E05.1080p',
    releaseTitle: 'Daredevil.S01E05.1080p'
  }));
  assert.equal(normalized.mediaType, 'tv');
  assert.equal(normalized.seasonNumber, 1);
  assert.equal(normalized.episodeNumber, 5);
});

test('un qBit unique reste visible afin de conserver la progression live', () => {
  const pending = item({
    id: 'opt_movie',
    requestId: 'opt_movie',
    isOptimistic: true,
    tmdbId: 123,
    movieTitle: 'Protector',
    quality: '1080p',
    addedAt: now - 2_000,
    status: 'searching'
  });
  const qbit = item({
    id: 'qbit_hash',
    downloadClient: 'qBittorrent',
    title: 'Protector.2026.MULTI.VFF.1080p',
    releaseTitle: 'Protector.2026.MULTI.VFF.1080p',
    quality: '1080p',
    addedAt: now
  });

  assert.equal(shouldSuppressUnresolvedQbit(qbit, [pending], now), false);
});

test('un qBit résolu ou de résolution différente reste visible', () => {
  const pending = item({
    id: 'opt_movie',
    isOptimistic: true,
    tmdbId: 123,
    quality: '1080p',
    addedAt: now - 1_000,
    status: 'searching'
  });
  const resolved = item({
    id: 'qbit_hash',
    downloadClient: 'qBittorrent',
    tmdbId: 123,
    quality: '1080p',
    addedAt: now
  });
  const differentQuality = item({
    id: 'qbit_other',
    downloadClient: 'qBittorrent',
    quality: '4K',
    releaseTitle: 'Movie.2160p',
    addedAt: now
  });

  assert.equal(shouldSuppressUnresolvedQbit(resolved, [pending], now), false);
  assert.equal(shouldSuppressUnresolvedQbit(differentQuality, [pending], now), false);
});

test('deux intentions simultanées masquent le qBit ambigu sans corrélation par titre', () => {
  const pendingA = item({ id: 'opt_a', isOptimistic: true, tmdbId: 1, quality: '1080p', addedAt: now - 2_000, status: 'searching' });
  const pendingB = item({ id: 'opt_b', isOptimistic: true, tmdbId: 2, quality: '1080p', addedAt: now - 1_000, status: 'searching' });
  const qbit = item({ id: 'qbit_hash', downloadClient: 'qBittorrent', title: 'Un.Nom.Brut.1080p', quality: '1080p', addedAt: now });

  assert.equal(shouldSuppressUnresolvedQbit(qbit, [pendingA, pendingB], now), true);
  assert.equal(qbit.tmdbId, undefined);
});

test('deux épisodes simultanés de scopes différents ne rendent pas le qBit ambigu', () => {
  const ep1 = item({
    id: 'opt_ep1', mediaType: 'tv', isOptimistic: true, tmdbId: 10,
    seasonNumber: 1, episodeNumber: 1, quality: '1080p', addedAt: now - 2_000, status: 'searching'
  });
  const ep2 = item({
    id: 'opt_ep2', mediaType: 'tv', isOptimistic: true, tmdbId: 10,
    seasonNumber: 1, episodeNumber: 2, quality: '1080p', addedAt: now - 1_000, status: 'searching'
  });
  const qbit = normalizeUnresolvedQbitScope(item({
    id: 'qbit_ep1', mediaType: 'movie', downloadClient: 'qBittorrent',
    title: 'Show.S01E01.1080p', releaseTitle: 'Show.S01E01.1080p', quality: '1080p', addedAt: now
  }));

  assert.equal(qbit.mediaType, 'tv');
  assert.equal(shouldSuppressUnresolvedQbit(qbit, [ep1, ep2], now), false);
});
