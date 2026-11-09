import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const smoke = require('../scripts/pwa-browser-smoke.cjs') as {
  CdpClient: new (url: string) => { socket: { send: (data: string) => void } | null; pending: Map<number, unknown>; send: (method: string, params?: Record<string, unknown>, timeoutMs?: number) => Promise<unknown> };
  runLane: (client: unknown, tasks: Array<[string, (client: unknown) => Promise<unknown>]>, timings: Record<string, number>, label: string, taskTimeoutMs?: number) => Promise<Record<string, unknown>>;
};

// #934 : le 09/11, un appel DevTools sans réponse a bloqué le smoke 8 minutes sans un mot.
test('SEENIT-QUALITY-013 #934 un appel DevTools ou un harnais bloqué échoue vite en nommant le fautif', async () => {
  const client = new smoke.CdpClient('ws://inutile');
  client.socket = { send: () => {} };
  await assert.rejects(client.send('Runtime.evaluate', {}, 20), /Runtime\.evaluate : pas de réponse DevTools après 20 ms/);
  assert.equal(client.pending.size, 0, 'la requête expirée est oubliée');

  const timings: Record<string, number> = {};
  await assert.rejects(smoke.runLane(client, [['rapide', async () => 'ok'], ['downloads', () => new Promise(() => {})]], timings, 'couloir 2', 30), /downloads \(couloir 2\) : harnais bloqué depuis 30 ms/);
  assert.ok('downloads' in timings && 'rapide' in timings, 'durées relevées même en échec');
  assert.deepEqual(await smoke.runLane(client, [['rapide', async () => 'ok']], {}, 'couloir 1', 1000), { rapide: 'ok' });
});
