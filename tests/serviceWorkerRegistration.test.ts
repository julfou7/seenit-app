import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  ensureSeenItServiceWorkerRegistration,
  resetSeenItServiceWorkerRegistrationForTests,
  SEENIT_SERVICE_WORKER_SCOPE,
  SEENIT_SERVICE_WORKER_URL
} from '../src/features/pwa/serviceWorkerRegistration.ts';

test('SEENIT-SECURITY-004 centralise un seul enregistrement et un seul contrôle de mise à jour par session', async () => {
  resetSeenItServiceWorkerRegistrationForTests();
  let registerCalls = 0;
  let updateCalls = 0;
  let receivedUrl = '';
  let receivedOptions: RegistrationOptions | undefined;

  const registration = {
    update: async () => { updateCalls += 1; }
  } as unknown as ServiceWorkerRegistration;
  const serviceWorker = {
    register: async (url: string | URL, options?: RegistrationOptions) => {
      registerCalls += 1;
      receivedUrl = String(url);
      receivedOptions = options;
      return registration;
    }
  } as Pick<ServiceWorkerContainer, 'register'>;

  const first = ensureSeenItServiceWorkerRegistration({ isNativePlatform: false, serviceWorker });
  const second = ensureSeenItServiceWorkerRegistration({ isNativePlatform: false, serviceWorker });

  assert.equal(await first, registration);
  assert.equal(await second, registration);
  assert.equal(registerCalls, 1);
  assert.equal(updateCalls, 1);
  assert.equal(receivedUrl, SEENIT_SERVICE_WORKER_URL);
  assert.equal(receivedOptions?.scope, SEENIT_SERVICE_WORKER_SCOPE);
  assert.equal(receivedOptions?.updateViaCache, 'none');
});

test('SEENIT-PLATFORM-001 ne monte jamais le service worker PWA dans la WebView native', async () => {
  resetSeenItServiceWorkerRegistrationForTests();
  let registerCalls = 0;
  const serviceWorker = {
    register: async () => {
      registerCalls += 1;
      throw new Error('ne doit pas être appelé');
    }
  } as unknown as Pick<ServiceWorkerContainer, 'register'>;

  const result = await ensureSeenItServiceWorkerRegistration({ isNativePlatform: true, serviceWorker });
  assert.equal(result, undefined);
  assert.equal(registerCalls, 0);
});

test('SEENIT-SECURITY-004 permet une nouvelle tentative après un échec réel d’enregistrement', async () => {
  resetSeenItServiceWorkerRegistrationForTests();
  let registerCalls = 0;
  const registration = { update: async () => undefined } as unknown as ServiceWorkerRegistration;
  const serviceWorker = {
    register: async () => {
      registerCalls += 1;
      if (registerCalls === 1) throw new Error('offline');
      return registration;
    }
  } as unknown as Pick<ServiceWorkerContainer, 'register'>;

  await assert.rejects(
    ensureSeenItServiceWorkerRegistration({ isNativePlatform: false, serviceWorker }),
    /offline/
  );
  assert.equal(
    await ensureSeenItServiceWorkerRegistration({ isNativePlatform: false, serviceWorker }),
    registration
  );
  assert.equal(registerCalls, 2);
});

test('firebase.ts ne contient plus aucun enregistrement direct concurrent', () => {
  const firebaseSource = readFileSync('src/lib/firebase.ts', 'utf8');
  assert.doesNotMatch(firebaseSource, /navigator\.serviceWorker\.register/);
  assert.match(firebaseSource, /ensureSeenItServiceWorkerRegistration/);
});
