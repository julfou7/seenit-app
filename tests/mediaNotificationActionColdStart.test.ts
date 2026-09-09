import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createMediaNotificationColdStartBuffer,
  type MediaNotificationActionPayload,
} from '../src/features/notifications/mediaNotificationActionColdStart.ts';

const mainSource = readFileSync('src/main.tsx', 'utf8');

test('issue #106 charge le buffer de clic avant App et Firebase', () => {
  const bufferImport = mainSource.indexOf("from './features/notifications/mediaNotificationActionColdStart.ts'");
  const appImport = mainSource.indexOf("from './App.tsx'");
  const firebaseImport = mainSource.indexOf("from './lib/firebase.ts'");
  assert.ok(bufferImport >= 0 && bufferImport < appImport);
  assert.ok(bufferImport < firebaseImport);
  assert.match(mainSource, /disposeMediaNotificationColdStartReplay/);
});

test('issue #106 rejoue exactement une fois un clic média reçu au démarrage à froid', () => {
  const replayed: MediaNotificationActionPayload[] = [];
  const buffer = createMediaNotificationColdStartBuffer(payload => replayed.push(payload));

  assert.equal(buffer.capture({
    type: 'NAVIGATE_SHOW',
    showId: 'movie-123',
    tmdbId: 123,
    mediaType: 'movie',
  }), true, 'le clic froid doit être intercepté avant le listener React');
  assert.equal(buffer.pendingCount(), 1);

  buffer.flush();
  assert.equal(replayed.length, 1);
  assert.equal(replayed[0].type, 'NAVIGATE_SHOW');
  assert.equal(replayed[0].showId, 'movie-123');
  assert.equal(replayed[0].tmdbId, 123);
  assert.equal(replayed[0].__seenitMediaActionReplay, true);

  buffer.flush();
  assert.equal(replayed.length, 1, 'un second flush ne doit jamais rejouer le clic');
});

test('issue #106 ne retarde pas les clics chauds ni les pushes hors média', () => {
  const replayed: MediaNotificationActionPayload[] = [];
  const buffer = createMediaNotificationColdStartBuffer(payload => replayed.push(payload));

  assert.equal(buffer.capture({ type: 'APP_UPDATE_AVAILABLE', version: '1.4.126' }), false);
  buffer.flush();
  assert.equal(buffer.capture({ type: 'NAVIGATE_SHOW', showId: 'movie-456' }), false);
  assert.equal(replayed.length, 0);
});

test('issue #106 préserve aussi l’action rapide épisode pendant le démarrage', () => {
  const replayed: MediaNotificationActionPayload[] = [];
  const buffer = createMediaNotificationColdStartBuffer(payload => replayed.push(payload));

  assert.equal(buffer.capture({
    type: 'QUICK_ACTION_MARK_WATCHED',
    showId: 'tv-42',
    mediaType: 'tv',
    season: 2,
    episode: 3,
  }), true);
  buffer.flush();

  assert.deepEqual(replayed.map(payload => ({
    type: payload.type,
    season: payload.season,
    episode: payload.episode,
    replay: payload.__seenitMediaActionReplay,
  })), [{
    type: 'QUICK_ACTION_MARK_WATCHED',
    season: 2,
    episode: 3,
    replay: true,
  }]);
});
