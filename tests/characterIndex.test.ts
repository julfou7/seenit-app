import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import express, { type Request, type RequestHandler } from 'express';
import { registerCharacterRoutes } from '../src/features/providers/characterBackend.ts';
import {
  CHARACTER_INDEX_BATCH_SIZE,
  CHARACTER_INDEX_TTL_MS,
  createCharacterIndex,
  matchIndexedCharacters,
  type CharacterIndexEntry,
  type CharacterIndexResponse,
  type CharacterIndexStorage,
} from '../src/features/discover/characterIndex.ts';
import { orderedCharacterSearchKeys, sortCharacterSearchResults } from '../src/features/discover/characterSearch.ts';
import type { Show } from '../src/types.ts';

const VIKINGS = 44217;

function libraryShow(tmdbId: number, overrides: Partial<Show> = {}): Show {
  return {
    id: `show-${tmdbId}`, userId: 'owner', tmdbId, title: `Série ${tmdbId}`, mediaType: 'tv', posterPath: null, backdropPath: null,
    status: 'completed', isArchived: false, updatedAt: 1_000_000 + tmdbId, createdAt: 1, seenEpisodes: [], episodeRecords: {}, ...overrides,
  };
}

/** Bibliothèque terrain : Vikings, vieille série terminée, en fin de file, dans 500 titres. */
function ownerLibrary() {
  const shows = Array.from({ length: 499 }, (_, index) => libraryShow(10_000 + index));
  shows.splice(480, 0, libraryShow(VIKINGS, { title: 'Vikings', updatedAt: 1, lastWatchedAt: 1 }));
  return shows;
}

