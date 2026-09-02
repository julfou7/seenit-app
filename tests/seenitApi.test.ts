import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isAiStudioPreviewHostname,
  isUnexpectedHtmlApiResponse,
  resolveSeenItApiUrl
} from '../src/lib/seenitApi.ts';

test('SEENIT-PLATFORM-001 route l’APK et le preview AI Studio vers le backend canonique', () => {
  assert.equal(resolveSeenItApiUrl('/api/devices/register', true, ''), 'https://seenit.ai.studio/api/devices/register');
  assert.equal(resolveSeenItApiUrl('/api/service-proxy', false, 'ais-dev-seenit-123.run.app'), 'https://seenit.ai.studio/api/service-proxy');
  assert.equal(resolveSeenItApiUrl('/api/health', false, 'foo.ais-dev-preview.example'), 'https://seenit.ai.studio/api/health');
  assert.equal(isAiStudioPreviewHostname('ais-dev-seenit-123.run.app'), true);
});

test('SEENIT-PLATFORM-001 conserve la PWA canonique en même origine', () => {
  assert.equal(resolveSeenItApiUrl('/api/webhooks/config', false, 'seenit.ai.studio'), '/api/webhooks/config');
  assert.equal(resolveSeenItApiUrl('/api/webhooks/config', false, 'localhost'), '/api/webhooks/config');
  assert.equal(resolveSeenItApiUrl('https://sonarr.example/api/v3/queue', true, ''), 'https://sonarr.example/api/v3/queue');
});

test('SEENIT-RUNTIME-001 refuse un fallback HTML 200 comme succès API', () => {
  assert.equal(isUnexpectedHtmlApiResponse('text/html; charset=utf-8'), true);
  assert.equal(isUnexpectedHtmlApiResponse('application/json; charset=utf-8'), false);
  assert.equal(isUnexpectedHtmlApiResponse(null), false);
});
