import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  WATCH_PROVIDER_CACHE_MAX_ENTRIES,
  WATCH_PROVIDER_CACHE_STALE_MAX_AGE_MS,
  WATCH_PROVIDER_CACHE_STORAGE_KEY,
  WATCH_PROVIDER_CACHE_TTL_MS,
  flushWatchProviderCache,
  readWatchProviderCache,
  writeWatchProviderCache,
} from '../src/features/providers/watchProviderCache.ts';
import {
  WATCH_PROVIDER_CARD_SCROLL_SETTLE_MS,
  WATCH_PROVIDER_MAX_CONCURRENT,
  createWatchProviderRequestLimiter,
  markWatchProviderCardInteraction,
  scheduleWatchProviderCardEnrichment,
} from '../src/features/providers/watchProviderRequestPolicy.ts';
import {
  arePassiveProviderStatesEqual,
  isPassiveProviderResolutionComplete,
  resolvePassiveProviderState,
} from '../src/features/providers/passiveProviderState.ts';
import {
  createPassiveCardEnrichmentGate,
  PASSIVE_CARD_FAILURE_RETRY_MS,
} from '../src/features/providers/passiveCardEnrichmentPolicy.ts';

class InstrumentedStorage {
  gets = 0;
  sets = 0;
  private value: string | null;

  constructor(value: string | null = null) {
    this.value = value;
  }

  getItem(): string | null {
    this.gets += 1;
    return this.value;
  }

  setItem(_key: string, value: string): void {
    this.sets += 1;
    this.value = value;
  }

  snapshot(): string | null {
    return this.value;
  }
}

const providerPayload = {
  results: {
    FR: {
      flatrate: Array.from({ length: 12 }, (_, index) => ({
        display_priority: index,
        logo_path: `/provider-${index}.png`,
        provider_id: index + 1,
        provider_name: `Diffuseur ${index + 1}`,
      })),
    },
  },
};

test('SEENIT-PERF-001 regroupe la persistance des diffuseurs hors du scroll', () => {
  const seed = Object.fromEntries(
    Array.from({ length: WATCH_PROVIDER_CACHE_MAX_ENTRIES }, (_, index) => [
      `movie:${index + 1}`,
      { data: providerPayload, timestamp: 1_000_000 + index },
    ])
  );
  const storage = new InstrumentedStorage(JSON.stringify(seed));

  for (let index = 0; index < 60; index += 1) {
    const id = 1_000 + index;
    readWatchProviderCache(id, 'movie', { storage, now: 2_000_000 });
    readWatchProviderCache(id, 'movie', { storage, now: 2_000_000, allowStale: true });
    writeWatchProviderCache(id, 'movie', providerPayload, {
      storage,
      now: 2_000_000 + index,
      defer: true,
    });
  }

  assert.equal(storage.gets, 1, 'le snapshot localStorage doit être parsé une seule fois');
  assert.equal(storage.sets, 0, 'aucune sérialisation ne doit arriver dans la rafale de cartes');
  assert.equal(
    readWatchProviderCache(1_059, 'movie', { storage, now: 2_000_100 })?.data,
    providerPayload,
    'une écriture différée doit rester immédiatement lisible depuis la mémoire',
  );

  flushWatchProviderCache(storage);
  assert.equal(storage.sets, 1, 'la rafale doit produire une seule persistance coalescée');
  const persisted = JSON.parse(storage.snapshot() || '{}');
  assert.equal(Object.keys(persisted).length, WATCH_PROVIDER_CACHE_MAX_ENTRIES);
  assert.ok(persisted['movie:1059']);
  assert.equal(WATCH_PROVIDER_CACHE_STORAGE_KEY, 'seenit_watch_providers_v1');
});

