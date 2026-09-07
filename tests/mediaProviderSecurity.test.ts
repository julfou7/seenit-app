import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import express, { type RequestHandler } from 'express';
import {
  assertMediaProviderSecrets,
  buildProviderRequest,
  registerMediaProviderRoutes,
} from '../src/features/providers/mediaProviderBackend.ts';

const root = path.resolve(import.meta.dirname, '..');
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
});
async function harness(t: any, options: any = {}) {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const authenticate: RequestHandler = (req: any, res, next) => {
    const token = req.headers.authorization;
    if (!token?.startsWith('Bearer test-user-')) { res.status(401).json({ error: 'Unauthorized' }); return; }
    req.user = { uid: token.slice(7) };
    next();
  };
  const app = express();
  registerMediaProviderRoutes(app, {
    authenticate,
    secrets: () => ({ TMDB_API_KEY: 'test-tmdb-private', OMDB_API_KEY: 'test-omdb-private' }),
    ...options,
    fetch: async (url: any, init: any) => {
      calls.push({ url: new URL(String(url)), init });
      return options.fetch ? options.fetch(url, init) : json({ id: 42 });
    },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    server.close(error => error ? reject(error) : resolve());
  }));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const send = (suffix: string, user: string | null = 'a', init: RequestInit = {}) => fetch(
    'http://127.0.0.1:' + address.port + '/api/media/' + suffix,
    { ...init, headers: user ? { Authorization: 'Bearer test-user-' + user } : {} },
  );
  return { send, calls };
}

test('SEENIT-SECURITY-001 authentifie la façade et refuse les routes hors contrat', async t => {
  const { send, calls } = await harness(t);
  assert.equal((await send('tmdb/movie/42', null)).status, 401);
  for (const suffix of [
    'tmdb/account/42', 'tmdb/movie/42/lists', 'tmdb/movie/42?api_key=client-secret',
    'tmdb/movie/42?language=fr&language=en', 'tmdb/movie/42?url=https://example.org',
    'tmdb/movie/42?append_to_response=account_states',
    'tmdb/discover/movie?page=501', 'omdb?i=title', 'omdb?i=tt1234567&Season=-1',
    'omdb?i=tt1234567&t=Title', 'tmdb/find/tt1234567',
  ]) assert.equal((await send(suffix)).status, 400, suffix);
  assert.equal((await send('tvdb/franchise?mediaTitle=Example')).status, 404);
  assert.equal((await send('tmdb/movie/42', 'a', { method: 'POST' })).status, 404);
  assert.equal(calls.length, 0);
  for (const unsafe of ['//example.org/a', '../movie/42', 'movie/42/../../account/1', 'movie%2f42']) {
    assert.equal(buildProviderRequest('tmdb', unsafe, {}), null);
  }
});

test('SEENIT-SECURITY-001 bloque une révision de production sans les secrets requis', () => {
  assert.doesNotThrow(() => assertMediaProviderSecrets({
    TMDB_API_KEY: 'configured-tmdb',
    OMDB_API_KEY: 'configured-omdb',
  }));
  assert.throws(
    () => assertMediaProviderSecrets({ TMDB_API_KEY: 'configured-tmdb' }),
    /OMDB_API_KEY/,
  );
  assert.throws(
    () => assertMediaProviderSecrets({ OMDB_API_KEY: 'configured-omdb' }),
    /TMDB_API_KEY/,
  );
});

test('SEENIT-SECURITY-001 conserve les paramètres utiles et ne transmet aucun token utilisateur au fournisseur', async t => {
  const { send, calls } = await harness(t);
  for (const suffix of [
    'tmdb/search/movie?query=Dune&primary_release_year=1984&language=fr-FR',
    'tmdb/find/tt1234567?external_source=imdb_id',
    'tmdb/find/1234?external_source=tvdb_id',
    'tmdb/tv/42/season/0/episode/1?append_to_response=videos',
    'tmdb/movie/42?append_to_response=credits,similar,recommendations,release_dates',
    'tmdb/discover/movie?region=FR&with_release_type=2%7C3&release_date.gte=2026-01-01',
    'tmdb/tv/42/watch/providers',
    'tmdb/person/42/combined_credits',
    'omdb?i=tt1234567&Season=1',
  ]) assert.equal((await send(suffix)).status, 200, suffix);
  assert.equal(calls[0].url.searchParams.get('primary_release_year'), '1984');
  assert.equal(calls[0].url.searchParams.get('api_key'), 'test-tmdb-private');
  assert.equal(calls.at(-1)?.url.searchParams.get('apikey'), 'test-omdb-private');
  assert.equal(calls.at(-1)?.url.hostname, 'www.omdbapi.com');
  for (const { init } of calls) {
    assert.equal(init.redirect, 'error');
    assert.equal(new Headers(init.headers).has('Authorization'), false);
    assert.ok(init.signal);
  }
});

