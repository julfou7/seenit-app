import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDownloadFailureOutbox, deliverDownloadFailureReceipt, downloadFailurePresentation, normalizeDownloadFailureReceipt, type DownloadFailureReceipt } from '../src/features/downloads/downloadFailureNotification.ts';

const receipt: DownloadFailureReceipt = { ownerUid: 'uid-a', requestId: 'opt_430', failureCode: 'no_release', title: 'Titre SeenIt', tmdbId: 11, mediaType: 'tv', season: 0, episode: 1 };

test('SEENIT-NOTIFICATION-004 notifie une seule fois le UID de la demande', async () => {
  const claimed = new Set<string>();
  const calls: string[] = [];
  const store = {
    reserve: async (uid: string, id: string) => { const key = `${uid}:${id}`; if (claimed.has(key)) return false; claimed.add(key); return true; },
    finish: async () => {}
  };
  const options = { uid: 'uid-a', input: receipt, store, send: async (uid: string) => { calls.push(uid); } };
  const results = await Promise.all([deliverDownloadFailureReceipt(options), deliverDownloadFailureReceipt(options), deliverDownloadFailureReceipt(options)]);
  assert.deepEqual(calls, ['uid-a']);
  assert.equal(results.filter(result => result.duplicate).length, 2);
  assert.deepEqual(await deliverDownloadFailureReceipt({ ...options, uid: 'uid-b' }), { accepted: false });
  assert.deepEqual(await deliverDownloadFailureReceipt({ ...options, input: { ...receipt, failureCode: 'timeout' } }), { accepted: false });
  assert.equal(calls.length, 1);
});

test('la notification nomme le média canonique et ouvre le scope exact sans détail torrent', () => {
  const presentation = downloadFailurePresentation(receipt);
  assert.equal(presentation.notification.title, 'Titre SeenIt · S00E01');
  assert.equal(presentation.notification.body, 'Aucune release compatible trouvée.');
  assert.equal(presentation.data.type, 'NAVIGATE_SHOW');
  assert.equal(presentation.data.tmdbId, '11');
  assert.equal(presentation.data.season, '0');
  assert.equal(presentation.data.episode, '1');
  assert.match(presentation.data.url, /season=0&episode=1/);
  assert.equal(presentation.data.notificationKind, 'download_failure');
  assert.equal(downloadFailurePresentation({ ...receipt, episode: undefined }).notification.title, 'Titre SeenIt · Saison 0');
  assert.equal(downloadFailurePresentation({ ...receipt, season: undefined, episode: undefined }).notification.title, 'Titre SeenIt · Toute la série');
  for (const patch of [{ requestId: '../other' }, { tmdbId: '11' }, { season: null }, { ownerUid: '' }, { mediaType: 'movie' }]) {
    assert.equal(normalizeDownloadFailureReceipt({ ...receipt, ...patch }), null);
  }
});

test('un envoi ambigu ou un acquittement perdu conserve la réservation et interdit le doublon', async () => {
  let reserved = false;
  let sends = 0;
  const outcomes: string[] = [];
  const options = {
    uid: 'uid-a', input: receipt,
    store: { reserve: async () => { if (reserved) return false; reserved = true; return true; }, finish: async (_uid: string, _id: string, outcome: string) => { outcomes.push(outcome); } },
    send: async () => { sends++; throw new Error('réponse FCM perdue'); }
  };
  await assert.rejects(deliverDownloadFailureReceipt(options));
  assert.equal((await deliverDownloadFailureReceipt(options)).duplicate, true);
  assert.equal(sends, 1);
  assert.deepEqual(outcomes, ['unknown']);
});

test('le reçu survit à un transport KO puis à une reprise, sans envoi sous un autre UID', async () => {
  let stored: DownloadFailureReceipt[] = [];
  let uid = 'uid-a';
  let online = false;
  const sent: DownloadFailureReceipt[] = [];
  const ports = { read: () => stored, write: (items: DownloadFailureReceipt[]) => { stored = items; }, currentUid: () => uid, send: async (item: DownloadFailureReceipt) => { if (!online) throw new Error('offline'); sent.push(item); return true; } };
  const first = createDownloadFailureOutbox(ports);
  first.enqueue(receipt);
  first.enqueue(receipt);
  await first.flush();
  assert.equal(stored.length, 1);
  uid = 'uid-b'; online = true;
  const resumed = createDownloadFailureOutbox(ports);
  await resumed.flush();
  assert.equal(sent.length, 0);
  uid = 'uid-a';
  await Promise.all([resumed.flush(), resumed.flush()]);
  assert.equal(sent.length, 1);
  assert.equal(stored.length, 0);
});

test('les entrées de production relient les recherches au lifecycle et au FCM authentifié', () => {
  const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  assert.match(read('src/services/sonarrRadarrSearch.ts'), /executeProvenArrSearch/);
  assert.match(read('src/features/downloads/episodeSeasonPackFallback.ts'), /confirmNoArrRelease/);
  assert.match(read('src/components/DownloadModal.tsx'), /failDownloadRequest\(requestId, result\.message, result\.failureCode\)/);
  assert.match(read('src/screens/ShowDetailScreenCore.tsx'), /failDownloadRequest\(requestId, res\.message, res\.failureCode\)/);
  assert.match(read('server.ts'), /failure-notification', requireAuth/);
  const backend = read('src/features/downloads/downloadFailureNotificationBackend.ts');
  assert.match(backend, /adminDb\.runTransaction/);
  assert.match(backend, /transaction\.create/);
  assert.match(read('firestore.rules'), /allow read, write: if false/);
});
