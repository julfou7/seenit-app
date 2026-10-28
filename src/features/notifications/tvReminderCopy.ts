import { type Show } from '../../types.ts';
import {
  getExtraAvailableEpisodes,
  type WatchEpisodePointer,
} from '../watchlist/watchEpisodeProgress.ts';

export interface TvReminderEpisode extends WatchEpisodePointer {
  name?: string | null;
  runtime?: number | null;
  episode_type?: string | null;
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
  return 'Bientôt';
}

export function buildTvEpisodeReminderCopy(
  show: Show,
  releasedEpisode: TvReminderEpisode,
  todayStr: string,
  providerName?: string,
): TvEpisodeReminderCopy {
  const defaultBody = providerName ? `${episodeLabel(releasedEpisode)} — sur ${providerName}` : `${episodeLabel(releasedEpisode)} disponible aujourd’hui.`;
  if (show.seenEpisodes?.includes(`${releasedEpisode.season_number}x${releasedEpisode.episode_number}`)
    && (!show.nextEpisodeToWatch || show.nextEpisodeToWatch.air_date > todayStr)) {
    return { summaryText: 'Nouvel épisode', body: `À jour · ${formatTvEpisodeCode(releasedEpisode)}`,
      detailText: 'Tu as vu tous les épisodes disponibles.' };
  }
  const nextToWatch = show.nextEpisodeToWatch as TvReminderEpisode | undefined;

  if (!nextToWatch) {
    return {
      summaryText: 'Nouvel épisode',
      body: defaultBody,
      detailText: 'Retrouve cet épisode dans ta liste À voir.',
    };
  }

  const nextIsAvailable = !nextToWatch.air_date || nextToWatch.air_date <= todayStr;
  if (!nextIsAvailable) {
    return {
      summaryText: 'Nouvel épisode',
      body: defaultBody,
      detailText: 'Retrouve cet épisode dans ta liste À voir.',
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

  const header = releasedEpisode.episode_type === 'finale'
    ? (show.seriesEnded ? 'Final de série' : 'Final de saison') : 'Nouvel épisode';
  if (sameEpisode && waitingCount === 1) {
    return {
      summaryText: header,
      body: defaultBody,
      detailText: [providerName, releasedEpisode.runtime && `${releasedEpisode.runtime} min`, 'C’est ton prochain épisode.'].filter(Boolean).join(' · '),
    };
  }

  return {
    summaryText: header,
    body: `À voir : ${formatTvEpisodeCode(nextToWatch)} · ${waitingEpisodesLabel(waitingCount)}.`,
    detailText: `Ton prochain : ${episodeLabel(nextToWatch)}\n${waitingCount} épisodes à rattraper · le plus récent est sorti aujourd’hui.`,
  };
}
