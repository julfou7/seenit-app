import { useEffect, useRef, useState } from 'react';
import { auth } from '../lib/firebase';
import { readUserScopedJson, writeUserScopedJson } from '../lib/userIsolation';
import { tmdb } from '../features/shows/tmdb';
import { buildActorIndex, type ActorIndex } from '../features/people/movieActors';
import type { Show } from '../types';

function idle(task: () => void) {
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(task, { timeout: 800 });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = setTimeout(task, 24);
  return () => clearTimeout(handle);
}

export function useMovieActors(shows: Show[], active = true) {
  const uid = auth.currentUser?.uid;
  const [snapshot, setSnapshot] = useState<{ uid: string | undefined; index: ActorIndex }>({ uid, index: {} });
  const source = useRef({ uid, metadata: new Map<string, unknown>(), primed: new Set<string>() });
  const latest = useRef(shows); latest.current = shows;
  const [revision, setRevision] = useState(0);
  const identities = shows.filter(show => show.userId === uid).map(show => `${show.mediaType}:${show.tmdbId}`).join('|');
  const capture = (show: Show) => {
    const details = tmdb.peekRenderableMediaDetails(show.tmdbId, show.mediaType);
    if (details) source.current.metadata.set(`${show.mediaType}:${show.tmdbId}`, { credits: details.credits, aggregate_credits: details.aggregate_credits, runtime: details.runtime, episode_run_time: details.episode_run_time });
  };
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => { clearTimeout(timer); timer = setTimeout(() => setRevision(value => value + 1), 120); };
    window.addEventListener('seenit-metadata-cached', refresh);
    return () => { clearTimeout(timer); window.removeEventListener('seenit-metadata-cached', refresh); };
  }, [active, uid]);
  useEffect(() => {
    if (!active) return;
    return idle(() => { if (auth.currentUser?.uid === uid) setSnapshot({ uid, index: readUserScopedJson<ActorIndex>(uid, 'home_actor_index', {}) }); });
  }, [uid, active]);
  useEffect(() => {
    if (!active) return;
    let current = true;
    if (source.current.uid !== uid) source.current = { uid, metadata: new Map(), primed: new Set() };
    const scoped = latest.current.filter(show => show.userId === uid);
    const cancel = idle(() => { void (async () => {
      // A Plex update or metadata event must not restart every disk read.
      const pending = [...new Map(scoped.filter(show => !source.current.primed.has(`${show.mediaType}:${show.tmdbId}`)).map(show => [`${show.mediaType}:${show.tmdbId}`, show])).values()];
      for (let offset = 0; current && auth.currentUser?.uid === uid && offset < pending.length; offset += 4) {
        await Promise.all(pending.slice(offset, offset + 4).map(async show => {
          await tmdb.primeMediaRenderSnapshotFromPersistentCache(show.tmdbId, show.mediaType);
          if (current && auth.currentUser?.uid === uid) { capture(show); source.current.primed.add(`${show.mediaType}:${show.tmdbId}`); }
        }));
        await new Promise(resolve => setTimeout(resolve, 16));
      }
      if (current && auth.currentUser?.uid === uid) setRevision(value => value + 1);
    })().catch(() => { /* Le cache mémoire reste utilisable si le disque est indisponible. */ }); });
    return () => { current = false; cancel(); };
  }, [identities, uid, active]);
  useEffect(() => {
    if (!active) return;
    let current = true;
    let cancelIdle = () => {};
    // Coalesce Plex updates and yield between batches instead of blocking startup.
    const timer = setTimeout(() => {
      const scoped = latest.current.filter(show => show.userId === uid);
      const index: ActorIndex = {};
      const seenTitles = new Map<number, Set<string>>();
      let offset = 0;
      const step = () => {
        if (!current || auth.currentUser?.uid !== uid) return;
        const batch = scoped.slice(offset, offset + 20); offset += 20;
        batch.forEach(capture);
        const partial = buildActorIndex(batch, (id, type) => source.current.metadata.get(`${type}:${id}`));
        for (const [id, actor] of Object.entries(partial)) {
          const actorId = Number(id), existing = index[actorId];
          if (!existing) { index[actorId] = actor; seenTitles.set(actorId, new Set(actor.seen.map(title => `${title.mediaType}:${title.tmdbId}`))); }
          else for (const title of actor.seen) { const key = `${title.mediaType}:${title.tmdbId}`; if (!seenTitles.get(actorId)!.has(key)) { seenTitles.get(actorId)!.add(key); existing.seen.push(title); } }
        }
        if (offset < scoped.length) cancelIdle = idle(step);
        else { setSnapshot({ uid, index }); writeUserScopedJson(uid, 'home_actor_index', index); }
      };
      cancelIdle = idle(step);
    }, 180);
    return () => { current = false; clearTimeout(timer); cancelIdle(); };
  }, [shows, uid, revision, active]);
  return { index: snapshot.uid === uid ? snapshot.index : {}, metadata: source.current.uid === uid ? source.current.metadata : new Map<string, unknown>(), revision };
}