test('SEENIT-PERF-001 réhydrate un diffuseur quand une carte virtualisée est remontée', () => {
  const writtenAt = 5_000_000;
  const storage = new InstrumentedStorage();
  writeWatchProviderCache(42, 'movie', providerPayload, {
    storage,
    now: writtenAt,
    defer: false,
  });

  const firstMount = readWatchProviderCache(42, 'movie', {
    storage,
    now: writtenAt + 1,
    allowStale: true,
  });
  const recycledMount = readWatchProviderCache(42, 'movie', {
    storage,
    now: writtenAt + 2,
    allowStale: true,
  });

  assert.equal(firstMount?.data, providerPayload);
  assert.equal(recycledMount?.data, providerPayload);
  assert.equal(recycledMount?.fresh, true, 'un remontage dans le TTL doit réutiliser immédiatement le diffuseur');
  assert.equal(storage.gets, 1, 'les remontages ne doivent pas reparcourir localStorage');

  const stale = readWatchProviderCache(42, 'movie', {
    storage,
    now: writtenAt + WATCH_PROVIDER_CACHE_TTL_MS + 1,
    allowStale: true,
  });
  assert.equal(stale?.fresh, false, 'une valeur ancienne reste affichable pendant le rafraîchissement passif');
  assert.equal(
    readWatchProviderCache(42, 'movie', {
      storage,
      now: writtenAt + WATCH_PROVIDER_CACHE_STALE_MAX_AGE_MS,
      allowStale: true,
    }),
    null,
    'le stale-if-error reste borné à sept jours',
  );
});

test('SEENIT-PERF-001 conserve les résultats diffuseurs positifs et négatifs au recyclage', () => {
  const publicProvider = { logo_path: '/netflix.png', provider_name: 'Netflix' };
  const publicState = resolvePassiveProviderState('movie:42', publicProvider, {
    available: true,
    serverName: 'Salon',
  });
  assert.equal(publicState.logo, '/netflix.png', 'le diffuseur public reste prioritaire sur Plex');
  assert.equal(publicState.name, 'Netflix');

  const plexState = resolvePassiveProviderState('movie:84', null, {
    available: true,
    serverName: 'Salon',
  });
  assert.match(plexState.logo || '', /^data:image\/svg\+xml/);
  assert.equal(plexState.name, 'Plex (Salon)', 'le cache UID Plex est restitué sans Promise intermédiaire');

  const negativeState = resolvePassiveProviderState('movie:126', null, {
    available: false,
  });
  assert.deepEqual(negativeState, { key: 'movie:126', logo: null, name: null });
  assert.equal(
    isPassiveProviderResolutionComplete(false, true),
    true,
    'une réponse TMDB fraîche sans diffuseur est un résultat final, pas un chargement à relancer',
  );
  assert.equal(isPassiveProviderResolutionComplete(false, false), false);
  assert.equal(arePassiveProviderStatesEqual(negativeState, { ...negativeState }), true);
});

test('SEENIT-PERF-001 temporise les enrichissements décoratifs négatifs de Ma Liste', () => {
  const gate = createPassiveCardEnrichmentGate(2);
  assert.equal(gate.tryStart('movie:1', 1_000), true);
  assert.equal(gate.tryStart('movie:1', 1_000), false, 'une requête en vol est dédupliquée entre remontages');

  gate.fail('movie:1', 2_000);
  assert.equal(
    gate.tryStart('movie:1', 2_000 + PASSIVE_CARD_FAILURE_RETRY_MS - 1),
    false,
    'un échec récent ne relance pas le détail décoratif quand la carte revient à l’écran',
  );
  assert.equal(gate.tryStart('movie:1', 2_000 + PASSIVE_CARD_FAILURE_RETRY_MS), true);
  gate.succeed('movie:1');
  assert.equal(gate.tryStart('movie:1', 2_001), true, 'un succès libère immédiatement le verrou de session');
});

