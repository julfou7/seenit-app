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

// #722 : la minuterie 18c (horloge virtuelle CDP) tourne dans un onglet neuf ; l'ordre des harnais reste libre.
test('SEENIT-QUALITY-013 #722 un harnais à horloge virtuelle reçoit un onglet isolé, refermé ensuite', async () => {
  const main = { id: 'principal' };
  const opened: string[] = [];
  const openIsolatedClient = async () => { const page = { id: `isolé-${opened.length + 1}` }; opened.push(`ouvert ${page.id}`); return { client: page, close: async () => { opened.push(`fermé ${page.id}`); } }; };
  const run = smoke.runLane as unknown as (client: unknown, tasks: unknown[], timings: Record<string, number>, label: string, timeout?: number, open?: typeof openIsolatedClient) => Promise<Record<string, unknown>>;
  const seen = await run(main, [
    ['avant', async (client: { id: string }) => client.id],
    ['minuterie', async (client: { id: string }) => client.id, { isolatedClock: true }],
    ['après', async (client: { id: string }) => client.id],
  ], {}, 'couloir unique', 1000, openIsolatedClient);
  assert.deepEqual(seen, { avant: 'principal', minuterie: 'isolé-1', après: 'principal' });
  assert.deepEqual(opened, ['ouvert isolé-1', 'fermé isolé-1'], 'onglet isolé refermé avant le harnais suivant');
  await assert.rejects(run(main, [['minuterie', async () => { throw new Error('rouge'); }, { isolatedClock: true }]], {}, 'c', 1000, openIsolatedClient), /minuterie \(c\) : rouge/);
  assert.equal(opened.at(-1), opened.at(-2)!.replace('ouvert', 'fermé'), 'refermé même en échec');
  const groups = (smoke as unknown as { buildLaneGroups: (config: unknown) => Array<Array<[string, unknown, { isolatedClock?: boolean }?]>> })
    .buildLaneGroups({ pwa: { minTouchTargetCssPx: 44, viewports: [] } }).flat();
  assert.equal(groups.find(([key]) => key === 'watchNext')?.[2]?.isolatedClock, true);
});