async function startCharacterServer(t: test.TestContext, clock: { now: number }) {
  const app = express();
  const calls: string[] = [];
  const authenticate: RequestHandler = (req, res, next) => {
    if (!req.headers.authorization) { res.status(401).end(); return; }
    (req as Request & { user: { uid: string } }).user = { uid: String(req.headers.authorization) };
    next();
  };
  registerCharacterRoutes(app, {
    authenticate,
    now: () => clock.now,
    secrets: () => ({ TMDB_API_KEY: 'index-test-key' }),
    fetch: async input => {
      const url = new URL(String(input));
      calls.push(url.pathname);
      const id = Number(url.pathname.split('/')[3]);
      const cast = id === VIKINGS
        ? [
          { id: 43943, name: 'Travis Fimmel', profile_path: '/travis.jpg', roles: [{ character: 'Ragnar Lothbrok', episode_count: 49 }] },
          { id: 12572, name: 'Katheryn Winnick', profile_path: '/katheryn.jpg', roles: [{ character: 'Lagertha', episode_count: 71 }] },
        ]
        : [{ id: id * 10, name: `Interprète ${id}`, roles: [{ character: id === 10_001 ? 'Earl Ragnar' : `Personnage ${id}`, episode_count: 3 }] }];
      // Une vraie réponse TMDB est volumineuse : le cache doit garder la version compacte.
      const padding = 'x'.repeat(60_000);
      return new Response(JSON.stringify({ id, name: id === VIKINGS ? 'Vikings' : `Série ${id}`, overview: padding, first_air_date: '2013-03-03', seasons: [{ season_number: 1, episode_count: 9 }], aggregate_credits: { cast } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const fetchBatch = async (keys: readonly string[]): Promise<CharacterIndexResponse> => {
    const response = await fetch(`${base}/api/media/characters/index?ids=${encodeURIComponent(keys.join(','))}`, { headers: { Authorization: 'owner' } });
    assert.equal(response.status, 200);
    return await response.json() as CharacterIndexResponse;
  };
  return { base, calls, fetchBatch };
}

function memoryStorage() {
  const stored = new Map<string, CharacterIndexEntry>();
  const storage: CharacterIndexStorage = {
    async read(keys) { return keys.flatMap(key => stored.get(key) ? [stored.get(key)!] : []); },
    async write(entries) { for (const entry of entries) stored.set(entry.key, entry); },
  };
  return { stored, storage };
}

test('SEENIT-DISCOVER-004 terrain Ragnar : 500 titres, quota atteint, Ragnar Lothbrok sans balayage par frappe', async t => {
  const clock = { now: Date.parse('2026-10-30T20:00:00Z') };
  const { calls, fetchBatch } = await startCharacterServer(t, clock);
  const { stored, storage } = memoryStorage();
  const scheduled: Array<{ task: () => void; delay: number }> = [];
  const index = createCharacterIndex({ storage, fetchBatch, now: () => clock.now, schedule: (task, delay) => scheduled.push({ task, delay }) });
  const shows = ownerLibrary();
  const keys = orderedCharacterSearchKeys(shows);
  assert.ok(keys.indexOf(`tv:${VIKINGS}`) > 400, 'Vikings reste au fond de la bibliothèque');

  await index.ensure(keys);
  await index.idle();
  assert.equal(calls.length, 360, 'le quota par minute du serveur est réellement atteint');
  assert.equal(index.getSnapshot().partial, true, 'la couverture partielle est signalée, jamais avalée');
  assert.equal(scheduled.length, 1, 'un nouvel essai est planifié');
  assert.ok(scheduled[0].delay >= 1_000 && scheduled[0].delay <= 60_000, 'au moment de la réouverture du quota');

  clock.now += scheduled[0].delay + 1;
  scheduled.shift()!.task();
  await new Promise(resolve => setImmediate(resolve));
  await index.idle();
  assert.equal(calls.length, 500, 'chaque titre est lu une seule fois');
  assert.equal(index.getSnapshot().partial, false);
  assert.equal(index.getSnapshot().indexing, false);

  const search = (query: string) => sortCharacterSearchResults(matchIndexedCharacters(index.characters(keys), query), keys, query);
  const ragnar = search('Ragnar');
  assert.deepEqual(ragnar.map(character => character.name), ['Ragnar Lothbrok', 'Earl Ragnar'], 'le nom exact passe devant la correspondance interne');
  assert.equal(ragnar[0].seed, `tv:${VIKINGS}`);
  assert.equal(ragnar[0].actors[0].name, 'Travis Fimmel');
  assert.equal(search('lagert')[0].name, 'Lagertha');
  assert.equal(calls.length, 500, 'les frappes suivantes ne refont aucun appel');

  // Réouverture de l'app : l'index de l'appareil répond, le réseau ne relit rien.
  const reopened = createCharacterIndex({ storage, fetchBatch, now: () => clock.now, schedule: () => {} });
  assert.equal(stored.size, 500);
  await reopened.ensure(keys);
  await reopened.idle();
  assert.equal(calls.length, 500);
  assert.equal(matchIndexedCharacters(reopened.characters(keys), 'ragnar lothbrok')[0].name, 'Ragnar Lothbrok');

  // Après 14 jours, l'entrée est relue ; le cache serveur compact a, lui, expiré après 24 h.
  clock.now += CHARACTER_INDEX_TTL_MS + 1;
  const expired = createCharacterIndex({ storage, fetchBatch, now: () => clock.now, schedule: () => {} });
  await expired.prioritize([`tv:${VIKINGS}`]);
  await expired.idle();
  assert.equal(calls.at(-1), `/3/tv/${VIKINGS}`, 'un titre prioritaire passe en tête de la file');
});

test('SEENIT-DISCOVER-004 route index : cache compact partagé, échecs signalés, ancienne route conservée', async t => {
  const clock = { now: Date.parse('2026-10-30T20:00:00Z') };
  const { base, calls, fetchBatch } = await startCharacterServer(t, clock);
  const keys = Array.from({ length: CHARACTER_INDEX_BATCH_SIZE }, (_, index) => `tv:${20_000 + index}`);
  const first = await fetchBatch(keys);
  assert.equal(first.media.length, CHARACTER_INDEX_BATCH_SIZE);
  assert.deepEqual(first.failed, []);
  assert.ok(JSON.stringify(first).length < 24 * 8_000, 'la réponse ne transporte que les distributions compactées');
  assert.ok(!JSON.stringify(first).includes('index-test-key'));
  await fetchBatch(keys);
  assert.equal(calls.length, CHARACTER_INDEX_BATCH_SIZE, 'le cache compact sert la seconde lecture');

  const tooMany = await fetch(`${base}/api/media/characters/index?ids=${Array.from({ length: 25 }, (_, i) => `tv:${i + 1}`).join(',')}`, { headers: { Authorization: 'owner' } });
  assert.equal(tooMany.status, 400);
  assert.equal((await fetch(`${base}/api/media/characters/index?ids=tv:1`)).status, 401);

  const legacy = await (await fetch(`${base}/api/media/characters?ids=tv:${keys[0].split(':')[1]}&q=personnage`, { headers: { Authorization: 'owner' } })).json() as { results: unknown[] };
  assert.equal(legacy.results.length, 1, 'les APK déjà installées gardent leur route');
  assert.equal(calls.length, CHARACTER_INDEX_BATCH_SIZE, 'et profitent du même cache compact');
});

test('SEENIT-DISCOVER-004 le hook Personnages filtre un index local partagé entre les frappes', () => {
  const hook = readFileSync('src/hooks/useCharacterSearch.ts', 'utf8');
  const core = readFileSync('src/screens/DiscoverViewCore.tsx', 'utf8');
  const results = readFileSync('src/components/DiscoverSearchResults.tsx', 'utf8');
  assert.match(hook, /characterIndex\.ensure\(libraryKeys\)/);
  assert.match(hook, /\}, \[active, uid, signature\]\);/, 'une frappe ne relance pas l’indexation');
  assert.match(hook, /characterIndex\.prioritize\(preferred\)/);
  assert.match(hook, /matchIndexedCharacters\(characterIndex\.characters\(libraryKeys\), trimmed\)/);
  assert.match(hook, /peekRenderableMediaDetails/);
  assert.doesNotMatch(hook, /\/api\/media\/characters\?|runCharacterSearchBatches|primeMediaRenderSnapshotFromPersistentCache|setTimeout\s*\(/);
  assert.match(core, /useCharacterSearch\(model\.shows, isSearchMode \? query : '', !selectedCharacter, isSearchMode\)/);
  assert.match(results, /charactersPartial \? <small>liste incomplète, nouvel essai bientôt<\/small>/);
  assert.doesNotMatch(results, /instantané|searchElapsedMs|<small>TMDB/);
});
