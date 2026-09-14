import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import {
  PROFILE_ANALYTICS_METADATA_TTL_MS,
  PROFILE_ANALYTICS_STORAGE_FIELD,
  applyProfileAnalyticsContributions,
  readProfileAnalyticsDisplayBaseline,
  readProfileAnalyticsSnapshot,
  reconcileProfileAnalyticsSnapshot,
  repairProfileAnalyticsSnapshot,
  writeProfileAnalyticsDisplayBaseline,
  writeProfileAnalyticsSnapshot,
  type AnalyticsMediaContribution,
  type ProfileAnalyticsSnapshot,
} from '../src/features/profile/profileAnalyticsSnapshot.ts';
import { getUserScopedStorageKey } from '../src/lib/userIsolation.ts';
import type { Show } from '../src/types.ts';

const storage = new Map<string, string>();
let storageQuota = Number.POSITIVE_INFINITY;
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      const nextSize = Array.from(storage.entries()).reduce(
        (size, [storedKey, storedValue]) => size + (storedKey === key ? 0 : storedKey.length + storedValue.length),
        key.length + value.length,
      );
      if (nextSize > storageQuota) throw new Error('QuotaExceededError');
      storage.set(key, value);
    },
    removeItem: (key: string) => { storage.delete(key); },
    clear: () => { storage.clear(); },
  },
});

const makeShow = ({
  id,
  mediaType = 'movie',
  status = 'completed',
  seenEpisodes,
  title,
  totalEpisodes = 12,
  detailsSyncedAt = 1,
}: {
  id: number;
  mediaType?: Show['mediaType'];
  status?: Show['status'];
  seenEpisodes?: string[];
  title?: string;
  totalEpisodes?: number;
  detailsSyncedAt?: number;
}): Show => ({
  id: `${mediaType}-${id}`,
  userId: 'user-a',
  tmdbId: id,
  title: title || `${mediaType}-${id}`,
  mediaType,
  posterPath: null,
  backdropPath: null,
  status,
  isArchived: false,
  updatedAt: 1,
  createdAt: 1,
  seenEpisodes: seenEpisodes || (mediaType === 'movie' && status === 'completed' ? ['movie'] : []),
  episodeRecords: {},
  totalEpisodes,
  detailsSyncedAt,
  networks: [{ name: id % 2 === 0 ? 'Netflix' : 'Canal+' }],
});

const isWatched = (show: Show) => show.mediaType === 'movie'
  ? show.status === 'completed' || show.seenEpisodes.includes('movie')
  : show.status === 'completed' || show.seenEpisodes.length > 0;

const contribution = (
  genre: string,
  actorId: number,
  directorId = actorId + 10_000,
): AnalyticsMediaContribution => ({
  genres: [genre],
  actors: [{
    id: actorId,
    name: `Actor ${actorId}`,
    profile_path: `/actor-${actorId}.jpg`,
    popularity: actorId,
  }],
  directors: [{
    id: directorId,
    name: `Director ${directorId}`,
    profile_path: null,
    popularity: directorId,
  }],
});

const reconcile = (
  uid: string,
  shows: Show[],
  previous: ProfileAnalyticsSnapshot | null,
  now: number,
) => reconcileProfileAnalyticsSnapshot({ uid, shows, previous, now, isWatched });

test('SEENIT-PERF-001 persiste une baseline Profil versionnée et isolée par UID', () => {
  storage.clear();
  storageQuota = Number.POSITIVE_INFINITY;
  const now = 2_000_000_000_000;
  const shows = [makeShow({ id: 1 })];
  const initial = reconcile('user-a', shows, null, now);
  applyProfileAnalyticsContributions(initial.snapshot, [
    { mediaKey: 'movie:1', contribution: contribution('Action', 7) },
  ], now);
  writeProfileAnalyticsSnapshot(initial.snapshot);

  const restored = readProfileAnalyticsSnapshot('user-a');
  assert.ok(restored);
  assert.equal(restored.data.totalMoviesSeen, 1);
  assert.equal(restored.data.topActors[0]?.id, 7);
  assert.equal(readProfileAnalyticsSnapshot('user-b'), null);

  const resumed = reconcile('user-a', shows, restored, now + 1_000);
  assert.equal(resumed.mode, 'snapshot-exact');
  assert.deepEqual(resumed.snapshot.data, restored.data);
  assert.deepEqual(resumed.metadataKeys, []);
});