test('SEENIT-SECURITY-001 cache et déduplique sans contourner auth, TTL ou rotation', async t => {
  let time = 0;
  let secret = 'test-tmdb-private';
  const { send, calls } = await harness(t, {
    now: () => time, secrets: () => ({ TMDB_API_KEY: secret }),
    fetch: async () => { await new Promise(resolve => setTimeout(resolve, 15)); return json({ id: 42 }); },
  });
  const responses = await Promise.all([send('tmdb/movie/42?language=fr'), send('tmdb/movie/42?language=fr', 'b')]);
  assert.deepEqual(await responses[0].json(), await responses[1].json());
  assert.equal(calls.length, 1);
  assert.equal((await send('tmdb/movie/42?language=fr', null)).status, 401);
  assert.equal((await send('tmdb/movie/42?language=fr')).headers.get('cache-control'), 'no-store');
  assert.equal(calls.length, 1);
  time = 300_001;
  await send('tmdb/movie/42?language=fr');
  assert.equal(calls.length, 2);
  secret = 'test-rotated';
  await send('tmdb/movie/42?language=fr');
  assert.equal(calls.length, 3);
  assert.equal(calls[2].url.searchParams.get('api_key'), secret);
  secret = '';
  assert.equal((await send('tmdb/movie/42?language=fr')).status, 503);
});

test('SEENIT-SECURITY-001 borne le cache et les quotas par UID', async t => {
  let time = 0;
  const { send, calls } = await harness(t, { now: () => time });
  for (let id = 1; id <= 201; id++) assert.equal((await send('tmdb/movie/' + id)).status, 200);
  await send('tmdb/movie/1');
  assert.equal(calls.length, 202, 'la plus ancienne entrée doit être évincée');
  for (let i = 0; i < 90; i++) assert.equal((await send('omdb?i=tt1234567')).status, 200);
  const limited = await send('omdb?i=tt1234567');
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '60');
  assert.equal((await send('omdb?i=tt1234567', 'b')).status, 200);
  time = 60_001;
  assert.equal((await send('omdb?i=tt1234567')).status, 200);
});

test('SEENIT-SECURITY-001 masque les erreurs fournisseur et refuse les réponses non sûres', async t => {
  const cases: Array<[() => Response | Promise<Response>, number]> = [
    [() => json({ error: 'https://upstream/?api_key=test-tmdb-private' }, 500), 502],
    [() => json({ error: 'private details' }, 404), 404],
    [() => json({ error: 'quota secret' }, 429), 429],
    [() => json({ url: 'https://upstream/?api_key=test-tmdb-private' }), 502],
    [() => json({ token: 'unrelated-token' }), 502],
    [() => new Response('<html>secret</html>', { headers: { 'Content-Type': 'text/html' } }), 502],
    [() => new Response('{broken', { headers: { 'Content-Type': 'application/json' } }), 502],
    [() => json({ Response: 'False', Error: 'private details' }), 502],
    [() => json({ body: 'x'.repeat(4 * 1024 * 1024) }), 502],
    [() => Promise.reject(new TypeError('redirect containing private details')), 502],
    [() => Promise.reject(new DOMException('private details', 'TimeoutError')), 504],
  ];
  for (const [fetcher, status] of cases) {
    const { send, calls } = await harness(t, { fetch: fetcher });
    const response = await send('tmdb/movie/42');
    assert.equal(response.status, status);
    assert.doesNotMatch(await response.text(), /private|upstream|test-tmdb|<html>|unrelated-token/);
    await send('tmdb/movie/42');
    assert.equal(calls.length, 2, 'une erreur ne doit pas entrer dans le cache');
  }
});

test('SEENIT-SECURITY-001 applique le timeout sans dépendre du secret réel', async t => {
  const { send } = await harness(t, {
    timeoutMs: 20,
    fetch: (_url: URL, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
    }),
  });
  assert.equal((await send('tmdb/movie/42')).status, 504);
});

test('SEENIT-SECURITY-001 ne conserve aucune clé fournisseur dans tout le source client', () => {
  const forbidden = /VITE_(TMDB|OMDB|TVDB)_API_KEY|api\.themoviedb\.org|omdbapi\.com|api4\.thetvdb\.com|localStorage[^\n]*(?:TMDB|OMDB|TVDB)_API_KEY/i;
  function scan(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) scan(full);
      else if (/\.(ts|tsx)$/.test(entry.name) && !full.endsWith('mediaProviderBackend.ts')) {
        assert.doesNotMatch(fs.readFileSync(full, 'utf8'), forbidden, path.relative(root, full));
      }
    }
  }
  scan(path.join(root, 'src'));
  assert.equal(fs.existsSync(path.join(root, 'src/services/tvdb.ts')), false);
});

test('SEENIT-SECURITY-001 exclut le backend du paquet web et APK', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const capacitorConfig = fs.readFileSync(path.join(root, 'capacitor.config.ts'), 'utf8');

  assert.match(packageJson.scripts.build, /scan-provider-client-bundle\.cjs/);
  assert.match(packageJson.scripts.build, /--outfile=build\/server\.cjs/);
  assert.equal(packageJson.scripts.start, 'node build/server.cjs');
  assert.match(capacitorConfig, /webDir:\s*['"]dist['"]/);
  assert.doesNotMatch(packageJson.scripts.build, /--outfile=dist\/server/);
});
