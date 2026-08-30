import assert from 'node:assert/strict';
import test from 'node:test';
import {
  executeBackendAttempts,
  isRetryableBackendNetworkError
} from '../src/lib/nativeBackendRetry.ts';

test('reconnaît les erreurs DNS Android comme temporaires', () => {
  assert.equal(isRetryableBackendNetworkError(
    new Error('Unable to resolve host "seenit.ai.studio": No address associated with hostname')
  ), true);
  assert.equal(isRetryableBackendNetworkError(new Error('UnknownHostException')), true);
  assert.equal(isRetryableBackendNetworkError(new Error('Backend Plex indisponible (HTTP 401)')), false);
});

test('bascule du transport Android vers la WebView après une panne DNS', async () => {
  const transports: string[] = [];
  const result = await executeBackendAttempts({
    attempts: [
      {
        transport: 'natif Android',
        request: async () => {
          transports.push('natif');
          throw new Error('Unable to resolve host "seenit.ai.studio"');
        }
      },
      {
        transport: 'WebView',
        request: async () => {
          transports.push('webview');
          return 'ok';
        }
      }
    ]
  });

  assert.equal(result, 'ok');
  assert.deepEqual(transports, ['natif', 'webview']);
});

test('ne rejoue pas une erreur fonctionnelle non réseau', async () => {
  let fallbackCalled = false;

  await assert.rejects(() => executeBackendAttempts({
    attempts: [
      {
        transport: 'natif Android',
        request: async () => {
          throw new Error('HTTP 401');
        }
      },
      {
        transport: 'WebView',
        request: async () => {
          fallbackCalled = true;
          return 'ok';
        }
      }
    ]
  }), /HTTP 401/);

  assert.equal(fallbackCalled, false);
});
