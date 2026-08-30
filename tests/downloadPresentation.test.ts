import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getStableDownloadRenderKey,
  selectStableDownloadPosterPath
} from '../src/features/downloads/downloadPresentation.ts';
import { preferSeenItImagePath } from '../src/features/downloads/downloadReconciliation.ts';

test('la clé de rendu reste identique quand l’intention SeenIt devient un téléchargement distant', () => {
  const optimisticKey = getStableDownloadRenderKey({
    id: 'opt_avatar',
    requestId: 'opt_avatar'
  });
  const remoteKey = getStableDownloadRenderKey({
    id: 'radarr_123',
    requestId: 'opt_avatar'
  });

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

test('les métadonnées visuelles SeenIt gagnent sur celles du client distant', () => {
  assert.equal(
    preferSeenItImagePath('/radarr-alternate.jpg', '/fiche-tmdb.jpg'),
    '/fiche-tmdb.jpg'
  );
  assert.equal(preferSeenItImagePath('/radarr-alternate.jpg', undefined), '/radarr-alternate.jpg');
});
