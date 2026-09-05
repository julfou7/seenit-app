import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildNativeBackendAttempts,
  describeBackendNetworkFailure,
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

test('essaie chaque couple origine et transport une seule fois et privilégie le secours DNS natif', async () => {
  const calls: string[] = [];
  const attempts = buildNativeBackendAttempts({
    urls: ['https://seenit.ai.studio/api/plex/history', 'https://seenit-app.run.app/api/plex/history'],
    nativeRequest: async (url) => {
      calls.push(`natif:${url}`);
      if (url.includes('seenit.ai.studio')) throw new Error('Unable to resolve host "seenit.ai.studio"');
      return 'ok';
    },
    webViewRequest: async (url) => {
      calls.push(`webview:${url}`);
      return 'web';
    }
  });

  assert.deepEqual(attempts.map(({ transport, endpoint }) => `${transport}:${endpoint}`), [
    'natif Android:https://seenit.ai.studio/api/plex/history',
    'natif Android:https://seenit-app.run.app/api/plex/history',
    'WebView:https://seenit.ai.studio/api/plex/history',
    'WebView:https://seenit-app.run.app/api/plex/history'
  ]);
  assert.equal(new Set(attempts.map(({ transport, endpoint }) => `${transport}:${endpoint}`)).size, attempts.length);
  assert.equal(await executeBackendAttempts({ attempts }), 'ok');
  assert.deepEqual(calls, [
    'natif:https://seenit.ai.studio/api/plex/history',
    'natif:https://seenit-app.run.app/api/plex/history'
  ]);
});

test('traduit un échec réseau total sans masquer une erreur fonctionnelle', () => {
  assert.equal(
    describeBackendNetworkFailure(new Error('Unable to resolve host "seenit.ai.studio"')),
    'Connexion au backend SeenIt impossible. Vérifiez la connexion réseau ou le DNS privé de cet appareil, puis réessayez.'
  );
  assert.equal(describeBackendNetworkFailure(new Error('Backend Plex indisponible (HTTP 401)')), 'Backend Plex indisponible (HTTP 401)');
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
