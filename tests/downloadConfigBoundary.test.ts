import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeDownloadConfigPatch,
  parseDownloadConfigDocument
} from '../src/features/downloads/downloadConfigBoundary.ts';

test('la frontière Firestore téléchargements ignore les champs et types inconnus', () => {
  assert.deepEqual(parseDownloadConfigDocument({
    downloadsEnabled: true,
    sonarrUrl: '  https://sonarr.test  ',
    sonarr1080pProfileId: 7,
    sonarr4kProfileId: '12',
    qbittorrentPassword: 42,
    autoSendToDownloader: false,
    unexpected: 'ignore'
  }), {
    downloadsEnabled: true,
    autoSendToDownloader: false,
    sonarrUrl: 'https://sonarr.test',
    sonarr1080pProfileId: 7
  });
});

test('la normalisation locale conserve les types et nettoie seulement les chaînes', () => {
  assert.deepEqual(normalizeDownloadConfigPatch({
    downloadsEnabled: false,
    c411ApiKey: '  secret  ',
    radarr4kProfileId: null
  }), {
    downloadsEnabled: false,
    c411ApiKey: 'secret',
    radarr4kProfileId: null
  });
});
