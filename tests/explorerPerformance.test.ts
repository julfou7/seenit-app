import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  WATCH_PROVIDER_CACHE_MAX_ENTRIES,
  WATCH_PROVIDER_CACHE_STORAGE_KEY,
  flushWatchProviderCache,
  readWatchProviderCache,
  writeWatchProviderCache,
} from '../src/features/providers/watchProviderCache.ts';
import {
  WATCH_PROVIDER_MAX_CONCURRENT,
  createWatchProviderRequestLimiter,
  scheduleWatchProviderCardEnrichment,
} from '../src/features/providers/watchProviderRequestPolicy.ts';

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
  const cancel = scheduleWatchProviderCardEnrichment(
    () => { enrichmentRuns += 1; },
    {
      requestIdleCallback: callback => { idleTask = callback; return 7; },
      cancelIdleCallback: () => {},
      setTimeout: () => 0,
      clearTimeout: () => {},
    },
  );
  assert.equal(enrichmentRuns, 0, 'le diffuseur ne doit pas être chargé dans la frame d’intersection');
  idleTask?.();
  assert.equal(enrichmentRuns, 1);
  cancel();

  const tmdbClientSource = readFileSync(new URL('../src/features/shows/tmdbClient.ts', import.meta.url), 'utf8');
  const gridSource = readFileSync(new URL('../src/components/GridMediaCard.tsx', import.meta.url), 'utf8');
  const discoverSource = readFileSync(new URL('../src/screens/DiscoverScreen.tsx', import.meta.url), 'utf8');
  const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const cssSource = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');

  assert.match(tmdbClientSource, /watchProvidersInFlight/);
  assert.match(tmdbClientSource, /if \(existingRequest\) return existingRequest/);
  assert.match(tmdbClientSource, /watchProviderRequestLimiter\.run/);
  assert.match(gridSource, /observeWatchProviderCard\(cardRef\.current/);
  assert.doesNotMatch(gridSource, /new IntersectionObserver/);
  assert.match(gridSource, /scheduleWatchProviderCardEnrichment\(enrichProvider\)/);
  assert.doesNotMatch(gridSource, /networkMode:\s*['"]active['"]/);
  assert.match(gridSource, /media-grid-card/);
  assert.match(cssSource, /\.media-grid-card\s*\{[\s\S]*content-visibility:\s*auto/);
  assert.match(cssSource, /contain-intrinsic-size:\s*auto 240px/);
  assert.match(discoverSource, /const handleToggleWatched = useCallback/);
  assert.match(discoverSource, /const handleAddMedia = useCallback/);
  assert.match(discoverSource, /onLongPress=\{handleLongPress\}/);
  assert.ok(discoverSource.includes("key={`grid_${item.media_type || 'media'}_${item.id}`}"));
  assert.ok(!discoverSource.includes("key={`grid_${item.media_type || 'media'}_${item.id}_${idx}`}"));
  assert.match(appSource, /const openTmdbMedia = useCallback/);
  assert.match(appSource, /<DiscoverScreen onShowClick=\{openTmdbMedia\}/);
});
