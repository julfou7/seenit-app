import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import {
  createPagePrefetchWindow,
  createSupersedingAbortController,
  filterResolvedPrefixes,
  mergeProgressivePageItems,
  shouldApplyProgressivePartial,
  stabilizeProgressiveDisplayItems,
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

// TNR terrain #326 v1.4.159 : une page "Tout" peut contenir 40 candidats.
// Les positions 25-40 doivent entrer dans le transport initial, même si les 24
// premières preuves restent bloquées. La borne 24 appartient au backend fournisseur,
// pas au scheduler de coalescing client.
test('issue #326 v1.4.159 démarre les 40 candidats avant qu’un des 24 premiers ne se débloque', async () => {
  const items = Array.from({ length: 40 }, (_, index) => index + 1);
  const releaseBlocked = deferred<void>();
  const firstPartial = deferred<number[]>();
  const started: number[] = [];
  let settled = false;

  const run = filterResolvedPrefixes<number, boolean, number>(
    items,
    1,
    async prefix => {
      const id = prefix[0];
      started.push(id);
      if (id <= 24) await releaseBlocked.promise;
      return [id === 37];
    },
    (item, eligible) => eligible ? item : null,
    partial => firstPartial.resolve(partial),
    40,
  ).then(value => {
    settled = true;
    return value;
  });

  const first = await firstPartial.promise;
  assert.deepEqual(first, [37], 'un résultat rare après la position 24 doit être publiable dans la vague initiale');
  assert.equal(started.length, 40, 'toute la page brute doit être enqueued avant le premier refill');
  assert.equal(settled, false, 'les 24 premières preuves peuvent rester lentes sans retenir le résultat profond');

  releaseBlocked.resolve();
  assert.deepEqual(await run, [37]);
});

test('issue #326 v1.4.166 précharge les deux pages source suivantes sans attendre la page courante', async () => {
  const prefetch = createPagePrefetchWindow<number>(2, 6);
  const releasePageOne = deferred<void>();
  const started: number[] = [];
  const loader = async (page: number) => {
    started.push(page);
    if (page === 1) await releasePageOne.promise;
    return page;
  };

  const pageOne = prefetch.get('tp-filter', 1, loader);
  const primed = prefetch.primeAhead('tp-filter', 1, loader);
  await Promise.resolve();

  assert.equal(pageOne.reused, false);
  assert.deepEqual(primed, [2, 3]);
  assert.deepEqual([...started].sort((a, b) => a - b), [1, 2, 3], 'les pages 2 et 3 démarrent pendant que la page 1 est encore bloquée');

  const pageTwo = prefetch.get('tp-filter', 2, loader);
  assert.equal(pageTwo.reused, true, 'la pagination doit consommer la requête déjà préchargée');
  assert.equal(await pageTwo.promise, 2);
  assert.equal(started.filter(page => page === 2).length, 1, 'la page 2 ne doit jamais être redemandée');

  const nextFilterPage = prefetch.get('age-7-filter', 2, loader);
  assert.equal(nextFilterPage.reused, false, 'un changement de filtre invalide immédiatement la fenêtre source');
  assert.equal(await nextFilterPage.promise, 2);
  assert.equal(started.filter(page => page === 2).length, 2);

  releasePageOne.resolve();
  assert.equal(await pageOne.promise, 1);
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

test('issue #326 publie les snapshots de toutes les pages mais ignore les générations obsolètes', () => {
  assert.equal(shouldApplyProgressivePartial(4, 4, 1), true);
  assert.equal(shouldApplyProgressivePartial(4, 4, 2), true);
  assert.equal(shouldApplyProgressivePartial(3, 4, 2), false);
  assert.equal(shouldApplyProgressivePartial(4, 4, 0), false);
});

test('issue #326 ajoute une page progressive sans retirer les résultats stables précédents', () => {
  const page1 = [{ id: 10, media_type: 'movie' }, { id: 20, media_type: 'tv' }];
  const page2Partial = [{ id: 20, media_type: 'tv' }, { id: 30, media_type: 'tv' }];
  const keyOf = (item: any) => `${item.media_type}:${item.id}`;
  assert.deepEqual(mergeProgressivePageItems(page1, page2Partial, 2, keyOf).map(item => item.id), [10, 20, 30]);
  assert.deepEqual(mergeProgressivePageItems(page1, page2Partial, 1, keyOf).map(item => item.id), [20, 30]);
});

test('issue #326 terrain v1.4.173 garde les cartes déjà affichées dans un ordre stable', () => {
  const keyOf = (item: { id: number }) => String(item.id);

  const first = stabilizeProgressiveDisplayItems(
    [{ id: 3 }, { id: 7 }],
    [],
    keyOf,
  );
  assert.deepEqual(first.items.map(item => item.id), [3, 7]);

  const later = stabilizeProgressiveDisplayItems(
    [{ id: 1 }, { id: 3 }, { id: 5 }, { id: 7 }],
    first.order,
    keyOf,
  );
  assert.deepEqual(
    later.items.map(item => item.id),
    [3, 7, 1, 5],
    'une preuve arrivée tardivement ne doit jamais s’insérer devant une carte déjà visible',
  );

  const complete = stabilizeProgressiveDisplayItems(
    [{ id: 1 }, { id: 3 }, { id: 5 }, { id: 7 }, { id: 9 }],
    later.order,
    keyOf,
  );
  assert.deepEqual(
    complete.items.map(item => item.id),
    [3, 7, 1, 5, 9],
    'le passage du snapshot progressif au résultat complet ne doit pas provoquer de snap-back',
  );
});

test('issue #326 le point d’entrée production utilise le moteur progressif sans réintroduire le client historique', () => {
  const showsRoot = ['src', 'features', 'shows'].join('/');
  const tmdbFacadePath = [showsRoot, 'tmdb.ts'].join('/');
  const removedClientPath = [showsRoot, ['tmdb', 'ClientCore.ts'].join('')].join('/');
  const tmdbFacade = readFileSync(tmdbFacadePath, 'utf8');
  const progressiveIntegration = readFileSync('src/features/discover/progressiveAgeFilter.ts', 'utf8');
  const discoverView = readFileSync('src/screens/DiscoverView.tsx', 'utf8');
  const discoverViewCore = readFileSync('src/screens/DiscoverViewCore.tsx', 'utf8');
  const parentalBatchBackend = readFileSync('src/features/providers/parentalRatingBatchBackend.ts', 'utf8');

  assert.match(tmdbFacade, /discoverSeenItProgressive as discoverSeenIt/);
  assert.match(
    progressiveIntegration,
    /filterResolvedPrefixes<any, any \| null, any>\(\s*baseResult\.value\.results,\s*1,/,
    'la production doit casser la barrière Promise.all du lot en résolvant un média par préfixe',
  );
  assert.match(
    progressiveIntegration,
    /const PARENTAL_TRANSPORT_MAX_ITEMS = 40;/,
    'le transport parental doit conserver sa capacité d’une page Tout complète',
  );
  assert.match(
    progressiveIntegration,
    /const PARENTAL_PROGRESSIVE_MAX_CONCURRENT = PARENTAL_TRANSPORT_MAX_ITEMS;/,
    'le scheduler client doit enqueuer toute la page avant la microtask de transport',
  );
  assert.match(
    parentalBatchBackend,
    /PARENTAL_BATCH_MAX_CONCURRENT = 24;/,
    'la vraie concurrence fournisseur reste bornée côté backend',
  );
  assert.doesNotMatch(
    progressiveIntegration,
    /const PARENTAL_PROGRESSIVE_MAX_CONCURRENT = 24;/,
    'la borne fournisseur ne doit plus tronquer la fenêtre de coalescing client',
  );
  assert.match(
    progressiveIntegration,
    /const PROGRESSIVE_SNAPSHOT_BATCH_MS = 120;/,
    'les lignes NDJSON proches doivent être regroupées avant le repaint de la grille',
  );
  assert.match(
    progressiveIntegration,
    /const AGE_SOURCE_PREFETCH_AHEAD = 2;/,
    'le filtre âge doit garder deux pages Discover source en avance',
  );
  assert.match(progressiveIntegration, /createPagePrefetchWindow</);
  assert.match(progressiveIntegration, /sourcePagePrefetch\.get\(sourcePrefetchKey, page, loadSourcePage\)/);
  assert.match(progressiveIntegration, /sourcePagePrefetch\.primeAhead\(sourcePrefetchKey, page, loadSourcePage\)/);
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
  assert.match(discoverView, /progressiveRequestActive = page === 1 \? model\.loading : page > 1 && model\.isLoadingMore/);
  assert.match(discoverView, /snapshot\?\.partial/);
  assert.match(discoverView, /model\.processRawResults\(mergedItems\)/);
  assert.match(discoverView, /mergeProgressivePageItems/);
  assert.match(discoverView, /stabilizeProgressiveDisplayItems/);
  assert.match(discoverView, /stableOrderRef = useRef<string\[\]>\(\[\]\)/);
  assert.match(discoverView, /stableProgressiveOrderEnabled = ageFilterActive && model\.sortBy === 'popular'/);
  assert.match(
    discoverView,
    /hasMore: page > 1 \? model\.hasMore : false,[\s\S]*suppressEndOfResults: true/,
    'la page 1 progressive peut bloquer temporairement la pagination sans annoncer une fin définitive',
  );
  assert.match(
    discoverViewCore,
    /!suppressEndOfResults && \(uniqueProcessedResults\.length > 0/,
    'le point d’entrée UI réel doit masquer « Fin des résultats » pendant un snapshot progressif',
  );
  assert.equal(existsSync(removedClientPath), false);
});


test('issue #326 annule immédiatement la génération parentale précédente', () => {
  const nextController = createSupersedingAbortController();
  const first = nextController();
  assert.equal(first.signal.aborted, false);
  const second = nextController();
  assert.equal(first.signal.aborted, true, 'un nouveau filtre doit interrompre la génération précédente');
  assert.equal(second.signal.aborted, false);
  const third = nextController();
  assert.equal(second.signal.aborted, true);
  assert.equal(third.signal.aborted, false);
});