test('SEENIT-PERF-001 applique les ajouts retraits et progressions par delta', () => {
  const now = 2_000_000_000_000;
  const movie = makeShow({ id: 1 });
  const series = makeShow({
    id: 2,
    mediaType: 'tv',
    status: 'watching',
    seenEpisodes: ['1x1', '1x2'],
    title: 'Série test',
  });
  const initial = reconcile('user-a', [movie, series], null, now);
  applyProfileAnalyticsContributions(initial.snapshot, [
    { mediaKey: 'movie:1', contribution: contribution('Action', 7) },
    { mediaKey: 'tv:2', contribution: contribution('Drame', 7) },
  ], now);
  assert.equal(initial.snapshot.data.topActors[0]?.count, 2);

  const addedMovie = makeShow({ id: 3 });
  const added = reconcile('user-a', [movie, series, addedMovie], initial.snapshot, now + 1_000);
  assert.deepEqual(added.changedMediaKeys, ['movie:3']);
  assert.deepEqual(added.metadataKeys, ['movie:3']);
  assert.equal(added.snapshot.data.topActors[0]?.count, 2);
  applyProfileAnalyticsContributions(added.snapshot, [
    { mediaKey: 'movie:3', contribution: contribution('Comédie', 8) },
  ], now + 1_000);

  const removed = reconcile('user-a', [series, addedMovie], added.snapshot, now + 2_000);
  assert.deepEqual(removed.changedMediaKeys, ['movie:1']);
  assert.equal(removed.snapshot.data.totalMoviesSeen, 1);
  assert.equal(removed.snapshot.data.genres.some((genre) => genre.name === 'Action'), false);
  assert.equal(removed.snapshot.data.topActors.find((actor) => actor.id === 7)?.count, 1);

  const actorsBeforeProgress = removed.snapshot.data.topActors;
  const progressedSeries = makeShow({
    id: 2,
    mediaType: 'tv',
    status: 'watching',
    seenEpisodes: ['1x1', '1x2', '1x3'],
    title: 'Série test',
  });
  const progressed = reconcile('user-a', [progressedSeries, addedMovie], removed.snapshot, now + 3_000);
  assert.deepEqual(progressed.changedMediaKeys, ['tv:2']);
  assert.deepEqual(progressed.metadataKeys, []);
  assert.equal(progressed.snapshot.data.totalEpisodesSeen, 3);
  assert.strictEqual(progressed.snapshot.data.topActors, actorsBeforeProgress);

  const rebuilt = reconcile('user-a', [progressedSeries, addedMovie], null, now + 3_000);
  applyProfileAnalyticsContributions(rebuilt.snapshot, [
    { mediaKey: 'tv:2', contribution: contribution('Drame', 7) },
    { mediaKey: 'movie:3', contribution: contribution('Comédie', 8) },
  ], now + 3_000);
  assert.deepEqual(progressed.snapshot.data, rebuilt.snapshot.data);
});

test('SEENIT-PERF-001 invalide seulement la métadonnée expirée et répare un snapshot', () => {
  storage.clear();
  storageQuota = Number.POSITIVE_INFINITY;
  const now = 2_000_000_000_000;
  const shows = [makeShow({ id: 1 }), makeShow({ id: 2 })];
  const initial = reconcile('user-a', shows, null, now);
  applyProfileAnalyticsContributions(initial.snapshot, [
    { mediaKey: 'movie:1', contribution: contribution('Action', 7) },
    { mediaKey: 'movie:2', contribution: contribution('Drame', 8) },
  ], now);
  initial.snapshot.contributions['movie:1'].fetchedAt = now - PROFILE_ANALYTICS_METADATA_TTL_MS;

  const stale = reconcile('user-a', shows, initial.snapshot, now);
  assert.equal(stale.mode, 'snapshot-exact');
  assert.deepEqual(stale.metadataKeys, ['movie:1']);
  applyProfileAnalyticsContributions(stale.snapshot, [
    { mediaKey: 'movie:1', contribution: contribution('Science-Fiction', 9) },
  ], now);

  const revisedShows = [makeShow({ id: 1, detailsSyncedAt: 2 }), shows[1]];
  const revised = reconcile('user-a', revisedShows, stale.snapshot, now + 1);
  assert.deepEqual(revised.metadataKeys, ['movie:1']);
  const retryAfterFailure = reconcile('user-a', revisedShows, revised.snapshot, now + 2);
  assert.deepEqual(retryAfterFailure.metadataKeys, ['movie:1']);
  applyProfileAnalyticsContributions(retryAfterFailure.snapshot, [
    { mediaKey: 'movie:1', contribution: contribution('Science-Fiction', 9) },
  ], now + 2);
  const expected = structuredClone(retryAfterFailure.snapshot.data);

  retryAfterFailure.snapshot.aggregate.totalMinutes = 99_999;
  retryAfterFailure.snapshot.aggregate.genreCounts.Action = 99;
  repairProfileAnalyticsSnapshot(retryAfterFailure.snapshot, now + 3);
  assert.deepEqual(retryAfterFailure.snapshot.data, expected);

  storage.set(
    getUserScopedStorageKey('corrupt', PROFILE_ANALYTICS_STORAGE_FIELD),
    JSON.stringify({ version: -1, uid: 'corrupt' }),
  );
  assert.equal(readProfileAnalyticsSnapshot('corrupt'), null);
  assert.equal(storage.has(getUserScopedStorageKey('corrupt', PROFILE_ANALYTICS_STORAGE_FIELD)), false);
});

