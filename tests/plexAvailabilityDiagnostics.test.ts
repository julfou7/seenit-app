import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePlexAvailabilityTraceBatch } from '../src/features/notifications/plexAvailabilityDiagnostics.ts';

test('SEENIT-NOTIFICATION-003 borne et redige les traces de disponibilité Plex', () => {
  const normalized = normalizePlexAvailabilityTraceBatch({
    schemaVersion: 1,
    events: [{
      traceId: '00000000-0000-4000-8000-000000000430',
      stage: 'plex_check',
      outcome: 'not_available_retry',
      attempt: 4,
      timestamp: 1_796_000_000_000,
      uid: 'secret-user',
      token: 'secret-token',
      title: 'Titre privé',
      tmdbId: 123,
      eventKey: 'private-event',
    }],
  });

  assert.deepEqual(normalized, [{
    traceId: '00000000-0000-4000-8000-000000000430',
    stage: 'plex_check',
    outcome: 'not_available_retry',
    attempt: 4,
    timestamp: 1_796_000_000_000,
  }]);
  const serialized = JSON.stringify(normalized);
  assert.doesNotMatch(serialized, /secret-user|secret-token|Titre privé|tmdbId|eventKey/);

  assert.equal(normalizePlexAvailabilityTraceBatch({
    schemaVersion: 1,
    events: [{ traceId: 'bad', stage: 'plex_check', outcome: 'available', attempt: 1, timestamp: 1 }],
  }), null);
  assert.equal(normalizePlexAvailabilityTraceBatch({
    schemaVersion: 1,
    events: Array.from({ length: 121 }, () => ({
      traceId: '00000000-0000-4000-8000-000000000430',
      stage: 'worker',
      outcome: 'started',
      attempt: 1,
      timestamp: 1,
    })),
  }), null);
});
