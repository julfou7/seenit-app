import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDownloadWebhookPresentation,
  PLEX_AVAILABILITY_CHECK_PUSH_TYPE
} from '../src/features/downloads/downloadWebhookNotification.ts';

test('SEENIT-NOTIFICATION-003 réserve la vérification Plex au signal Android capable', () => {
  const radarr = buildDownloadWebhookPresentation('radarr', {
    eventType: 'Download',
    downloadId: 'abc123',
    movie: { title: 'Dune', tmdbId: 438631 }
  });
  assert.equal(radarr.notification.title, 'Dune');
  assert.equal(radarr.notification.body, 'Import terminé');
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
  assert.equal(unresolved.notification.title, 'Titre sans identité');
  assert.equal(unresolved.notification.body, 'Import terminé');
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

test('SEENIT-NOTIFICATION-003 ne transforme pas une saison absente en saison 0', () => {
  for (const seasonNumber of [null, '', ' ', undefined, false]) {
    const payload = buildDownloadWebhookPresentation('sonarr', {
      eventType: 'Download',
      downloadId: 'missing-season',
      series: { title: 'Severance', tmdbId: 95396 },
      episodes: [{ seasonNumber, episodeNumber: 1 }]
    });
    assert.equal(payload.plexAvailabilityData?.season, undefined);
    assert.equal(payload.plexAvailabilityData?.episode, undefined);
  }
});

test('SEENIT-NOTIFICATION-003 préserve la saison 0 des épisodes spéciaux', () => {
  const special = buildDownloadWebhookPresentation('sonarr', {
    eventType: 'Download',
    downloadId: 'special-001',
    series: { title: 'Severance', tmdbId: 95396 },
    episodes: [{ seasonNumber: '0', episodeNumber: 1 }]
  });
  assert.equal(special.plexAvailabilityData?.season, '0');
  assert.equal(special.plexAvailabilityData?.episode, '1');
  assert.match(special.plexAvailabilityData?.eventKey || '', /s0e1$/);
});
