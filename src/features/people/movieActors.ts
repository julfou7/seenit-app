import { historyEpisodeKey } from '../history/historyRecords.ts';
import type { Show } from '../../types';

export interface MovieActor {
  id: number;
  name: string;
  profile_path?: string | null;
  character?: string;
  order?: number;
  roles?: Array<{ character?: string; episode_count?: number }>;
}
export interface ActorTitle {
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  title: string;
  posterPath: string | null;
  backdropPath: string | null;
  character: string;
  episodes: number;
  minutes: number | null;
}
export type ActorIndex = Record<number, { name: string; profile_path?: string | null; seen: ActorTitle[] }>;
export interface TicketActor extends MovieActor { favorite: boolean; seen: ActorTitle[] }
type Metadata = { credits?: { cast?: MovieActor[] }; aggregate_credits?: { cast?: MovieActor[] }; runtime?: number; episode_run_time?: number[] };

export function cachedCast(details: unknown): MovieActor[] {
  const data = details as Metadata | null;
  const cast = data?.aggregate_credits?.cast || data?.credits?.cast;
  return Array.isArray(cast) ? cast.filter(actor => Number.isInteger(actor.id) && actor.id > 0 && typeof actor.name === 'string') : [];
}
export function buildActorIndex(shows: Show[], metadata: (id: number, type: 'tv' | 'movie') => unknown): ActorIndex {
  const index: ActorIndex = {};
  const identities = new Set<string>();
  for (const show of shows) {
    const identity = `${show.mediaType}:${show.tmdbId}`;
    const episodes = new Set((show.seenEpisodes || []).map(historyEpisodeKey).filter(Boolean)).size;
    if (identities.has(identity) || !(show.mediaType === 'movie' ? show.seenEpisodes?.includes('movie') : episodes > 0)) continue;
    identities.add(identity);
    const details = metadata(show.tmdbId, show.mediaType) as Metadata | null;
    const runtime = show.mediaType === 'movie' ? details?.runtime : details?.episode_run_time?.[0];
    for (const actor of cachedCast(details)) {
      const entry = index[actor.id] ||= { name: actor.name, profile_path: actor.profile_path, seen: [] };
      if (entry.seen.some(title => title.tmdbId === show.tmdbId && title.mediaType === show.mediaType)) continue;
      entry.seen.push({ mediaType: show.mediaType, tmdbId: show.tmdbId, title: show.title, posterPath: show.posterPath, backdropPath: show.backdropPath,
        character: actor.character || actor.roles?.[0]?.character || '', episodes: show.mediaType === 'tv' ? episodes : 0,
        minutes: Number.isFinite(runtime) && Number(runtime) > 0 ? Number(runtime) * (show.mediaType === 'tv' ? episodes : 1) : null });
    }
  }
  return index;
}
export function selectTicketActor(details: unknown, favorites: readonly { id: number }[], index: ActorIndex): TicketActor | null {
  const cast = cachedCast(details).map((actor, position) => ({ ...actor, order: actor.order ?? position })).sort((a, b) => a.order - b.order).slice(0, 10);
  if (!cast.length) return null;
  const favoriteIds = new Set(favorites.map(actor => actor.id));
  const actor = cast.find(person => favoriteIds.has(person.id)) || [...cast].sort((a, b) => (index[b.id]?.seen.length || 0) - (index[a.id]?.seen.length || 0) || a.order - b.order)[0];
  return { ...actor, favorite: favoriteIds.has(actor.id), seen: index[actor.id]?.seen || [] };
}
export function actorShortName(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(' ')}` : name;
}
export function actorReason(actor: TicketActor, list: boolean) {
  const count = actor.seen.length;
  if (actor.favorite) return `❤ favori${list && count ? ` · ${count} titre${count > 1 ? 's' : ''} vu${count > 1 ? 's' : ''}` : ''}`;
  if (count === 1) return `${list ? 'vu dans' : '✓'} ${actor.seen[0].title}`;
  return count > 1 ? (list ? `vu dans ${count} de tes titres` : `✓ ${count} titres vus`) : '';
}