test('SEENIT-PERF-001 borne le fan-out diffuseurs et stabilise les cartes Explorer', async () => {
  const limiter = createWatchProviderRequestLimiter();
  let active = 0;
  let maxActive = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });

  const requests = Array.from({ length: 12 }, (_, index) => limiter.run(async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    if (index < WATCH_PROVIDER_MAX_CONCURRENT) await gate;
    await new Promise(resolve => setTimeout(resolve, 1));
    active -= 1;
    return index;
  }));

  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(limiter.getActiveCount(), WATCH_PROVIDER_MAX_CONCURRENT);
  assert.equal(limiter.getPendingCount(), 12 - WATCH_PROVIDER_MAX_CONCURRENT);
  release();
  assert.deepEqual(await Promise.all(requests), Array.from({ length: 12 }, (_, index) => index));
  assert.equal(maxActive, WATCH_PROVIDER_MAX_CONCURRENT);

  let idleTask: (() => void) | undefined;
  let enrichmentRuns = 0;
  let now = 10_000;
  markWatchProviderCardInteraction(0);
  const cancel = scheduleWatchProviderCardEnrichment(
    () => { enrichmentRuns += 1; },
    {
      requestIdleCallback: callback => { idleTask = callback; return 7; },
      cancelIdleCallback: () => {},
      setTimeout: () => 0,
      clearTimeout: () => {},
      now: () => now,
    },
  );
  assert.equal(enrichmentRuns, 0, 'le diffuseur ne doit pas être chargé dans la frame d’intersection');
  idleTask?.();
  assert.equal(enrichmentRuns, 1);
  cancel();

  const tmdbClientSource = readFileSync(new URL('../src/features/shows/tmdbClient.ts', import.meta.url), 'utf8');
  const gridSource = readFileSync(new URL('../src/components/GridMediaCard.tsx', import.meta.url), 'utf8');
  const passiveProviderSource = readFileSync(new URL('../src/hooks/usePassiveWatchProvider.ts', import.meta.url), 'utf8');
  const discoverSource = readFileSync(new URL('../src/screens/DiscoverScreen.tsx', import.meta.url), 'utf8');
  const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const cssSource = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  const providerPolicySource = readFileSync(new URL('../src/features/providers/watchProviderRequestPolicy.ts', import.meta.url), 'utf8');

  assert.match(tmdbClientSource, /watchProvidersInFlight/);
  assert.match(tmdbClientSource, /if \(existingRequest\) return existingRequest/);
  assert.match(tmdbClientSource, /watchProviderRequestLimiter\.run/);
  assert.match(gridSource, /usePassiveWatchProvider/);
  assert.match(passiveProviderSource, /observeWatchProviderCard\(cardRef\.current/);
  assert.doesNotMatch(gridSource, /new IntersectionObserver/);
  assert.match(passiveProviderSource, /scheduleWatchProviderCardEnrichment\(enrichProvider\)/);
  assert.match(passiveProviderSource, /readWatchProviderCache\(tmdbId, mediaType, \{ allowStale: true \}\)/);
  assert.match(passiveProviderSource, /tmdb\.peekWatchProviders\(tmdbId, mediaType\)/);
  assert.match(passiveProviderSource, /writeWatchProviderCache\(numericTmdbId, mediaType, res\.value\)/);
  assert.match(passiveProviderSource, /usePlexAvailabilityStore\(state =>/);
  assert.match(passiveProviderSource, /isPassiveProviderResolutionComplete/);
  assert.doesNotMatch(
    passiveProviderSource,
    /checkPlexAvailability/,
    'une carte passive doit lire le cache Plex synchroniquement sans recréer de Promise à chaque remontage',
  );
  assert.doesNotMatch(
    passiveProviderSource,
    /writeWatchProviderCache\([^\n]*PLEX_LOGO_SVG/,
    'Plex ne doit jamais être persisté dans le cache public des diffuseurs TMDB',
  );
  assert.doesNotMatch(gridSource, /networkMode:\s*['"]active['"]/);
  assert.match(gridSource, /media-grid-card/);
  assert.doesNotMatch(
    providerPolicySource,
    /requestIdleCallback\([^\n]+timeout/,
    'un enrichissement décoratif ne doit jamais être forcé par timeout pendant le scroll',
  );
  assert.match(providerPolicySource, /addEventListener\('scroll'/);
  assert.match(providerPolicySource, /WATCH_PROVIDER_CARD_SCROLL_SETTLE_MS/);
  assert.doesNotMatch(
    cssSource,
    /\.media-grid-card\s*\{[\s\S]*?content-visibility:\s*auto/,
    'les cartes interactives ne doivent pas réactiver layout/paint juste à l’entrée du viewport',
  );
  assert.doesNotMatch(
    cssSource,
    /contain-intrinsic-size:\s*auto 240px/,
    'le placeholder de rendu différé de #230 ne doit pas être réintroduit sans preuve terrain de frame pacing',
  );
  assert.match(discoverSource, /const handleToggleWatched = useCallback/);
  assert.match(discoverSource, /const handleAddMedia = useCallback/);
  assert.match(discoverSource, /onLongPress=\{handleLongPress\}/);
  assert.match(discoverSource, /useGridVirtualWindow/);
  assert.match(discoverSource, /debouncedQuery\.trim\(\) \? \(/);
  assert.match(discoverSource, /<BoundedDiscoverGrid/);
  assert.ok(discoverSource.includes("`grid_${item.media_type || 'media'}_${item.id}`"));
  assert.match(appSource, /const openTmdbMedia = useCallback/);
  assert.match(appSource, /<DiscoverScreen onShowClick=\{openTmdbMedia\}/);
});

test('SEENIT-PERF-001 ne force jamais l’enrichissement diffuseur pendant un scroll actif', () => {
  let now = 20_000;
  const timeouts: Array<{ callback: () => void; delay: number }> = [];
  let idleTask: (() => void) | undefined;
  let enrichmentRuns = 0;

  const scheduler = {
    requestIdleCallback: (callback: () => void) => {
      idleTask = callback;
      return 9;
    },
    cancelIdleCallback: () => {},
    setTimeout: (callback: () => void, delay: number) => {
      timeouts.push({ callback, delay });
      return timeouts.length;
    },
    clearTimeout: () => {},
    now: () => now,
  };

  markWatchProviderCardInteraction(now);
  const cancel = scheduleWatchProviderCardEnrichment(
    () => { enrichmentRuns += 1; },
    scheduler,
  );

  assert.equal(idleTask, undefined, 'aucune tâche idle ne doit être armée tant que le scroll vient d’avoir lieu');
  assert.equal(timeouts.length, 1);
  assert.equal(timeouts[0].delay, WATCH_PROVIDER_CARD_SCROLL_SETTLE_MS);

  now += WATCH_PROVIDER_CARD_SCROLL_SETTLE_MS;
  timeouts.shift()?.callback();
  assert.ok(idleTask, 'une tâche idle peut être armée après une vraie fenêtre sans scroll');

  markWatchProviderCardInteraction(now);
  now += 1;
  const interruptedIdleTask = idleTask;
  idleTask = undefined;
  interruptedIdleTask?.();
  assert.equal(enrichmentRuns, 0, 'un nouveau scroll doit invalider la fenêtre idle déjà armée');
  assert.equal(timeouts.length, 1);
  assert.ok(timeouts[0].delay >= WATCH_PROVIDER_CARD_SCROLL_SETTLE_MS - 1);

  now += WATCH_PROVIDER_CARD_SCROLL_SETTLE_MS;
  timeouts.shift()?.callback();
  assert.ok(idleTask);
  idleTask?.();
  assert.equal(enrichmentRuns, 1, 'l’enrichissement ne démarre qu’après stabilisation du scroll puis période idle');

  cancel();
  markWatchProviderCardInteraction(0);
});
