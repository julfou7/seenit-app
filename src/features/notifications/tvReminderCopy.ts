import { type Show } from '../../types.ts';
import {
  getExtraAvailableEpisodes,
  type WatchEpisodePointer,
} from '../watchlist/watchEpisodeProgress.ts';

export interface TvReminderEpisode extends WatchEpisodePointer {
  name?: string | null;
}

export interface TvEpisodeReminderCopy {
  summaryText: string;
  body: string;
  detailText?: string;
}

export function formatTvEpisodeCode(episode: Pick<TvReminderEpisode, 'season_number' | 'episode_number'>): string {
  const season = String(episode.season_number).padStart(2, '0');
  const number = String(episode.episode_number).padStart(2, '0');
  return `S${season} | E${number}`;
}

function episodeLabel(episode: TvReminderEpisode): string {
  const name = episode.name?.trim();
  return `${formatTvEpisodeCode(episode)}${name ? ` · ${name}` : ''}`;
}

function waitingEpisodesLabel(count: number): string {
  return `${count} épisode${count > 1 ? 's' : ''} t’attend${count > 1 ? 'ent' : ''}`;
}

export function buildTvSeasonReminderSummary(_episode: TvReminderEpisode): string {
  return 'Nouvelle saison';
}

export function buildTvEpisodeReminderCopy(
  show: Show,
  releasedEpisode: TvReminderEpisode,
  todayStr: string,
): TvEpisodeReminderCopy {
  const defaultBody = `${episodeLabel(releasedEpisode)} disponible aujourd’hui.`;
  const nextToWatch = show.nextEpisodeToWatch as TvReminderEpisode | undefined;

  if (!nextToWatch) {
    return {
      summaryText: 'Nouvel épisode',
      body: defaultBody,
    };
  }

  const nextIsAvailable = !nextToWatch.air_date || nextToWatch.air_date <= todayStr;
  if (!nextIsAvailable) {
    return {
      summaryText: 'Nouvel épisode',
      body: defaultBody,
    };
  }

  const sameEpisode = (
    nextToWatch.season_number === releasedEpisode.season_number
    && nextToWatch.episode_number === releasedEpisode.episode_number
  );
  const computedExtra = getExtraAvailableEpisodes(show, nextToWatch, todayStr);
  const extraAvailableEpisodes = sameEpisode
    ? computedExtra
    : Math.max(1, computedExtra);
  const waitingCount = extraAvailableEpisodes + 1;

  if (sameEpisode && waitingCount === 1) {
    return {
      summaryText: 'Nouvel épisode',
      body: defaultBody,
    };
  }

  return {
    summaryText: 'Nouvel épisode',
    body: `À voir : ${formatTvEpisodeCode(nextToWatch)} · ${waitingEpisodesLabel(waitingCount)}.`,
    detailText: sameEpisode
      ? `Tu as ${waitingCount} épisodes disponibles à reprendre.`
      : `Tu as ${waitingCount} épisodes à reprendre. Un nouvel épisode est disponible aujourd’hui.`,
  };
}
