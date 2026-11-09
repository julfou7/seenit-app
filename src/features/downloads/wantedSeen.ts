import type { Show } from '../../types';
import type { ProgrammedItem } from './programmedCalendar';

/**
 * Retour terrain du 09/11 sur la v1.4.286 (`USR-2026-11-09-016`) : un épisode (ou un film) que Sonarr/Radarr
 * cherche encore mais que le propriétaire a déjà vu dans SeenIt n'a plus sa place dans « Programmés ». Il est
 * masqué seulement 24 h après avoir été marqué vu, pour laisser le temps de corriger un test vu/non vu ou une
 * fausse manipulation. Rien n'est écrit dans Sonarr/Radarr : l'affichage seul change.
 */
export const SEEN_GRACE_MS = 24 * 3_600_000;

type SeenRecords = Pick<Show, 'seenEpisodes' | 'episodeRecords'>;

/** Vu dans SeenIt depuis au moins 24 h ; un vu sans date connue (import ancien) compte comme ancien. */
export function seenLongEnough(show: SeenRecords | undefined, key: string, now = Date.now()): boolean {
  if (!show?.seenEpisodes?.includes(key)) return false;
  const watchedAt = Number(show.episodeRecords?.[key]?.watchedAt);
  return !(watchedAt > 0) || now - watchedAt >= SEEN_GRACE_MS;
}

/** Clé de vu SeenIt d'un élément programmé : `2x4` pour un épisode, `movie` pour un film. */
export const seenKey = (item: ProgrammedItem) => item.kind === 'movie' ? 'movie' : `${item.season}x${item.episode}`;

/**
 * Masque les recherchés déjà vus depuis 24 h, rattachés par identité TMDB exacte (jamais par le titre). Les
 * sorties à venir ne sont jamais masquées : un épisode pas encore sorti ne peut pas avoir été vu.
 */
export function hideSeenWanted(items: readonly ProgrammedItem[], shows: readonly Show[], now = Date.now()): ProgrammedItem[] {
  const tracked = new Map<string, Show>();
  for (const show of shows) if (Number(show.tmdbId) > 0) tracked.set(`${show.mediaType}:${Number(show.tmdbId)}`, show);
  return items.filter(item => {
    if (!item.wanted || !(Number(item.tmdbId) > 0)) return true;
    const show = tracked.get(`${item.kind === 'movie' ? 'movie' : 'tv'}:${Number(item.tmdbId)}`);
    return !seenLongEnough(show, seenKey(item), now);
  });
}