test('SEENIT-PERF-001 borne le coût incrémental sur une bibliothèque représentative', () => {
  const now = 2_000_000_000_000;
  const shows = Array.from({ length: 1_000 }, (_, index) => makeShow({
    id: index + 1,
    mediaType: 'tv',
    status: 'watching',
    seenEpisodes: ['1x1'],
    totalEpisodes: 24,
  }));
  const initial = reconcile('benchmark-user', shows, null, now);
  applyProfileAnalyticsContributions(
    initial.snapshot,
    shows.map((show) => ({
      mediaKey: `tv:${show.tmdbId}`,
      contribution: contribution('Drame', 7),
    })),
    now,
  );

  const progressed = [...shows];
  progressed[500] = { ...progressed[500], seenEpisodes: ['1x1', '1x2'] };
  const startedAt = performance.now();
  const delta = reconcile('benchmark-user', progressed, initial.snapshot, now + 1_000);
  const durationMs = performance.now() - startedAt;

  assert.equal(delta.mode, 'snapshot-delta');
  assert.deepEqual(delta.changedMediaKeys, ['tv:501']);
  assert.deepEqual(delta.metadataKeys, []);
  assert.equal(delta.snapshot.data.totalEpisodesSeen, 1_001);
  assert.ok(durationMs < 250, `réconciliation incrémentale trop lente : ${durationMs.toFixed(1)} ms`);
});

test('SEENIT-PERF-001 sépare la baseline d’affichage du snapshot de travail volumineux', () => {
  storage.clear();
  storageQuota = Number.POSITIVE_INFINITY;
  const now = 2_000_000_000_000;
  const firstShow = makeShow({ id: 1 });
  const small = reconcile('quota-user', [firstShow], null, now);
  applyProfileAnalyticsContributions(small.snapshot, [{
    mediaKey: 'movie:1',
    contribution: contribution('Action', 1),
  }], now);

  storageQuota = 20_000;
  assert.equal(writeProfileAnalyticsSnapshot(small.snapshot), true);

  const shows = Array.from({ length: 80 }, (_, index) => makeShow({ id: index + 1 }));
  const large = reconcile('quota-user', shows, null, now + 1);
  applyProfileAnalyticsContributions(
    large.snapshot,
    shows.map((show, showIndex) => ({
      mediaKey: `movie:${show.tmdbId}`,
      contribution: {
        genres: ['Action'],
        actors: Array.from({ length: 80 }, (_, actorIndex) => ({
          id: actorIndex + 1,
          name: `Actor ${actorIndex + 1}`,
          profile_path: `/actor-${actorIndex + 1}.jpg`,
          popularity: 100 - actorIndex,
        })),
        directors: [{
          id: 10_000 + showIndex,
          name: `Director ${showIndex}`,
          profile_path: null,
          popularity: showIndex,
        }],
      },
    })),
    now + 1,
  );

  assert.equal(writeProfileAnalyticsSnapshot(large.snapshot), false);
  assert.equal(
    readProfileAnalyticsSnapshot('quota-user')?.signature,
    small.snapshot.signature,
    'localStorage conserve silencieusement une ancienne baseline lorsque le gros snapshot dépasse le quota',
  );
  assert.equal(writeProfileAnalyticsDisplayBaseline(large.snapshot), true);
  assert.deepEqual(readProfileAnalyticsDisplayBaseline('quota-user')?.data, large.snapshot.data);
  assert.ok(
    JSON.stringify(readProfileAnalyticsDisplayBaseline('quota-user')).length * 20
      < JSON.stringify(large.snapshot).length,
    'la baseline immédiatement affichable doit rester très inférieure au snapshot de travail',
  );
  storageQuota = Number.POSITIVE_INFINITY;
});
