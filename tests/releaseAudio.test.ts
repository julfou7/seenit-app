import assert from 'node:assert/strict';
import test from 'node:test';
import { getReleaseAudio } from '../src/features/downloads/releaseAudio.ts';
import { hasActiveDownloadInScope } from '../src/features/downloads/downloadSearchGuard.ts';
import type { LiveDownloadItem } from '../src/services/sonarrRadarr.ts';

test('SEENIT-DOWNLOAD-011 distingue MULTI VFF et MULTI VFQ sans inventer une variante', () => {
  assert.equal(getReleaseAudio('Movie.MULTI.VFF.1080p').label, 'MULTI VFF');
  assert.equal(getReleaseAudio('Movie.MULTI.VFQ.2160p').label, 'MULTI VFQ');
  assert.equal(getReleaseAudio('Movie.MULTI.VFF.VFQ').label, 'MULTI VFF + VFQ');
  assert.equal(getReleaseAudio('Movie.MULTI.FRENCH').label, 'MULTI · variante inconnue');
  assert.equal(getReleaseAudio('Movie.FRENCH').vff, false);
  assert.equal(getReleaseAudio('Movie.MULTIVERS.VFFake').label, undefined);
  assert.equal(getReleaseAudio().label, undefined);
});
test('un transfert actif bloque un autre envoi seulement pour le scope exact', () => {
  const item: LiveDownloadItem = { id: 'active', title: 'Canonique', mediaType: 'tv', tmdbId: 11,
    seasonNumber: 0, episodeNumber: 2, size: 100, sizeleft: 50, progress: 50, status: 'downloading', statusText: 'En cours' };
  assert.equal(hasActiveDownloadInScope([item], { mediaType: 'tv', tmdbId: 11, seasonNumber: 0, episodeNumber: 2 }), true);
  assert.equal(hasActiveDownloadInScope([item], { mediaType: 'tv', tmdbId: 11, seasonNumber: 1 }), false);
  assert.equal(hasActiveDownloadInScope([item], { mediaType: 'movie', tmdbId: 11 }), false);
  assert.equal(hasActiveDownloadInScope([{ ...item, status: 'completed', progress: 100 }], item), false);
});
