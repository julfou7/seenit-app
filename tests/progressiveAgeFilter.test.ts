import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import {
  filterResolvedPrefixes,
  shouldApplyProgressivePartial,
} from '../src/features/discover/progressiveAgeFilterCore.ts';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};

// TNR terrain #326 v1.4.154 : un préfixe lent ne doit plus bloquer un préfixe
// suivant entièrement résolu et sûr. La concurrence reste explicitement bornée.
test('issue #326 publie un résultat sûr plus loin sans attendre un préfixe antérieur bloqué', async () => {
  const items = Array.from({ length: 12 }, (_, index) => index + 1);
  const releaseFirstPrefix = deferred<number[]>();
  const firstPartial = deferred<number[]>();
  let settled = false;
  let prefixCalls = 0;

  const run = filterResolvedPrefixes<number, number | null, number>(
    items,
    6,
    async prefix => {
      prefixCalls += 1;
      if (prefix[0] === 1) {
        return releaseFirstPrefix.promise.then(values => prefix.map((_, index) => values[index] ?? null));
      }
      return prefix.map(id => id === 8 ? null : id);
    },
    (item, resolved) => resolved !== null && resolved !== undefined && item % 2 === 1 ? item : null,
    partial => firstPartial.resolve(partial),
  ).then(value => {
    settled = true;
    return value;
  });

  const first = await firstPartial.promise;
  assert.deepEqual(first, [7, 9, 11]);
  assert.equal(settled, false, 'le résultat final attend encore le préfixe antérieur');
  assert.equal(prefixCalls, 2, 'deux préfixes au maximum doivent pouvoir travailler en parallèle');

  releaseFirstPrefix.resolve([1, 2, 3, 4, 5, 6]);
  assert.deepEqual(await run, [1, 3, 5, 7, 9, 11], 'le résultat final retrouve strictement l’ordre source');
});

test('issue #326 borne la concurrence des préfixes pendant qu’un lot reste lent', async () => {
  const items = Array.from({ length: 24 }, (_, index) => index + 1);
  const blocked = deferred<number[]>();
  let active = 0;
  let maxActive = 0;
  let calls = 0;

  const run = filterResolvedPrefixes<number, number, number>(
    items,
    6,
    async prefix => {
      calls += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (prefix[0] === 1) {
        const values = await blocked.promise;
        active -= 1;
        return values;
      }
      await Promise.resolve();
      active -= 1;
      return prefix;
    },
    (item, resolved) => resolved === undefined ? null : item,
  );

  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(maxActive, 2);
  assert.ok(calls >= 2, 'le second préfixe doit démarrer malgré le premier bloqué');
  blocked.resolve([1, 2, 3, 4, 5, 6]);
  assert.equal((await run).length, 24);
});

test('issue #326 exclut les classifications inconnues et conserve strictement l’ordre du discover brut', async () => {
  const partials: number[][] = [];
  const result = await filterResolvedPrefixes<number, { known: boolean } | null, number>(
    [10, 20, 30, 40, 50, 60, 70],
    6,
    async prefix => prefix.map(id => id === 20 || id === 60 ? null : { known: true }),
    (item, resolved) => resolved?.known ? item : null,
    partial => partials.push(partial),
  );

  assert.ok(partials.some(partial => partial.includes(70)), 'un résultat sûr du second préfixe peut être publié tôt');
  assert.deepEqual(result, [10, 30, 40, 50, 70]);
});

test('issue #326 ignore les snapshots obsolètes et les pages suivantes', () => {
  assert.equal(shouldApplyProgressivePartial(4, 4, 1), true);
  assert.equal(shouldApplyProgressivePartial(3, 4, 1), false);
  assert.equal(shouldApplyProgressivePartial(4, 4, 2), false);
});

test('issue #326 le point d’entrée production utilise le moteur progressif sans réintroduire le client historique', () => {
  const showsRoot = ['src', 'features', 'shows'].join('/');
  const tmdbFacadePath = [showsRoot, 'tmdb.ts'].join('/');
  const removedClientPath = [showsRoot, ['tmdb', 'ClientCore.ts'].join('')].join('/');
  const tmdbFacade = readFileSync(tmdbFacadePath, 'utf8');
  const progressiveIntegration = readFileSync('src/features/discover/progressiveAgeFilter.ts', 'utf8');
  const discoverView = readFileSync('src/screens/DiscoverView.tsx', 'utf8');

  assert.match(tmdbFacade, /discoverSeenItProgressive as discoverSeenIt/);
  assert.match(progressiveIntegration, /DISCOVER_CRITICAL_GRID_ITEMS/);
  assert.match(progressiveIntegration, /baseResult\.value[\s\S]*results: partialResults/);
  assert.match(discoverView, /useSyncExternalStore/);
  assert.match(discoverView, /model\.loading/);
  assert.match(discoverView, /snapshot\.partial/);
  assert.equal(existsSync(removedClientPath), false);
});
