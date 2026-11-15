import type { ProgrammedItem } from './programmedCalendar.ts';
import type { LiveDownloadItem } from '../../services/sonarrRadarrLive.ts';

/** Même périmètre exact (TMDB, saison et épisode), jamais le titre. */
export const coveredBy = (item: ProgrammedItem, request: LiveDownloadItem) => Number(request.tmdbId) > 0 && Number(item.tmdbId) === Number(request.tmdbId)
  && (item.kind === 'movie' ? request.mediaType === 'movie'
    : request.mediaType === 'tv' && Number(request.seasonNumber) === item.season && Number(request.episodeNumber) === item.episode);

/**
 * Retour terrain du 15/11 (Angel and the Badman) : Radarr garde un film « manquant » tant qu'il n'est pas importé ;
 * au lancement du téléchargement, il restait aussi listé dans « Programmés ». Un élément déjà dans la file (même
 * périmètre exact TMDB, saison et épisode, jamais le titre) n'est plus répété ici.
 */
/**
 * Retour terrain du 15/11 (« La Guerre des mondes » ajouté en plein milieu) : « Programmés » est trié par date
 * d'ajout, le plus récent en premier ; sans date connue, la carte garde sa place relative en fin de liste.
 */
export function orderByRecentlyAdded<T extends { addedAt?: number }>(cards: readonly T[]): T[] {
  return cards.map((card, index) => ({ card, index }))
    .sort((a, b) => (b.card.addedAt ?? -Infinity) - (a.card.addedAt ?? -Infinity) || a.index - b.index)
    .map(entry => entry.card);
}

export function hideQueuedProgrammed<T extends ProgrammedItem>(items: readonly T[], queued: readonly LiveDownloadItem[]): T[] {
  return items.filter(item => !queued.some(entry => coveredBy(item, entry)));
}
