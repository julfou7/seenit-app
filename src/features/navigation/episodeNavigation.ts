export type EpisodeNavigationDirection = 'previous' | 'next';

interface EpisodeNavigationKeyInput {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
  defaultPrevented?: boolean;
  target?: unknown;
}

interface ElementLike {
  tagName?: unknown;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
}

function asElementLike(target: unknown): ElementLike | null {
  return target && typeof target === 'object' ? target as ElementLike : null;
}

function normalizedTagName(target: unknown): string {
  const value = asElementLike(target)?.tagName;
  return typeof value === 'string' ? value.toLowerCase() : '';
}

export function isEpisodeNavigationTextEntryTarget(target: unknown): boolean {
  const element = asElementLike(target);
  if (!element) return false;

  const tagName = normalizedTagName(target);
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') return true;
  if (element.isContentEditable) return true;

  return typeof element.closest === 'function'
    ? Boolean(element.closest('input, textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"]'))
    : false;
}

export function resolveEpisodeNavigationDirectionFromKey(
  input: EpisodeNavigationKeyInput,
): EpisodeNavigationDirection | null {
  if (
    input.defaultPrevented ||
    input.repeat ||
    input.altKey ||
    input.ctrlKey ||
    input.metaKey ||
    input.shiftKey ||
    isEpisodeNavigationTextEntryTarget(input.target)
  ) {
    return null;
  }

  if (input.key === 'ArrowLeft') return 'previous';
  if (input.key === 'ArrowRight') return 'next';
  return null;
}

export function canStartEpisodeSwipeFromTarget(target: unknown): boolean {
  const element = asElementLike(target);
  if (!element) return true;

  const tagName = normalizedTagName(target);
  if (['button', 'a', 'input', 'textarea', 'select'].includes(tagName)) return false;
  if (element.isContentEditable) return false;

  return typeof element.closest === 'function'
    ? !element.closest('button, a, input, textarea, select, [role="button"], [contenteditable="true"]')
    : true;
}

export interface EpisodeNumbered {
  episode_number: number;
}

interface LoadedEpisodeNavigationInput<T extends EpisodeNumbered> {
  direction: EpisodeNavigationDirection;
  currentSeason: number;
  currentEpisodeNumber: number;
  minSeason: number;
  currentSeasonEpisodes?: readonly T[] | null;
  adjacentSeasonEpisodes?: readonly T[] | null;
}

export interface LoadedEpisodeNavigationTarget<T extends EpisodeNumbered> {
  season: number;
  episode: T;
}

export function resolveLoadedAdjacentEpisode<T extends EpisodeNumbered>(
  input: LoadedEpisodeNavigationInput<T>,
): LoadedEpisodeNavigationTarget<T> | null {
  const currentEpisodes = input.currentSeasonEpisodes || [];

  if (input.direction === 'previous') {
    const direct = currentEpisodes.find(
      episode => episode.episode_number === input.currentEpisodeNumber - 1,
    );
    if (direct) return { season: input.currentSeason, episode: direct };

    if (input.currentEpisodeNumber !== 1 || input.currentSeason <= input.minSeason) {
      return null;
    }

    const previousEpisodes = input.adjacentSeasonEpisodes || [];
    if (previousEpisodes.length === 0) return null;
    const lastEpisode = previousEpisodes.reduce((latest, episode) =>
      episode.episode_number > latest.episode_number ? episode : latest
    );
    return { season: input.currentSeason - 1, episode: lastEpisode };
  }

  const direct = currentEpisodes.find(
    episode => episode.episode_number === input.currentEpisodeNumber + 1,
  );
  if (direct) return { season: input.currentSeason, episode: direct };

  if (currentEpisodes.length > 0) {
    const highestEpisode = currentEpisodes.reduce(
      (highest, episode) => Math.max(highest, episode.episode_number),
      0,
    );
    if (input.currentEpisodeNumber < highestEpisode) return null;
  }

  const nextEpisodes = input.adjacentSeasonEpisodes || [];
  if (nextEpisodes.length === 0) return null;
  const firstEpisode = nextEpisodes.reduce((earliest, episode) =>
    episode.episode_number < earliest.episode_number ? episode : earliest
  );
  return { season: input.currentSeason + 1, episode: firstEpisode };
}
