import { useEffect, useRef, useState } from 'react';
import { auth } from '../lib/firebase';
import { readUserScopedJson, writeUserScopedJson } from '../lib/userIsolation';
import { tmdb } from '../features/shows/tmdb';
import { buildActorIndex, type ActorIndex } from '../features/people/movieActors';
import type { Show } from '../types';

export function useMovieActors(shows: Show[]) {
  const uid = auth.currentUser?.uid;
  const [snapshot, setSnapshot] = useState(() => ({ uid, index: readUserScopedJson<ActorIndex>(uid, 'home_actor_index', {}) }));
  const source = useRef({ uid, metadata: new Map<string, unknown>() });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener('seenit-metadata-cached', refresh);
    return () => window.removeEventListener('seenit-metadata-cached', refresh);
  }, []);
  useEffect(() => {
    let current = true;
    if (source.current.uid !== uid) source.current = { uid, metadata: new Map() };
    const metadata = source.current.metadata;
    const scoped = shows.filter(show => show.userId === uid);
    const capture = (show: Show) => {
      const details = tmdb.peekRenderableMediaDetails(show.tmdbId, show.mediaType);
      if (details) metadata.set(`${show.mediaType}:${show.tmdbId}`, { credits: details.credits, aggregate_credits: details.aggregate_credits, runtime: details.runtime, episode_run_time: details.episode_run_time });
    };
    scoped.forEach(capture);
    const rebuild = () => {
      if (!current || auth.currentUser?.uid !== uid) return;
      const index = buildActorIndex(scoped, (id, type) => metadata.get(`${type}:${id}`));
      setSnapshot({ uid, index });
      writeUserScopedJson(uid, 'home_actor_index', index);
    };
    rebuild();
    // Disk cache only, four reads at a time; no TMDB request for an actor row.
    void (async () => {
      for (let offset = 0; current && offset < scoped.length; offset += 4) {
        await Promise.all(scoped.slice(offset, offset + 4).map(show => tmdb.primeMediaRenderSnapshotFromPersistentCache(show.tmdbId, show.mediaType).then(() => { if (current) capture(show); })));
      }
      rebuild();
    })().catch(() => { /* Le cache mémoire suffit en cas de disque indisponible. */ });
    return () => { current = false; };
  }, [shows, uid, revision]);
  return { index: snapshot.uid === uid ? snapshot.index : {}, metadata: source.current.uid === uid ? source.current.metadata : new Map<string, unknown>(), revision };
}
