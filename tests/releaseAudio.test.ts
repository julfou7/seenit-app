import assert from 'node:assert/strict';
import test from 'node:test';
import { getReleaseAudio } from '../src/features/downloads/releaseAudio.ts';
import { hasActiveDownloadInScope } from '../src/features/downloads/downloadSearchGuard.ts';
import type { LiveDownloadItem } from '../src/services/sonarrRadarr.ts';

test('SEENIT-DOWNLOAD-011 dit toujours VFF ou VFQ selon la convention des releases françaises', () => {
  assert.equal(getReleaseAudio('Movie.MULTI.VFF.1080p').label, 'MULTI VFF');
  assert.equal(getReleaseAudio('Movie.MULTI.VFQ.2160p').label, 'MULTI VFQ');
  assert.equal(getReleaseAudio('Movie.MULTI.VFF.VFQ').label, 'MULTI VFF + VFQ');
  // #661 (16/11) : toujours VFF ou VFQ — un doublage québécois est toujours marqué, le reste est la VFF.
  assert.equal(getReleaseAudio('Movie.MULTI.FRENCH').label, 'MULTI VFF');
  assert.equal(getReleaseAudio('Movie.2026.MULTI.1080p.WEB.H264').label, 'MULTI VFF');
  assert.equal(getReleaseAudio('Movie.2026.FRENCH.1080p').label, 'VFF');
  assert.equal(getReleaseAudio('Movie.2026.MULTI.QC.1080p').label, 'MULTI VFQ');
  assert.equal(getReleaseAudio('Movie.2026.MULTI.VF2.1080p').label, 'MULTI VFF + VFQ');
  assert.equal(getReleaseAudio('Movie.2026.MULTI.TRUEFRENCH.VFQ.1080p').label, 'MULTI VFF + VFQ', 'revue Codex #1080');
  assert.equal(getReleaseAudio('Movie.2026.VOSTFR.1080p').label, undefined, 'sous-titres seuls : aucune piste française');
  assert.equal(getReleaseAudio('Movie.2026.1080p.WEB').label, undefined);
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
