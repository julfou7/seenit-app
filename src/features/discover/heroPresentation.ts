export interface HeroEpisodeRef {
  season: number;
  episode: number;
}

interface HeroSeasonEpisode {
  season_number?: number;
  episode_number?: number;
}

interface HeroSeason {
  season_number?: number;
  episodes?: HeroSeasonEpisode[];
}

interface HeroProgressSource {
  seenEpisodes?: string[];
  seasonsCache?: HeroSeason[];
  nextEpisodeToWatch?: {
    season_number?: number;
    episode_number?: number;
  } | null;
}

const episodeKey = (season: number, episode: number) => `${season}x${episode}`;

/**
 * Resolves the next episode shown in Explorer's Hero from durable progress first.
 *
 * `nextEpisodeToWatch` is derived metadata and may lag behind `seenEpisodes` after
 * a progress update. When a seasons cache is available, recomputing from the
 * persisted seen episode keys prevents the Hero from regressing to an already
 * watched episode. The derived value remains a fallback when the cache is absent
 * or incomplete.
 */
export function resolveHeroNextEpisode(show: HeroProgressSource): HeroEpisodeRef | null {
  const seen = new Set(show.seenEpisodes || []);
  const seasons = Array.isArray(show.seasonsCache) ? show.seasonsCache : [];

  if (seasons.length > 0) {
    const orderedSeasons = [...seasons]
      .filter((season) => Number(season.season_number) > 0)
      .sort((a, b) => Number(a.season_number) - Number(b.season_number));

    for (const season of orderedSeasons) {
      const seasonNumber = Number(season.season_number);
      const orderedEpisodes = [...(season.episodes || [])]
        .filter((episode) => Number(episode.episode_number) > 0)
        .sort((a, b) => Number(a.episode_number) - Number(b.episode_number));

      for (const episode of orderedEpisodes) {
        const episodeNumber = Number(episode.episode_number);
        if (!seen.has(episodeKey(seasonNumber, episodeNumber))) {
          return { season: seasonNumber, episode: episodeNumber };
        }
      }
    }
  }

  const derivedSeason = Number(show.nextEpisodeToWatch?.season_number);
  const derivedEpisode = Number(show.nextEpisodeToWatch?.episode_number);
  if (
    Number.isFinite(derivedSeason)
    && derivedSeason > 0
    && Number.isFinite(derivedEpisode)
    && derivedEpisode > 0
    && !seen.has(episodeKey(derivedSeason, derivedEpisode))
  ) {
    return { season: derivedSeason, episode: derivedEpisode };
  }

  return null;
}

export function formatHeroEpisode(ref: HeroEpisodeRef): string {
  return `S${String(ref.season).padStart(2, '0')}E${String(ref.episode).padStart(2, '0')}`;
}

export interface HeroOverviewPreview {
  text: string;
  truncated: boolean;
}

/**
 * Keeps the mobile synopsis compact without cutting the final word in half.
 */
export function buildHeroOverviewPreview(overview: string, maxCharacters = 128): HeroOverviewPreview {
  const normalized = overview.trim().replace(/\s+/g, ' ');
  if (normalized.length <= maxCharacters) {
    return { text: normalized, truncated: false };
  }

  const candidate = normalized.slice(0, maxCharacters + 1);
  const lastWhitespace = candidate.lastIndexOf(' ');
  const minimumUsefulCut = Math.floor(maxCharacters * 0.7);
  const cutAt = lastWhitespace >= minimumUsefulCut ? lastWhitespace : maxCharacters;
  const text = normalized
    .slice(0, cutAt)
    .trim()
    .replace(/[\s,;:–—-]+$/u, '');

  return { text, truncated: true };
}
