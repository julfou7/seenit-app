import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { Show } from '../types';
import type { CharacterRecord } from '../features/discover/characters';
import type { ActorIndex } from '../features/people/movieActors';
import {
 buildCachedTrackedCharacterResults,
 mergeCharacterSearchRecords,
 orderedCharacterSearchKeys,
 preferredCharacterSearchKeysFromActorIndex,
 sortCharacterSearchResults,
} from '../features/discover/characterSearch';
import { matchIndexedCharacters } from '../features/discover/characterIndex';
import { characterIndex } from '../features/discover/characterIndexRuntime';
import { tmdb } from '../features/shows/tmdb';
import { auth } from '../lib/firebase';
import { readUserScopedJson } from '../lib/userIsolation';

const mediaKey = (show: Show) => `${show.mediaType}:${Number(show.tmdbId)}`;

/**
 * Personnages de la bibliothèque et de ses univers. L'index des distributions est construit une fois,
 * dès l'ouverture de la recherche (`warm`), puis chaque frappe filtre localement sans relancer le réseau.
 */
export function useCharacterSearch(shows: readonly Show[], query: string, enabled = true, warm = false) {
 const uid = auth.currentUser?.uid || '';
 const trimmed = query.trim();
 const scopedShows = useMemo(() => shows.filter(show => !show.userId || show.userId === uid), [shows, uid]);
 const libraryKeys = useMemo(() => orderedCharacterSearchKeys(scopedShows), [scopedShows]);
 const signature = libraryKeys.join(',');
 const searching = enabled && Boolean(uid) && trimmed.length >= 2;
 const active = enabled && Boolean(uid) && libraryKeys.length > 0 && (warm || searching);
 const index = useSyncExternalStore(characterIndex.subscribe, characterIndex.getSnapshot, characterIndex.getSnapshot);
 const actorIndex = useMemo(() => active ? readUserScopedJson<ActorIndex>(uid, 'home_actor_index', {}) : {}, [active, uid, signature]);

 useEffect(() => {
  if (active) void characterIndex.ensure(libraryKeys);
 }, [active, uid, signature]);

 useEffect(() => {
  if (!searching) return;
  // Un rôle déjà connu sur l'appareil fait passer son titre en tête de l'indexation.
  const available = new Set(libraryKeys);
  const preferred = preferredCharacterSearchKeysFromActorIndex(actorIndex, trimmed).filter(key => available.has(key));
  if (preferred.length) void characterIndex.prioritize(preferred);
 }, [searching, trimmed, actorIndex, signature]);

 const results = useMemo(() => {
  if (!searching) return [] as CharacterRecord[];
  const merged = new Map<string, CharacterRecord>();
  for (const character of matchIndexedCharacters(characterIndex.characters(libraryKeys), trimmed)) merged.set(character.id, character);
  // Tant qu'un titre n'est pas indexé, son casting déjà en mémoire répond sans attendre.
  if (typeof tmdb.peekRenderableMediaDetails === 'function') {
   const pending = scopedShows.filter(show => !characterIndex.has(mediaKey(show)));
   const metadata = new Map<string, unknown>();
   for (const show of pending) {
    const details = tmdb.peekRenderableMediaDetails(show.tmdbId, show.mediaType);
    if (details) metadata.set(mediaKey(show), details);
   }
   for (const character of buildCachedTrackedCharacterResults(pending, metadata, trimmed)) {
    const existing = merged.get(character.id);
    merged.set(character.id, existing ? mergeCharacterSearchRecords(existing, character) : character);
   }
  }
  return sortCharacterSearchResults([...merged.values()], libraryKeys, trimmed).slice(0, 40);
 }, [searching, index.revision, signature, trimmed, scopedShows]);

 return { results, loading: searching && index.indexing, partial: searching && index.partial };
}
