import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const detailCore = readFileSync(new URL('../src/screens/ShowDetailScreenCore.tsx', import.meta.url), 'utf8');
const showsStore = readFileSync(new URL('../src/store/showsStore.ts', import.meta.url), 'utf8');
const detailsWorker = readFileSync(new URL('../src/hooks/useDetailsSyncWorker.ts', import.meta.url), 'utf8');

function sliceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `Début introuvable: ${startMarker}`);
  assert.ok(end > start, `Fin introuvable: ${endMarker}`);
  return source.slice(start, end);
}

test('SEENIT-PERF-001 sert la progression série depuis le dernier état utilisateur persisté', () => {
  assert.match(showsStore, /SHOWS_CACHE_FIELD = 'shows_v2'/);
  assert.match(showsStore, /readUserScopedJson<Show\[\]>\(uid, SHOWS_CACHE_FIELD/);
  assert.match(showsStore, /writeUserScopedJson\(uid, SHOWS_CACHE_FIELD, shows\)/);
  assert.match(
    detailCore,
    /const totalEpisodes = show\?\.totalEpisodes \|\| tmdbDetails\?\.number_of_episodes \|\| show\?\.totalAiredEpisodes \|\| 0;/,
  );
  assert.match(detailCore, /const seenCount = isSeries \? \(show\?\.seenEpisodes\?\.length \|\| 0\)/);
});

test('SEENIT-PERF-001 applique un épisode vu ou non vu en delta sans resynchroniser toutes les saisons', () => {
  const episodeMutation = sliceBetween(
    detailCore,
    'const toggleEpisodeSeen = async',
    'const toggleSeasonSeen = async',
  );

  assert.match(episodeMutation, /await updateShow\(currentShow\.id, \{ seenEpisodes:/);
  assert.match(episodeMutation, /nextEpisodeToWatch: optimisticNextEp/);
  assert.match(episodeMutation, /status: optimisticNextEp \? 'watching' : 'completed'/);
  assert.doesNotMatch(episodeMutation, /syncSingleItem\(/);
  assert.doesNotMatch(episodeMutation, /isSynced:\s*false/);
});

test('SEENIT-PERF-001 applique une saison vue ou non vue en delta sans resynchronisation complète', () => {
  const seasonMutation = sliceBetween(
    detailCore,
    'const toggleSeasonSeen = async',
    'const toggleArchive = async',
  );

  assert.match(seasonMutation, /await updateShow\(currentShow\.id, \{ seenEpisodes:/);
  assert.match(seasonMutation, /nextEpisodeToWatch: optimisticNextEp/);
  assert.doesNotMatch(seasonMutation, /syncSingleItem\(/);
  assert.doesNotMatch(seasonMutation, /isSynced:\s*false/);
});

test('SEENIT-PERF-001 réserve la resynchronisation complète aux refresh fournisseur', () => {
  const manualSync = sliceBetween(detailCore, 'const handleSyncSingle = async', 'const [visibleSeasons, setVisibleSeasons]');
  assert.match(manualSync, /syncSingleItem\(show\.id\)/);

  assert.match(detailsWorker, /hasFutureReleaseOnly/);
  assert.match(detailsWorker, /hasAiredNotSynced/);
  assert.match(detailsWorker, /daysSinceLastSync >= 7/);
  assert.match(detailsWorker, /export async function syncSingleItem/);
  assert.match(detailsWorker, /for \(const season of seasons\)/);
});
