import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as ts from 'typescript';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
}

const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(
  JSON.stringify(body),
  { status, headers: { 'content-type': 'application/json', ...headers } }
);

const originalFetch = globalThis.fetch;

async function loadPlex() {
  const source = readFileSync('src/services/plex.ts', 'utf8');
  const updateStoreSource = readFileSync('src/store/updateStore.ts', 'utf8');
  const version = updateStoreSource.match(/CURRENT_APP_VERSION\s*=\s*'([^']+)'/)?.[1];
  assert.ok(version, 'version SeenIt introuvable');

  const testableSource = source.replace(
    "import { CURRENT_APP_VERSION } from '../store/updateStore';",
    `const CURRENT_APP_VERSION = ${JSON.stringify(version)};`
  );
  assert.notEqual(testableSource, source, 'import de version Plex non substitué');

  const output = ts.transpileModule(testableSource, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext
    }
  }).outputText;
  const dataUrl = `data:text/javascript;base64,${Buffer.from(output).toString('base64')}#${Date.now()}-${Math.random()}`;
  return import(dataUrl);
}

test.beforeEach(() => {
  (globalThis as any).localStorage = new MemoryStorage();
  globalThis.fetch = originalFetch;
});

test('SEENIT-PLEX-008 partage strictement l’identité de la tentative entre POST URL et polling', async () => {
  const plex = await loadPlex();
  const initialClientId = '11111111-1111-4111-8111-111111111111';
  localStorage.setItem('plex_client_identifier', initialClientId);

  let postHeaders: Headers | null = null;
  const attempt = await plex.getPlexPin('Android', {
    now: () => 1_000,
    fetchImpl: async (_input, init) => {
      postHeaders = new Headers(init?.headers);
      return jsonResponse({ id: 42, code: 'ABCD', expiresIn: 60 });
    }
  });

  assert.equal(postHeaders?.get('X-Plex-Client-Identifier'), initialClientId);
  assert.equal(postHeaders?.get('X-Plex-Product'), 'SeenIt');
  assert.equal(postHeaders?.get('X-Plex-Platform'), 'Android');
  assert.equal(postHeaders?.get('X-Plex-Version'), plex.PLEX_VERSION);
  assert.ok(Object.isFrozen(attempt));

  const authUrl = plex.buildPlexAuthUrl(attempt);
  const fragment = new URLSearchParams(authUrl.split('#?')[1]);
  assert.equal(fragment.get('clientID'), initialClientId);
  assert.equal(fragment.get('code'), 'ABCD');
  assert.equal(fragment.get('context[device][product]'), 'SeenIt');
  assert.equal(fragment.get('context[device][platform]'), 'Android');
  assert.equal(fragment.get('context[device][version]'), plex.PLEX_VERSION);

  const requests: Array<{ url: string; headers: Headers }> = [];
  const result = await plex.checkPlexPin(attempt, {
    now: () => 2_000,
    fetchImpl: async (input, init) => {
      requests.push({ url: String(input), headers: new Headers(init?.headers) });
      if (String(input).endsWith('/42')) return jsonResponse({ authToken: 'token-secret' });
      return jsonResponse({ username: 'julian' });
    }
  });

  assert.equal(result.authToken, 'token-secret');
  assert.equal(requests[0].headers.get('X-Plex-Client-Identifier'), initialClientId);
  assert.equal(requests[0].headers.get('X-Plex-Product'), 'SeenIt');
  assert.equal(requests[0].headers.get('X-Plex-Version'), plex.PLEX_VERSION);
  assert.equal(requests[1].url, 'https://plex.tv/api/v2/user');
});

test('SEENIT-PLEX-008 fige le clientIdentifier même si le stockage local change', async () => {
  const plex = await loadPlex();
  const firstId = '22222222-2222-4222-8222-222222222222';
  const secondId = '33333333-3333-4333-8333-333333333333';
  localStorage.setItem('plex_client_identifier', firstId);

  const attempt = await plex.getPlexPin('Web', {
    now: () => 1_000,
    fetchImpl: async () => jsonResponse({ id: 77, code: 'FIXE', expiresIn: 60 })
  });
  localStorage.setItem('plex_client_identifier', secondId);

  const seenHeaders: Headers[] = [];
  await plex.checkPlexPin(attempt, {
    now: () => 2_000,
    fetchImpl: async (_input, init) => {
      seenHeaders.push(new Headers(init?.headers));
      return jsonResponse({ authToken: null });
    }
  });

  assert.equal(attempt.clientIdentifier, firstId);
  assert.equal(seenHeaders[0].get('X-Plex-Client-Identifier'), firstId);
  assert.notEqual(seenHeaders[0].get('X-Plex-Client-Identifier'), secondId);
});

test('un produit divergent est refusé avant de construire une URL Plex', async () => {
  const plex = await loadPlex();
  const attempt = Object.freeze({
    pinId: 1,
    code: 'CODE',
    clientIdentifier: '44444444-4444-4444-8444-444444444444',
    product: 'TV Time Sync' as any,
    version: plex.PLEX_VERSION,
    platform: 'Web' as const,
    createdAt: 1_000,
    expiresAt: 60_000
  });

  assert.throws(
    () => plex.buildPlexAuthUrl(attempt),
    (error: any) => error?.code === 'identity_mismatch' && error?.permanent === true
  );
});

