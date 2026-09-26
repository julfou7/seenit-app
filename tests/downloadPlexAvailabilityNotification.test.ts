import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDownloadWebhookPresentation,
  PLEX_AVAILABILITY_CHECK_PUSH_TYPE
} from '../src/features/downloads/downloadWebhookNotification.ts';

test('SEENIT-NOTIFICATION-003 distingue l’import Arr de la disponibilité Plex', () => {
  const radarr = buildDownloadWebhookPresentation('radarr', {
    eventType: 'Download',
    downloadId: 'abc123',
    movie: { title: 'Dune', tmdbId: 438631 }
  });
  assert.equal(radarr.notification.title, 'Import terminé 🍿');
  assert.match(radarr.notification.body, /Plex s’actualise/);
  assert.doesNotMatch(radarr.notification.body, /disponible dans Plex|prêt et disponible/i);
  assert.equal(radarr.plexAvailabilityData?.type, PLEX_AVAILABILITY_CHECK_PUSH_TYPE);
  assert.equal(radarr.plexAvailabilityData?.tmdbId, '438631');
  assert.equal(radarr.plexAvailabilityData?.mediaType, 'movie');

  const sonarr = buildDownloadWebhookPresentation('sonarr', {
    eventType: 'Download',
    downloadId: 'def456',
    series: { title: 'Severance', tmdbId: 95396 },
    episodes: [{ seasonNumber: 2, episodeNumber: 8 }]
  });
  assert.equal(sonarr.plexAvailabilityData?.tmdbId, '95396');
  assert.equal(sonarr.plexAvailabilityData?.season, '2');
  assert.equal(sonarr.plexAvailabilityData?.episode, '8');

  const unresolved = buildDownloadWebhookPresentation('radarr', {
    eventType: 'Download',
    movie: { title: 'Titre sans identité' }
  });
  assert.equal(unresolved.plexAvailabilityData, null);
  assert.match(unresolved.notification.body, /importé/i);
});

test('SEENIT-NOTIFICATION-003 ne transforme jamais le titre en identité Plex', () => {
  const first = buildDownloadWebhookPresentation('radarr', {
    eventType: 'Download',
    movie: { title: 'Même titre', tmdbId: 10 }
  });
  const second = buildDownloadWebhookPresentation('radarr', {
    eventType: 'Download',
    movie: { title: 'Même titre', tmdbId: 20 }
  });
  assert.equal(first.plexAvailabilityData?.tmdbId, '10');
  assert.equal(second.plexAvailabilityData?.tmdbId, '20');
  assert.notEqual(first.plexAvailabilityData?.eventKey, second.plexAvailabilityData?.eventKey);
});
