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

test('findMatchingShowForDownload retrouve la fiche série par tmdbId, tvdbId ou titre normalisé', async () => {
  const { findMatchingShowForDownload } = await import('../src/features/downloads/downloadIdentity.ts');

  const libraryShows = [
    {
      mediaType: 'tv' as const,
      tmdbId: 218738,
      tvdbId: 423527,
      title: 'Dark Matter',
      posterPath: '/dark-matter-fiche-2024.jpg'
    },
    {
      mediaType: 'movie' as const,
      tmdbId: 550,
      title: 'Fight Club',
      posterPath: '/fight-club-fiche.jpg'
    }
  ];

  // 1. Match par tmdbId
  const matchById = findMatchingShowForDownload(
    { mediaType: 'tv', tmdbId: 218738, seriesTitle: 'Dark Matter (2024)' },
    libraryShows
  );
  assert.equal(matchById?.posterPath, '/dark-matter-fiche-2024.jpg');

  // 2. Match par tvdbId
  const matchByTvdb = findMatchingShowForDownload(
    { mediaType: 'tv', tvdbId: 423527 },
    libraryShows
  );
  assert.equal(matchByTvdb?.posterPath, '/dark-matter-fiche-2024.jpg');

  // 3. Match par titre normalisé quand le serveur ne fournit pas de tmdbId
  const matchByTitle = findMatchingShowForDownload(
    { mediaType: 'tv', seriesTitle: 'Dark Matter (S02E01)' },
    libraryShows
  );
  assert.equal(matchByTitle?.posterPath, '/dark-matter-fiche-2024.jpg');

  // 4. L'image retenue pour l'affichage est bien celle de la fiche série et non du client distant
  const remoteDownload = {
    id: 'sonarr_99',
    mediaType: 'tv' as const,
    seriesTitle: 'Dark Matter',
    posterPath: 'http://sonarr.local/api/v3/mediacover/99/poster.jpg'
  };
  const matched = findMatchingShowForDownload(remoteDownload, libraryShows);
  const finalPoster = preferSeenItImagePath(remoteDownload.posterPath, matched?.posterPath);
  assert.equal(finalPoster, '/dark-matter-fiche-2024.jpg');
});

