/**
 * #255 : couverture Plex d'une série, sans requête par épisode.
 *
 * - `none`      : aucune disponibilité connue (rien à afficher) ;
 * - `unknown`   : la série est sur Plex mais le nombre d'épisodes présents n'est pas connu ;
 * - `partial`   : moins d'épisodes présents que d'épisodes déjà diffusés (TMDB, hors spéciaux) ;
 * - `available` : au moins autant d'épisodes que diffusés. Jamais présenté comme « complet » :
 *   Plex compte aussi les spéciaux, le décompte seul ne prouve pas que chaque épisode est là.
 */
export type PlexSeriesCoverageState = 'none' | 'unknown' | 'partial' | 'available';

export interface PlexSeriesCoverage {
  state: PlexSeriesCoverageState;
  label: string | null;
}

interface TmdbSeasonLike { season_number?: number | null; episode_count?: number | null }
interface TmdbShowLike {
  seasons?: readonly TmdbSeasonLike[] | null;
  last_episode_to_air?: { season_number?: number | null; episode_number?: number | null } | null;
}

/** Épisodes déjà diffusés (hors saison 0), ou `null` si TMDB ne permet pas de le savoir. */
export function countAiredEpisodes(show: TmdbShowLike | null | undefined): number | null {
  const last = show?.last_episode_to_air;
  const lastSeason = Number(last?.season_number);
  const lastEpisode = Number(last?.episode_number);
  if (!Number.isInteger(lastSeason) || lastSeason < 1 || !Number.isInteger(lastEpisode) || lastEpisode < 1) return null;
  const seasons = Array.isArray(show?.seasons) ? show.seasons : [];
  let total = 0;
  for (let season = 1; season < lastSeason; season += 1) {
    const count = Number(seasons.find(item => Number(item?.season_number) === season)?.episode_count);
    if (!Number.isInteger(count) || count < 0) return null;
    total += count;
  }
  return total + lastEpisode;
}

const episodesLabel = (count: number) => `${count} épisode${count > 1 ? 's' : ''}`;

export function describePlexSeriesCoverage(
  info: { available?: boolean; episodeCount?: number } | null | undefined,
  airedEpisodes: number | null,
): PlexSeriesCoverage {
  if (!info?.available) return { state: 'none', label: null };
  const count = info.episodeCount;
  if (!Number.isInteger(count) || (count as number) < 0) return { state: 'unknown', label: null };
  const present = count as number;
  if (airedEpisodes !== null && airedEpisodes > 0 && present < airedEpisodes) {
    return { state: 'partial', label: `${present} épisode${present > 1 ? 's' : ''} sur ${airedEpisodes}` };
  }
  return { state: 'available', label: episodesLabel(present) };
}

/** #255 : n'accepte qu'une couverture bien formée ; toute anomalie laisse la couverture inconnue. */
export function readPlexEpisodeCoverage(data: unknown): { episodeCount?: number; episodes?: string[] } {
  const source = data as { episodeCount?: unknown; episodes?: unknown } | null;
  const count = source?.episodeCount;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) return {};
  const episodes = Array.isArray(source?.episodes) && source.episodes.length === count
    && source.episodes.every(value => typeof value === 'string' && /^\d{1,3}:\d{1,4}$/.test(value))
    ? source.episodes as string[]
    : undefined;
  return episodes ? { episodeCount: count, episodes } : { episodeCount: count };
}

/**
 * #255 : couverture d'un épisode précis. `true`/`false` seulement avec la liste exacte du serveur ;
 * `null` quand elle est inconnue (aucune conclusion autorisée).
 */
export function isPlexEpisodePresent(info: { available?: boolean; episodes?: string[] } | null | undefined, season: number, episode: number): boolean | null {
  if (!info?.available || !Array.isArray(info.episodes)) return null;
  return info.episodes.includes(`${season}:${episode}`);
}
