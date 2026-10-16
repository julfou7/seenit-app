export interface HeroEpisodeRef {
  season: number;
  episode: number;
}

interface HeroEpisodePointer {
  season_number?: number;
  episode_number?: number;
  episode_count?: number | null;
  is_final_season?: boolean;
  series_ended?: boolean;
}

interface HeroSeasonEpisode {
  episode_number?: number;
}

interface HeroSeason {
  season_number?: number;
  episode_count?: number | null;
  episodes?: HeroSeasonEpisode[];
}

interface HeroProgressSource {
  status?: string;
  seenEpisodes?: string[];
  seasonsCache?: HeroSeason[];
  nextEpisodeToWatch?: HeroEpisodePointer | null;
  nextEpisodeToAir?: HeroEpisodePointer | null;
  totalAiredEpisodes?: number | null;
  seriesEnded?: boolean;
}

function toPositiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseSeenEpisode(key: string): HeroEpisodeRef | null {
  const match = /^(\d+)x(\d+)$/i.exec(key.trim());
  if (!match) return null;

  const season = toPositiveInteger(match[1]);
  const episode = toPositiveInteger(match[2]);
  return season && episode ? { season, episode } : null;
}

function pointerToEpisodeRef(pointer?: HeroEpisodePointer | null): HeroEpisodeRef | null {
  const season = toPositiveInteger(pointer?.season_number);
  const episode = toPositiveInteger(pointer?.episode_number);
  return season && episode ? { season, episode } : null;
}

function isAfter(candidate: HeroEpisodeRef, reference: HeroEpisodeRef): boolean {
  return candidate.season > reference.season
    || (candidate.season === reference.season && candidate.episode > reference.episode);
}

function resolveKnownSeasonEpisodeCount(
  show: HeroProgressSource,
  seasonNumber: number,
): number | null {
  const derived = show.nextEpisodeToWatch;
  if (toPositiveInteger(derived?.season_number) === seasonNumber) {
    const count = toPositiveInteger(derived?.episode_count);
    if (count) return count;
  }

  const nextToAir = show.nextEpisodeToAir;
  if (toPositiveInteger(nextToAir?.season_number) === seasonNumber) {
    const count = toPositiveInteger(nextToAir?.episode_count);
    if (count) return count;
  }

  const cachedSeason = show.seasonsCache?.find(
    season => toPositiveInteger(season.season_number) === seasonNumber,
  );
  const cachedCount = toPositiveInteger(cachedSeason?.episode_count)
    || (cachedSeason?.episodes?.length ? cachedSeason.episodes.length : null);
  return cachedCount || null;
}

/**
 * Resolves Explorer's resume episode without trusting stale derived metadata.
 *
 * `seenEpisodes` is durable progress. `nextEpisodeToWatch` can legitimately carry
 * richer metadata, so an unseen pointer is kept even before a later seen episode.
 * When the pointer names a seen episode, the Hero advances only across seen
 * episodes, preserving gaps in independently imported or marked progress.
 * `seasonsCache` is only a legacy last-resort source for season length.
 */
export function resolveHeroNextEpisode(show: HeroProgressSource): HeroEpisodeRef | null {
  const seenEpisodes = (show.seenEpisodes || [])
    .map(parseSeenEpisode)
    .filter((episode): episode is HeroEpisodeRef => Boolean(episode));
  const derived = pointerToEpisodeRef(show.nextEpisodeToWatch);
  const seenKeys = new Set(seenEpisodes.map(ref => `${ref.season}x${ref.episode}`));

  if (seenEpisodes.length === 0) {
    return derived;
  }

  const latestSeen = seenEpisodes.reduce((latest, episode) => (
    isAfter(episode, latest) ? episode : latest
  ));

  if (derived && !seenKeys.has(`${derived.season}x${derived.episode}`)) {
    return derived;
  }

  const totalAiredEpisodes = toPositiveInteger(show.totalAiredEpisodes);
  if (totalAiredEpisodes && seenKeys.size >= totalAiredEpisodes) {
    return null;
  }

  let candidate = derived || latestSeen;
  for (let step = 0; step <= seenKeys.size; step += 1) {
    if (!seenKeys.has(`${candidate.season}x${candidate.episode}`)) return candidate;
    const seasonEpisodeCount = resolveKnownSeasonEpisodeCount(show, candidate.season);
    if (seasonEpisodeCount && candidate.episode >= seasonEpisodeCount) {
      const pointer = show.nextEpisodeToWatch;
      const isKnownSeriesFinale = pointer?.is_final_season === true
        && pointer.season_number === candidate.season
        && (pointer.series_ended === true || show.seriesEnded === true);
      if (isKnownSeriesFinale) return null;
      candidate = { season: candidate.season + 1, episode: 1 };
    } else {
      candidate = { season: candidate.season, episode: candidate.episode + 1 };
    }
  }
  return candidate;
}

export function resolveHeroResumeState(show: HeroProgressSource) {
  const nextEpisode = resolveHeroNextEpisode(show);
  return {
    nextEpisode,
    isCompleted: !nextEpisode && (show.status === 'completed' || Boolean(show.seenEpisodes?.length)),
  };
}

export function formatHeroEpisode(ref: HeroEpisodeRef): string {
  return `S${String(ref.season).padStart(2, '0')}E${String(ref.episode).padStart(2, '0')}`;
}

export interface HeroOverviewPreview {
  text: string;
  truncated: boolean;
}

/** Keeps the mobile synopsis compact without cutting the final word in half. */
export function buildHeroOverviewPreview(overview: string, maxCharacters = 100): HeroOverviewPreview {
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
