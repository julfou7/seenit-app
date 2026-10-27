import test from 'node:test';
import assert from 'node:assert/strict';
import express, { type RequestHandler } from 'express';
import { once } from 'node:events';
import { registerTvPairingRoutes } from '../src/features/tv/tvPairingRoutes.ts';
import type { TvLink, TvLinkStore, TvLinkMutation } from '../src/features/tv/tvPairing.ts';

test('SEENIT-TV-002 routes réelles : consentement requis, lecture bornée au propriétaire, session révoquée', async t => {
  const docs = new Map<string, TvLink>(), libraryCalls: string[] = [], quotas: string[] = [];
  const store: TvLinkStore = { async create(id, record) { docs.set(id, record); }, async read(id) { return docs.get(id) ?? null; },
    async mutate<T>(id: string, change: (value: TvLink | null) => TvLinkMutation<T>) {
      const mutation = change(docs.get(id) ?? null); docs.set(id, mutation.next); return mutation.result;
    } };
  // Production receives requireAuth (Firebase verified token). This port only substitutes token verification.
  const authenticate: RequestHandler = (req, res, next) => {
    const uid = req.headers.authorization === 'Bearer phone-a' ? 'owner-a' : req.headers.authorization === 'Bearer phone-b' ? 'owner-b' : '';
    if (!uid) { res.status(401).json({ error: 'UNAUTHENTICATED' }); return; }
    Object.assign(req, { user: { uid, name: 'Phone owner' } }); next();
  };
  const app = express(); app.use(express.json());
  registerTvPairingRoutes(app, { store, authenticate, rateLimit: name => {
    quotas.push(name); return (_req, _res, next) => next();
  }, library: async uid => { libraryCalls.push(uid); return [{ title: 'Owner film' }]; } });
  const server = app.listen(0, '127.0.0.1'); t.after(() => { server.closeAllConnections(); server.close(); });
  await once(server, 'listening'); const address = server.address(); assert.ok(address && typeof address === 'object');
  const port = address.port;
  async function request(path: string, token = '', body: unknown = {}, method = 'POST') {
    return fetch(`http://127.0.0.1:${port}/api/tv/links${path}`, { method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      ...(method === 'DELETE' ? {} : { body: JSON.stringify(body) }) });
  }
  const created = await request('', '', { profile: 'Julian' });
  assert.equal(created.status, 201); assert.equal(created.headers.get('cache-control'), 'no-store');
  const link = await created.json();
  assert.equal((await request(`/${link.id}/approve`, '', { code: link.code })).status, 401);
  assert.equal((await request(`/${link.id}/bootstrap`, link.secret)).status, 403);
  assert.equal(libraryCalls.length, 0);
  assert.equal((await request(`/${link.id}/approve`, 'phone-a', { code: link.code, uid: 'owner-b' })).status, 200);
  assert.equal((await request(`/${link.id}/approve`, 'phone-b', { code: link.code })).status, 409);
  const privateData = await request(`/${link.id}/bootstrap`, link.secret, { uid: 'owner-b' });
  assert.equal(privateData.status, 200); assert.equal(privateData.headers.get('cache-control'), 'no-store');
  assert.equal((await privateData.json()).profile, 'Julian'); assert.deepEqual(libraryCalls, ['owner-a']);
  assert.equal((await request(`/${link.id}`, link.secret, {}, 'DELETE')).status, 200);
  assert.equal((await request(`/${link.id}/bootstrap`, link.secret)).status, 403);
  assert.deepEqual(libraryCalls, ['owner-a']); assert.equal(quotas.length, 6);
});
