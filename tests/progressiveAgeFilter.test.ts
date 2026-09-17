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

// TNR terrain #326 v1.4.155 : l'ancien découpage par six restait bloqué car la
// route /parental-ratings répond seulement après le Promise.all du lot. La politique
// de production doit donc isoler chaque média dans la fenêtre critique tout en gardant
// six classifications maximum en vol.
test('issue #326 v1.4.155 un média lent ne bloque plus un voisin sûr du même ancien lot', async () => {
  const items = [1, 2, 3, 4, 5, 6];
  const blocked = deferred<number[]>();
  const firstPartial = deferred<number[]>();
  let settled = false;
  let active = 0;
  let maxActive = 0;

  const run = filterResolvedPrefixes<number, number | null, number>(
    items,
    1,
    async prefix => {
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
    (item, resolved) => resolved !== null && resolved !== undefined && item % 2 === 1 ? item : null,
    partial => firstPartial.resolve(partial),
    6,
  ).then(value => {
    settled = true;
    return value;
  });

  const first = await firstPartial.promise;
  assert.ok(first.includes(3), 'le premier voisin sûr doit être publiable pendant que le média 1 reste bloqué');
  assert.equal(first.includes(1), false, 'le média non résolu ne doit jamais fuiter');
  assert.equal(settled, false, 'le résultat final peut attendre le média lent sans retenir le premier résultat sûr');
  assert.equal(maxActive, 6, 'la fenêtre critique garde au plus six classifications indépendantes en vol');

  blocked.resolve([1]);
  assert.deepEqual(await run, [1, 3, 5]);
});

// TNR terrain #326 v1.4.157 : pour <= 10, le premier média admissible peut se
// trouver au-delà des six cartes visibles. Les six premiers ne doivent donc plus
// constituer une barrière implicite avant le premier résultat utile.
test('issue #326 v1.4.157 publie un résultat sûr au-delà des six premiers candidats dès la première vague', async () => {
  const items = Array.from({ length: 24 }, (_, index) => index + 1);
  const releaseFirstSix = deferred<void>();
  const firstPartial = deferred<number[]>();
  let settled = false;
  let active = 0;
  let maxActive = 0;

  const run = filterResolvedPrefixes<number, boolean, number>(
    items,
    1,
    async prefix => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      const id = prefix[0];
      if (id <= 6) await releaseFirstSix.promise;
      await Promise.resolve();
      active -= 1;
      return [id === 18];
    },
    (item, eligible) => eligible ? item : null,
    partial => firstPartial.resolve(partial),
    24,
  ).then(value => {
    settled = true;
    return value;
  });

  const first = await firstPartial.promise;
  assert.deepEqual(first, [18], 'un candidat admissible plus profond doit atteindre l’UI sans attendre les six premiers');
  assert.equal(settled, false, 'le résultat final peut attendre les candidats bloqués sans retenir le premier résultat sûr');
  assert.equal(maxActive, 24, 'la première vague doit utiliser toute la borne backend sans la dépasser');

  releaseFirstSix.resolve();
  assert.deepEqual(await run, [18]);
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
  const parentalBatchBackend = readFileSync('src/features/providers/parentalRatingBatchBackend.ts', 'utf8');

  assert.match(tmdbFacade, /discoverSeenItProgressive as discoverSeenIt/);
  assert.match(
    progressiveIntegration,
    /filterResolvedPrefixes<any, any \| null, any>\(\s*baseResult\.value\.results,\s*1,/,
    'la production doit casser la barrière Promise.all du lot en résolvant un média par préfixe',
  );
  assert.match(
    progressiveIntegration,
    /const PARENTAL_PROGRESSIVE_MAX_CONCURRENT = 24;/,
    'la fenêtre de classification restrictive doit couvrir au-delà des six cartes visibles',
  );
  assert.match(
    parentalBatchBackend,
    /PARENTAL_BATCH_MAX_CONCURRENT = 24;/,
    'la concurrence cliente doit rester alignée sur la borne explicite du backend',
  );
  assert.match(
    progressiveIntegration,
    /partialResults =>[\s\S]*?PARENTAL_PROGRESSIVE_MAX_CONCURRENT,\s*\);/,
    'la production doit appliquer la borne parentale dédiée au moteur progressif',
  );
  assert.doesNotMatch(
    progressiveIntegration,
    /DISCOVER_CRITICAL_GRID_ITEMS/,
    'la concurrence réseau parentale ne doit plus dépendre du nombre de cartes visibles',
  );
  assert.match(progressiveIntegration, /baseResult\.value[\s\S]*results: partialResults/);
  assert.match(discoverView, /useSyncExternalStore/);
  assert.match(discoverView, /model\.loading/);
  assert.match(discoverView, /snapshot\.partial/);
  assert.equal(existsSync(removedClientPath), false);
});
