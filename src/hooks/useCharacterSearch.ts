import { useEffect, useRef, useState } from 'react';
import type { Show } from '../types';
import type { CharacterRecord } from '../features/discover/characters';
import { authenticatedFetch } from '../lib/apiAuth';
import { auth } from '../lib/firebase';

export function useCharacterSearch(shows: readonly Show[], query: string, enabled = true) {
 const uid = auth.currentUser?.uid || '';
 const ids = [...new Set(shows.filter(show => Number.isInteger(Number(show.tmdbId)) && Number(show.tmdbId) > 0).map(show => `${show.mediaType}:${show.tmdbId}`))].sort().join(',');
 const scope = uid + ':' + ids + ':' + query.trim();
 const [state, setState] = useState<{ scope: string; results: CharacterRecord[]; loading: boolean }>({ scope: '', results: [], loading: false });
 const previous = useRef(state); previous.current = state;
 useEffect(() => {
  if (!enabled || !uid || query.trim().length < 2 || !ids) return;
  const controller = new AbortController();
  const timer = setTimeout(async () => {
   const results = new Map<string, CharacterRecord>(previous.current.scope === scope ? previous.current.results.map(character => [character.id, character]) : []);
   setState({ scope, results: [...results.values()], loading: true });
   const all = ids.split(',');
   try {
    for (let offset = 0; offset < all.length && !controller.signal.aborted; offset += 16) {
     const url = '/api/media/characters?ids=' + encodeURIComponent(all.slice(offset,offset+16).join(',')) + '&q=' + encodeURIComponent(query.trim());
     const response = await authenticatedFetch(url, { signal: controller.signal });
     if (!response.ok) break;
     const data: { results?: CharacterRecord[] } = await response.json();
     for (const character of data.results || []) results.set(character.id, character);
     if (!controller.signal.aborted) setState({ scope, results: [...results.values()].slice(0,40), loading: true });
     if (results.size >= 40) break;
    }
   } catch { /* TMDB and local-library search stay available when this optional source fails. */ }
   finally { if (!controller.signal.aborted) setState({ scope, results: [...results.values()].slice(0,40), loading: false }); }
  }, 450);
  return () => { clearTimeout(timer); controller.abort(); };
 }, [uid, ids, query, scope, enabled]);
 return state.scope === scope && query.trim().length >= 2 ? state : { scope, results: [], loading: false };
}
