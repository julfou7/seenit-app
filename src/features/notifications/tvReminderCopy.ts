import { type Show } from '../../types';
import {
  getExtraAvailableEpisodes,
  type WatchEpisodePointer,
} from '../watchlist/watchEpisodeProgress';

export interface TvReminderEpisode extends WatchEpisodePointer {
  name?: string | null;
}

export interface TvEpisodeReminderCopy {
  summaryText: string;
  body: string;
}

export function formatTvEpisodeCode(episode: Pick<TvReminderEpisode, 'season_number' | 'episode_number'>): string {
  const season = String(episode.season_number).padStart(2, '0');
  const number = String(episode.episode_number).padStart(2, '0');
  return `S${season}E${number}`;
}

function episodeLabel(episode: TvReminderEpisode): string {
  const name = episode.name?.trim();
  return `${formatTvEpisodeCode(episode)}${name ? ` · ${name}` : ''}`;
}

function backlogSuffix(extraAvailableEpisodes: number): string {
  if (extraAvailableEpisodes <= 0) return '';
  return ` · + ${extraAvailableEpisodes} épisode${extraAvailableEpisodes > 1 ? 's' : ''}`;
}

export function buildTvSeasonReminderSummary(episode: TvReminderEpisode): string {
  return `📅 Nouvelle saison · Saison ${episode.season_number}`;
}

export function buildTvEpisodeReminderCopy(
  show: Show,
  releasedEpisode: TvReminderEpisode,
  todayStr: string,
): TvEpisodeReminderCopy {
  const releasedCode = formatTvEpisodeCode(releasedEpisode);
  const defaultBody = `${episodeLabel(releasedEpisode)} disponible aujourd'hui.`;
  const nextToWatch = show.nextEpisodeToWatch as TvReminderEpisode | undefined;

  if (!nextToWatch) {
    return {
      summaryText: `🆕 Nouvel épisode · ${releasedCode}`,
      body: defaultBody,
    };
  }

  const nextIsAvailable = !nextToWatch.air_date || nextToWatch.air_date <= todayStr;
  if (!nextIsAvailable) {
    return {
      summaryText: `🆕 Nouvel épisode · ${releasedCode}`,
      body: defaultBody,
    };
  }

  const nextCode = formatTvEpisodeCode(nextToWatch);
  const sameEpisode = (
    nextToWatch.season_number === releasedEpisode.season_number
    && nextToWatch.episode_number === releasedEpisode.episode_number
  );
  const computedExtra = getExtraAvailableEpisodes(show, nextToWatch, todayStr);
  const extraAvailableEpisodes = sameEpisode
    ? computedExtra
    : Math.max(1, computedExtra);

  if (sameEpisode && extraAvailableEpisodes === 0) {
    return {
      summaryText: `🆕 Nouvel épisode · ${releasedCode}`,
      body: defaultBody,
    };
  }

  const suffix = backlogSuffix(extraAvailableEpisodes);
  const summaryText = `🆕 Nouvel épisode · ${releasedCode} · À voir ${nextCode}${suffix}`;

  if (sameEpisode) {
    return {
      summaryText,
      body: `À voir : ${episodeLabel(nextToWatch)}${suffix}.`,
    };
  }

  return {
    summaryText,
    body: `À voir : ${episodeLabel(nextToWatch)}${suffix}. Nouvel épisode : ${episodeLabel(releasedEpisode)} disponible aujourd'hui.`,
  };
}
