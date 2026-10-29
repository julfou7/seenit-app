import { useEffect, useRef, useState } from 'react';
import type { Show } from '../types';
import type { CharacterRecord } from '../features/discover/characters';
import { buildCharacterSearchBatchesFromKeys, orderedCharacterSearchKeys, runCharacterSearchBatches, sortCharacterSearchResults } from '../features/discover/characterSearch';
import { authenticatedFetch } from '../lib/apiAuth';
import { auth } from '../lib/firebase';

export function useCharacterSearch(shows: readonly Show[], query: string, enabled = true) {
 const uid = auth.currentUser?.uid || '';
 const ids = orderedCharacterSearchKeys(shows).join(',');
 const scope = uid + ':' + ids + ':' + query.trim();
 const [state, setState] = useState<{ scope: string; results: CharacterRecord[]; loading: boolean }>({ scope: '', results: [], loading: false });
 const previous = useRef(state); previous.current = state;
 useEffect(() => {
  if (!enabled || !uid || query.trim().length < 2 || !ids) return;
  const controller = new AbortController();
  const orderedKeys = ids.split(',');
  const batches = buildCharacterSearchBatchesFromKeys(orderedKeys);
  const results = new Map<string, CharacterRecord>(previous.current.scope === scope ? previous.current.results.map(character => [character.id, character]) : []);
  let firstBatchSettled = false;
  const publish = (loading: boolean) => {
   if (controller.signal.aborted) return;
   setState({ scope, results: sortCharacterSearchResults([...results.values()], orderedKeys, query).slice(0, 40), loading });
  };
  setState({ scope, results: [...results.values()], loading: true });
  void runCharacterSearchBatches(
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
    for (const character of batchResults) results.set(character.id, character);
    if (index === 0) firstBatchSettled = true;
    if (firstBatchSettled) publish(true);
   },
   controller.signal,
  ).finally(() => publish(false));
  return () => controller.abort();
 }, [uid, ids, query, scope, enabled]);
 return state.scope === scope && query.trim().length >= 2 ? state : { scope, results: [], loading: false };
}
