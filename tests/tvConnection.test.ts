import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createTvPairingService, type TvLink, type TvLinkStore, type TvLinkMutation } from '../src/features/tv/tvPairing.ts';

const source = readFileSync(new URL('../tv-samsung/connection.js', import.meta.url), 'utf8');
function client() {
  const values = new Map<string, string>(), timers = new Map<number, () => void>();
  const requests: Xhr[] = [];
  let sequence = 0;
  class Xhr {
    url = ''; method = ''; body = ''; status = 0; readyState = 0; responseText = ''; aborted = false;
    headers: Record<string, string> = {};
    onreadystatechange: (() => void) | null = null;
    onerror: (() => void) | null = null;
    open(method: string, url: string) { this.method = method; this.url = url; }
    setRequestHeader(name: string, value: string) { this.headers[name] = value; }
    send(body: string) { this.body = body; requests.push(this); }
    abort() { this.aborted = true; }
    reply(value: unknown, status = 200) {
      this.status = status; this.readyState = 4; this.responseText = JSON.stringify(value); this.onreadystatechange?.();
    }
  }
  const document = { hidden: false };
  const context = vm.createContext({ XMLHttpRequest: Xhr, document,
    setTimeout: (fn: () => void) => { timers.set(++sequence, fn); return sequence; },
    clearTimeout: (id: number) => timers.delete(id),
  });
  vm.runInContext(source, context);
  const api = context.TVConnection;
  api.init({ getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) }, () => {});
  return { api, requests, values, timers, document, tick() {
    const job = timers.entries().next().value;
    assert.ok(job); timers.delete(job[0]); job[1]();
  } };
}
async function pendingLink() {
  const docs = new Map<string, TvLink>();
  const store: TvLinkStore = { async create(id, record) { docs.set(id, record); }, async read(id) { return docs.get(id) ?? null; },
    async mutate<T>(id: string, change: (value: TvLink | null) => TvLinkMutation<T>) {
      const mutation = change(docs.get(id) ?? null); docs.set(id, mutation.next); return mutation.result;
    } };
  const service = createTvPairingService(store);
  return { service, link: await service.create({ profile: 'Julian' }) };
}
test('SEENIT-TV-002 réponse serveur réelle acceptée par le client TV et poll arrêté au départ', async () => {
  const { service, link } = await pendingLink(), h = client();
  h.api.profile('Julian'); h.api.start('Samsung');
  const create = h.requests[0];
  assert.equal(create.url, 'https://seenit.ai.studio/api/tv/links');
  assert.equal(create.headers.Authorization, undefined);
  create.reply(link, 201);
  assert.equal(h.api.view().phase, 'pending');
  assert.equal(h.api.view().approvalUrl, link.approvalUrl);
  assert.ok(!JSON.stringify(h.api.view()).includes(link.secret));
  assert.equal(h.timers.size, 1);
  h.tick();
  assert.equal(h.requests[1].headers.Authorization, 'Bearer ' + link.secret);
  h.api.pairingVisible(false);
  assert.equal(h.requests[1].aborted, true);
  assert.equal(h.timers.size, 0);
  h.requests[1].reply(await service.status(link.id, link.secret));
  assert.equal(h.timers.size, 0);
});
test('SEENIT-TV-002 profil isolé, réponse tardive ignorée et révocation hors ligne rejouée', async () => {
  const { service, link } = await pendingLink(), h = client();
  h.api.profile('Julian'); h.api.start('Samsung'); h.requests[0].reply(link, 201);
  await service.approve(link.id, link.code, { uid: 'owner' });
  h.tick(); h.requests[1].reply(await service.status(link.id, link.secret));
  const firstBootstrap = h.requests[2];
  h.api.profile('Camille');
  firstBootstrap.reply({ profile: 'Julian', items: [{ title: 'Private film' }], syncedAt: Date.now() });
  assert.equal(h.api.view().linked, false);
  assert.equal(h.api.view().items.length, 0);
  h.api.profile('Julian');
  h.requests[3].reply({ profile: 'Julian', items: [{ title: 'Private film' }], syncedAt: Date.now() });
  assert.equal(h.api.view().items.length, 1);
  h.api.revoke();
  h.api.pairingVisible(true);
  assert.equal(h.requests[4].aborted, false, 'revenir à l’écran compte ne doit pas annuler la révocation');
  assert.equal(h.api.view().items.length, 0);
  h.requests[4].onerror?.();
  assert.equal(h.api.view().error, 'REVOKE_PENDING');
  h.api.resume();
  assert.equal(h.requests[5].method, 'DELETE');
  h.requests[5].reply({ revoked: true });
  assert.equal(h.values.has('seenit.tv.v4.foyer'), false);
  assert.equal([...h.values.values()].some(value => value.includes('Private film')), false);
});
