import { useEffect, useRef, useState } from 'react';
import type { Show } from '../types';
import type { CharacterRecord } from '../features/discover/characters';
import type { ActorIndex } from '../features/people/movieActors';
import {
 buildCachedTrackedCharacterResults,
 buildCharacterSearchBatchesFromKeys,
 CHARACTER_SEARCH_CACHE_CONCURRENCY,
 mergeCharacterSearchRecords,
 orderedCharacterSearchKeys,
 preferredCharacterSearchKeysFromActorIndex,
 runCharacterSearchBatches,
 sortCharacterSearchResults,
} from '../features/discover/characterSearch';
import { tmdb } from '../features/shows/tmdb';
import { authenticatedFetch } from '../lib/apiAuth';
import { auth } from '../lib/firebase';
import { readUserScopedJson } from '../lib/userIsolation';

export function useCharacterSearch(shows: readonly Show[], query: string, enabled = true) {
 const uid = auth.currentUser?.uid || '';
 const ids = orderedCharacterSearchKeys(shows).join(',');
 const scope = uid + ':' + ids + ':' + query.trim();
 const [state, setState] = useState<{ scope: string; results: CharacterRecord[]; loading: boolean }>({ scope: '', results: [], loading: false });
 const previous = useRef(state); previous.current = state;
 useEffect(() => {
  if (!enabled || !uid || query.trim().length < 2 || !ids) return;
  const controller = new AbortController();
  const scopedShows = shows.filter(show => !show.userId || show.userId === uid);
  const availableKeys = new Set(orderedCharacterSearchKeys(scopedShows));
  const actorIndex = readUserScopedJson<ActorIndex>(uid, 'home_actor_index', {});
  const preferredKeys = preferredCharacterSearchKeysFromActorIndex(actorIndex, query).filter(key => availableKeys.has(key));
  const orderedKeys = orderedCharacterSearchKeys(scopedShows, preferredKeys);
  const preferredCount = orderedKeys.findIndex(key => !preferredKeys.includes(key));
  const batches = buildCharacterSearchBatchesFromKeys(orderedKeys, preferredCount < 0 ? preferredKeys.length : preferredCount);
  const results = new Map<string, CharacterRecord>(previous.current.scope === scope ? previous.current.results.map(character => [character.id, character]) : []);
  const cachedMetadata = new Map<string, unknown>();
  let firstBatchSettled = false;
  const upsert = (character: CharacterRecord) => {
   const existing = results.get(character.id);
   results.set(character.id, existing ? mergeCharacterSearchRecords(existing, character) : character);
  };
  const publish = (loading: boolean) => {
   if (controller.signal.aborted) return;
   setState({ scope, results: sortCharacterSearchResults([...results.values()], orderedKeys, query).slice(0, 40), loading });
  };
  const addCachedShow = (show: Show) => {
   if (typeof tmdb.peekRenderableMediaDetails !== 'function') return false;
   const key = `${show.mediaType}:${Number(show.tmdbId)}`;
   const details = tmdb.peekRenderableMediaDetails(show.tmdbId, show.mediaType);
   if (!details) return false;
   cachedMetadata.set(key, details);
   const cachedCharacters = buildCachedTrackedCharacterResults([show], cachedMetadata, query);
   for (const character of cachedCharacters) upsert(character);
   return cachedCharacters.length > 0;
  };
  for (const show of scopedShows) addCachedShow(show);
  setState({ scope, results: sortCharacterSearchResults([...results.values()], orderedKeys, query).slice(0, 40), loading: true });

  const cachePrime = (async () => {
   if (typeof tmdb.primeMediaRenderSnapshotFromPersistentCache !== 'function') return;
   const byKey = new Map(scopedShows.map(show => [`${show.mediaType}:${Number(show.tmdbId)}`, show]));
   const orderedShows = orderedKeys.flatMap(key => byKey.get(key) ? [byKey.get(key)!] : []);
   let cursor = 0;
   const workerCount = Math.min(CHARACTER_SEARCH_CACHE_CONCURRENCY, orderedShows.length);
   await Promise.all(Array.from({ length: workerCount }, async () => {
    while (!controller.signal.aborted) {
     const show = orderedShows[cursor++];
     if (!show) return;
     await tmdb.primeMediaRenderSnapshotFromPersistentCache(show.tmdbId, show.mediaType);
     if (controller.signal.aborted) return;
     if (addCachedShow(show)) publish(true);
    }
   }));
  })();

  const networkSearch = runCharacterSearchBatches(
   batches,
   async batch => {
    try {
     const url = '/api/media/characters?ids=' + encodeURIComponent(batch.join(',')) + '&q=' + encodeURIComponent(query.trim());
     const response = await authenticatedFetch(url, { signal: controller.signal });
     if (!response.ok) return [] as CharacterRecord[];
     const data: { results?: CharacterRecord[] } = await response.json();
     return data.results || [];
    } catch {
     return [] as CharacterRecord[];
    }
   },
   (batchResults, index) => {
    for (const character of batchResults) upsert(character);
    if (index === 0) firstBatchSettled = true;
    if (firstBatchSettled) publish(true);
   },
   controller.signal,
  );
  void Promise.allSettled([networkSearch, cachePrime]).finally(() => publish(false));
  return () => controller.abort();
 }, [uid, ids, query, scope, enabled]);
 return state.scope === scope && query.trim().length >= 2 ? state : { scope, results: [], loading: false };
}
