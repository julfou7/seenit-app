import { useMemo } from 'react';
import { MovieActorProfile } from './MovieActorProfile';
import { useShowsStore } from '../store/showsStore';
import { useFavoritePeopleStore } from '../store/favoritePeopleStore';
import { auth } from '../lib/firebase';
import { readUserScopedJson } from '../lib/userIsolation';
import type { ActorIndex, TicketActor } from '../features/people/movieActors';
import type { Show } from '../types';

/**
 * SEENIT-UX-019 — Une seule fiche acteur dans toute l'app : fiches série/film, Explorer, Moi et À voir
 * ouvrent la fiche du prototype (celle des billets films). Mêmes props que l'ancienne fiche personne,
 * et l'appelant garde la main sur l'historique (`external`), comme avant.
 */
export interface PersonProfileProps {
  personId: number;
  onClose: () => void;
  onShowClick?: (tmdbId: number, mediaType?: 'tv' | 'movie') => void;
  /** Ce que l'appelant connaît déjà (casting d'une fiche) pour un premier rendu immédiat. */
  hint?: { name?: string; profile_path?: string | null; character?: string };
  origin?: Show | null;
}

export function PersonProfile({ personId, onClose, onShowClick, hint, origin }: PersonProfileProps) {
  const shows = useShowsStore(state => state.shows);
  const favorite = useFavoritePeopleStore(state => state.people.some(person => person.id === personId));
  const uid = auth.currentUser?.uid;
  const entry = useMemo(() => readUserScopedJson<ActorIndex>(uid, 'home_actor_index', {})[personId], [uid, personId]);
  const actor: TicketActor = { id: personId, name: hint?.name || entry?.name || '', profile_path: hint?.profile_path ?? entry?.profile_path ?? null, character: hint?.character, favorite, seen: entry?.seen || [] };
  return <MovieActorProfile actor={actor} origin={origin} shows={shows} historyMode="external" onClose={onClose} onOpen={(id, type) => onShowClick?.(id, type)} />;
}
