import test from 'node:test';
import assert from 'node:assert/strict';
import { createTvPairingService, TV_PAIRING_TTL_MS, TV_SESSION_TTL_MS, type TvLink, type TvLinkStore, type TvLinkMutation } from '../src/features/tv/tvPairing.ts';

function harness() {
  let time = 1_000_000;
  const docs = new Map<string, TvLink>();
  const store: TvLinkStore = {
    async create(id, link) { assert.ok(!docs.has(id)); docs.set(id, { ...link }); },
    async read(id) { return docs.get(id) ?? null; },
    async mutate<T>(id: string, change: (link: TvLink | null) => TvLinkMutation<T>) {
      const mutation = change(docs.get(id) ?? null); docs.set(id, mutation.next); return mutation.result;
    },
  };
  return { service: createTvPairingService(store, () => time), docs, advance: (ms: number) => { time += ms; } };
}
test('SEENIT-TV-002 QR public sans secret et aucun compte avant approbation explicite', async () => {
  const { service, docs } = harness();
  const link = await service.create({ profile: 'Julian', deviceName: 'Samsung Q6FN' });
  const uri = new URL(link.approvalUrl);
  assert.equal(uri.origin, 'https://seenit.ai.studio');
  assert.equal(uri.pathname, '/tv/connect');
  assert.equal(uri.searchParams.get('tvLink'), link.id);
  assert.ok(!link.approvalUrl.includes(link.secret));
  assert.equal(link.secret.length, 64);
  assert.equal(link.profile, 'Julian');
  assert.ok(!JSON.stringify([...docs.values()]).includes(link.secret));
  assert.ok(!JSON.stringify([...docs.values()]).includes(link.code.replace('-', '')));
  assert.equal((await service.status(link.id, link.secret)).state, 'pending');
  await assert.rejects(service.device(link.id, link.secret, true), { code: 'APPROVAL_REQUIRED' });
  await assert.rejects(service.inspect(link.id, link.code, ''), { code: 'AUTH_REQUIRED' });
  await service.inspect(link.id, link.code, 'owner-a');
  assert.equal((await service.status(link.id, link.secret)).state, 'pending');
});
test('SEENIT-TV-002 approbation propriétaire, sessions distinctes et révocation immédiate', async () => {
  const { service } = harness();
  const a = await service.create({ profile: 'Julian' }), b = await service.create({ profile: 'Camille' });
  const wrongCode = (a.code[0] === '0' ? '1' : '0') + a.code.slice(1);
  await assert.rejects(service.approve(a.id, wrongCode, { uid: 'owner-a' }), { code: 'WRONG_CODE' });
  await service.approve(a.id, a.code, { uid: 'owner-a', name: 'Julian' });
  assert.equal((await service.device(a.id, a.secret, true)).ownerUid, 'owner-a');
  assert.equal((await service.status(b.id, b.secret)).state, 'pending');
  await assert.rejects(service.device(a.id, b.secret), { code: 'INVALID_TV_SESSION' });
  await assert.rejects(service.approve(a.id, a.code, { uid: 'owner-b' }), { code: 'ALREADY_LINKED' });
  assert.equal((await service.approve(a.id, a.code, { uid: 'owner-a' })).state, 'active');
  await service.revoke(a.id, a.secret);
  await assert.rejects(service.device(a.id, a.secret, true), { code: 'LINK_REVOKED' });
  await assert.rejects(service.approve(a.id, a.code, { uid: 'owner-a' }), { code: 'LINK_REVOKED' });
});
test('SEENIT-TV-002 expiration serveur en attente et après association, sans prolongation par lecture', async () => {
  const { service, advance } = harness();
  const pending = await service.create({});
  advance(TV_PAIRING_TTL_MS);
  await assert.rejects(service.approve(pending.id, pending.code, { uid: 'owner' }), { code: 'LINK_EXPIRED' });
  const active = await service.create({});
  const approval = await service.approve(active.id, active.code, { uid: 'owner' });
  advance(TV_SESSION_TTL_MS - 1);
  assert.equal((await service.status(active.id, active.secret)).expiresAt, approval.expiresAt);
  advance(1);
  await assert.rejects(service.status(active.id, active.secret), { code: 'LINK_EXPIRED' });
});
