import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSeenItApiUrl } from '../src/lib/seenitApi.ts';

test('les appels API de l’APK ciblent toujours le backend SeenIt', () => {
  assert.equal(resolveSeenItApiUrl('/api/devices/register', true), 'https://seenit.ai.studio/api/devices/register');
  assert.equal(resolveSeenItApiUrl('/api/service-proxy', true), 'https://seenit.ai.studio/api/service-proxy');
});

test('la PWA conserve les routes relatives et les URL externes restent intactes', () => {
  assert.equal(resolveSeenItApiUrl('/api/webhooks/config', false), '/api/webhooks/config');
  assert.equal(resolveSeenItApiUrl('https://sonarr.example/api/v3/queue', true), 'https://sonarr.example/api/v3/queue');
});
