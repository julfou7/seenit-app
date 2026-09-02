import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getStableDownloadRenderKey,
  preferSeenItImagePath,
  selectStableDownloadPosterPath
} from '../src/features/downloads/downloadPosterStability.ts';

test('la clé de rendu reste identique quand l’intention SeenIt devient un téléchargement distant', () => {
  const optimisticKey = getStableDownloadRenderKey({ id: 'opt_avatar', requestId: 'opt_avatar' });
  const remoteKey = getStableDownloadRenderKey({ id: 'radarr_123', requestId: 'opt_avatar' });
  assert.equal(remoteKey, optimisticKey);
});

test('le poster affiché reste celui vu au premier rendu de la fiche', () => {
  let lockedPoster = selectStableDownloadPosterPath(undefined, '/avatar-fiche.jpg');
  lockedPoster = selectStableDownloadPosterPath(lockedPoster, '/avatar-radarr.jpg');
  assert.equal(lockedPoster, '/avatar-fiche.jpg');
});

test('un poster peut être acquis plus tard si aucun visuel initial n’était disponible', () => {
  const lockedPoster = selectStableDownloadPosterPath(undefined, undefined);
  assert.equal(selectStableDownloadPosterPath(lockedPoster, '/avatar-fiche.jpg'), '/avatar-fiche.jpg');
});

test('le visuel SeenIt gagne sur celui du client distant', () => {
  assert.equal(preferSeenItImagePath('/radarr-alternate.jpg', '/fiche-tmdb.jpg'), '/fiche-tmdb.jpg');
  assert.equal(preferSeenItImagePath('/radarr-alternate.jpg', undefined), '/radarr-alternate.jpg');
});

test('SEENIT-IDENTITY-001 rattache un téléchargement SeenIt uniquement par TMDB ID', async () => {
  const { findMatchingShowForDownload } = await import('../src/features/downloads/downloadIdentity.ts');
  const libraryShows = [{ mediaType: 'tv' as const, tmdbId: 218738, tvdbId: 423527, title: 'Dark Matter', posterPath: '/fiche.jpg' }];

  assert.equal(findMatchingShowForDownload({ mediaType: 'tv', tmdbId: 218738, seriesTitle: 'Un autre titre' }, libraryShows)?.posterPath, '/fiche.jpg');
  assert.equal(findMatchingShowForDownload({ mediaType: 'tv', tmdbId: 999999, seriesTitle: 'Dark Matter' }, libraryShows), undefined);
  assert.equal(findMatchingShowForDownload({ mediaType: 'tv', tvdbId: 423527, seriesTitle: 'Dark Matter' }, libraryShows), undefined);
  assert.equal(findMatchingShowForDownload({ mediaType: 'tv', seriesTitle: 'Dark Matter' }, libraryShows), undefined);
});

