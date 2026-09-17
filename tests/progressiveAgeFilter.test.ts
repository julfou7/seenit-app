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

// TNR terrain #326 : le premier lot sûr doit être publiable avant la fin du lot complet.
// Revalidation distante : ce SHA est construit sur le main canonique courant.
test('issue #326 publie un premier résultat sûr pendant que la fin du lot reste volontairement bloquée', async () => {
  const items = Array.from({ length: 12 }, (_, index) => index + 1);
  const releaseTail = deferred<number[]>();
  const firstPartial = deferred<number[]>();
  let settled = false;
  let prefixCalls = 0;

  const run = filterResolvedPrefixes<number, number | null, number>(
    items,
    6,
    async prefix => {
      prefixCalls += 1;
      if (prefixCalls === 1) return prefix.map(id => id === 2 ? null : id);
      return releaseTail.promise.then(values => prefix.map((_, index) => values[index] ?? null));
    },
    (item, resolved) => resolved !== null && resolved !== undefined && item % 2 === 1 ? item : null,
    partial => {
      if (prefixCalls === 1) firstPartial.resolve(partial);
    },
  ).then(value => {
    settled = true;
    return value;
  });

  const first = await firstPartial.promise;
  assert.deepEqual(first, [1, 3, 5]);
  assert.equal(settled, false, 'la page finale ne doit pas bloquer le premier rendu sûr');
  assert.equal(prefixCalls, 2, 'la queue peut déjà préparer le préfixe suivant sans retarder le premier rendu');

  releaseTail.resolve([7, 8, 9, 10, 11, 12]);
  assert.deepEqual(await run, [1, 3, 5, 7, 9, 11]);
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

  assert.deepEqual(partials[0], [10, 30, 40, 50]);
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