test('SEENIT-PLEX-008 borne expiration refus et rate limiting sans boucle infinie', async () => {
  const plex = await loadPlex();
  const baseAttempt = Object.freeze({
    pinId: 88,
    code: 'BOUND',
    clientIdentifier: '55555555-5555-4555-8555-555555555555',
    product: plex.PLEX_PRODUCT,
    version: plex.PLEX_VERSION,
    platform: 'Web' as const,
    createdAt: 1_000,
    expiresAt: 120_000
  });

  await assert.rejects(
    plex.checkPlexPin({ ...baseAttempt, expiresAt: 2_000 }, {
      now: () => 2_000,
      fetchImpl: async () => { throw new Error('fetch ne doit pas partir'); }
    }),
    (error: any) => error?.code === 'expired' && error?.permanent === true
  );

  await assert.rejects(
    plex.checkPlexPin(baseAttempt, {
      now: () => 2_000,
      fetchImpl: async () => jsonResponse({}, 403)
    }),
    (error: any) => error?.code === 'refused' && error?.permanent === true
  );

  const delays: number[] = [];
  let request = 0;
  const result = await plex.pollPlexAuthAttempt(baseAttempt, {
    now: () => 2_000,
    delay: async ms => { delays.push(ms); },
    fetchImpl: async input => {
      request += 1;
      if (request === 1) return jsonResponse({}, 429, { 'retry-after': '120' });
      if (request === 2) return jsonResponse({ authToken: null });
      if (String(input).endsWith('/88')) return jsonResponse({ authToken: 'validated-token' });
      return jsonResponse({ username: 'validated-user' });
    }
  });

  assert.equal(result.authToken, 'validated-token');
  assert.deepEqual(delays, [30_000, 3_000]);
});

test('SEENIT-PLEX-008 valide le jeton avant de déclarer l’association réussie', async () => {
  const plex = await loadPlex();
  const attempt = Object.freeze({
    pinId: 99,
    code: 'TOKEN',
    clientIdentifier: '66666666-6666-4666-8666-666666666666',
    product: plex.PLEX_PRODUCT,
    version: plex.PLEX_VERSION,
    platform: 'Android' as const,
    createdAt: 1_000,
    expiresAt: 120_000
  });
  const called: string[] = [];

  await assert.rejects(
    plex.checkPlexPin(attempt, {
      now: () => 2_000,
      fetchImpl: async input => {
        called.push(String(input));
        if (String(input).endsWith('/99')) return jsonResponse({ authToken: 'candidate-token' });
        return jsonResponse({}, 401);
      }
    }),
    (error: any) => error?.code === 'invalid_token' && error?.permanent === true
  );

  assert.deepEqual(called, [
    'https://plex.tv/api/v2/pins/99',
    'https://plex.tv/api/v2/user'
  ]);
});

test('SEENIT-PLEX-008 interdit les secrets de l’association Plex dans les logs', () => {
  const settingsSource = readFileSync('src/screens/SettingsScreen.tsx', 'utf8');
  assert.doesNotMatch(settingsSource, /TV Time Sync/);
  assert.doesNotMatch(settingsSource, /appLogger\.(?:info|warn|error|success)\([^\n]+authUrl/);
  assert.doesNotMatch(settingsSource, /openExternalUrl\(authUrl\)/);
});

test('le parcours UI Plex utilise un poller unique annulable et reste lié au Firebase UID', () => {
  const settingsSource = readFileSync('src/screens/SettingsScreen.tsx', 'utf8');
  assert.match(settingsSource, /pollPlexAuthAttempt\(attempt, \{ signal: controller\.signal \}\)/);
  assert.match(settingsSource, /const controller = new AbortController\(\)/);
  assert.match(settingsSource, /controller\.abort\(\)/);
  assert.match(settingsSource, /auth\.currentUser\?\.uid !== uid/);
  assert.match(settingsSource, /plexAuthStartGuard\.current/);
  assert.doesNotMatch(settingsSource, /checkPlexPin\(plexPin\.id\)/);
});

test('la première synchro Plex ne part qu’après persistance locale et cloud du token validé', () => {
  const settingsSource = readFileSync('src/screens/SettingsScreen.tsx', 'utf8');
  const persistCloudIndex = settingsSource.indexOf("await setDoc(plexRef, { authToken: res.authToken, username }, { merge: true })");
  const persistLocalIndex = settingsSource.indexOf('storePlexCredentials(uid, res.authToken, username)');
  const syncIndex = settingsSource.indexOf('await performPlexSync({ delta: false, silent: false, ignoreCooldown: true })');

  assert.ok(persistCloudIndex >= 0, 'persistance Firestore absente');
  assert.ok(persistLocalIndex > persistCloudIndex, 'le stockage local doit suivre Firestore');
  assert.ok(syncIndex > persistLocalIndex, 'la première synchro doit suivre la persistance validée');
});
