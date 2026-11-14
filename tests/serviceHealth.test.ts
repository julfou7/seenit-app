import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BACKEND_HEALTH_TTL_MS,
  BACKEND_SLOW_MS,
  describeBackendHealth,
  describeNotificationHealth,
  probeBackendHealth,
  readBackendHealth,
  resetBackendHealthCache,
} from '../src/features/settings/serviceHealth.ts';

const jsonResponse = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('#404 le serveur SeenIt n’est « Opérationnel » que sur une réponse santé valide et rapide', async () => {
  let clock = 1_000;
  const now = () => clock;
  const ok = await probeBackendHealth(async () => { clock += 120; return jsonResponse(200, { status: 'ok', service: 'seenit-backend' }); }, now, '/api/health');
  assert.deepEqual(describeBackendHealth(ok), { text: 'Opérationnel', tone: 'ok' });

  const html = await probeBackendHealth(async () => new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } }), now, '/api/health');
  assert.equal(html.ok, false, 'une page HTML 200 n’est pas une preuve de santé');
  assert.equal(describeBackendHealth(html).tone, 'error');

  const down = await probeBackendHealth(async () => { throw new TypeError('Failed to fetch'); }, now, '/api/health');
  assert.equal(describeBackendHealth(down).tone, 'error');
  assert.equal(describeBackendHealth(await probeBackendHealth(async () => jsonResponse(503, { status: 'ok' }), now, '/api/health')).tone, 'error');

  const slow = await probeBackendHealth(async () => { clock += BACKEND_SLOW_MS; return jsonResponse(200, { status: 'ok' }); }, now, '/api/health');
  assert.equal(describeBackendHealth(slow).tone, 'warn');
  assert.equal(describeBackendHealth(null).tone, 'busy', 'pas de verdict avant la réponse');
});

test('#404 une seule sonde partagée, réutilisée pendant 5 minutes', async () => {
  resetBackendHealthCache();
  let clock = 0; let calls = 0;
  const probe = async () => { calls += 1; return { ok: true, ms: 50, at: clock }; };
  const [a, b] = await Promise.all([readBackendHealth(probe, () => clock), readBackendHealth(probe, () => clock)]);
  assert.equal(calls, 1); assert.equal(a, b);
  clock = BACKEND_HEALTH_TTL_MS - 1; await readBackendHealth(probe, () => clock); assert.equal(calls, 1);
  clock = BACKEND_HEALTH_TTL_MS + 1; await readBackendHealth(probe, () => clock); assert.equal(calls, 2);
  resetBackendHealthCache();
});

test('#404 notifications et branchement dans Réglages → Connexions', () => {
  assert.equal(describeNotificationHealth('granted').tone, 'ok');
  assert.equal(describeNotificationHealth('denied').tone, 'error');
  assert.equal(describeNotificationHealth('unknown').tone, 'warn');
  const core = readFileSync('src/screens/SettingsScreenCore.tsx', 'utf8');
  assert.match(core, /<SettingsRow icon=\{Cloud\} label="Serveur SeenIt" sub=\{backendHealth\.text\} tone=\{backendHealth\.tone\} dot \/>/);
  assert.match(core, /const backendHealth = useBackendHealth\(\);/);
  const health = readFileSync('src/features/settings/serviceHealth.ts', 'utf8');
  assert.doesNotMatch(health, /themoviedb|thetvdb|omdbapi|api_key/i, 'aucune API tierce ni clé sondée depuis le client');
});
