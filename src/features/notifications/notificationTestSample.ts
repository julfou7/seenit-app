import type { Show } from '../../types';

export type NotificationTestType =
  | 'release_today_tv'
  | 'season_d7'
  | 'movie_theater'
  | 'movie_dvd_vod';

interface EpisodeSample {
  season_number: number;
  episode_number: number;
  name?: string | null;
  air_date?: string | null;
  still_path?: string | null;
}

export interface NotificationTestSample {
  type: NotificationTestType;
  show: Show;
  isUpcoming: boolean;
  eventDate?: string;
  season?: number;
  episode?: number;
  notificationTitle: string;
  summaryText: string;
  body: string;
  posterUrl: string;
  richImageUrl: string;
  allowMarkWatched: boolean;
  data: {
    url: string;
    showId: string;
    tmdbId: number;
    mediaType: 'tv' | 'movie';
    season?: number;
    episode?: number;
  };
}

const SEENIT_ICON_URL = 'https://seenit.app/icon-192.png';

function todayLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function addUtcDays(value: string, days: number): string | null {
  if (!isIsoDate(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null;
  }
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function mediaImageUrl(path: string | null | undefined, size: 'w154' | 'w500'): string | undefined {
  if (!path) return undefined;
  return path.startsWith('http') ? path : `https://image.tmdb.org/t/p/${size}${path}`;
}

function getTvEpisodes(show: Show): EpisodeSample[] {
  const raw = [show.nextEpisodeToAir, show.nextEpisodeToWatch].filter(Boolean) as EpisodeSample[];
  const unique = new Map<string, EpisodeSample>();
  for (const episode of raw) {
    const season = Number(episode.season_number);
    const number = Number(episode.episode_number);
    if (!Number.isFinite(season) || !Number.isFinite(number)) continue;
    const key = `${season}x${number}`;
    const current = unique.get(key);
    if (!current || (!current.air_date && episode.air_date)) unique.set(key, episode);
  }
  return [...unique.values()];
}

function stableFallback(shows: Show[], mediaType: 'tv' | 'movie', preferSeasonPremiere = false): Show | null {
  const matching = shows.filter(show => show.mediaType === mediaType);
  if (matching.length === 0) return null;

  return [...matching].sort((a, b) => {
    if (preferSeasonPremiere) {
      const aPremiere = getTvEpisodes(a).some(episode => Number(episode.episode_number) === 1) ? 1 : 0;
      const bPremiere = getTvEpisodes(b).some(episode => Number(episode.episode_number) === 1) ? 1 : 0;
      if (aPremiere !== bPremiere) return bPremiere - aPremiere;
    }
    const aVisual = a.posterPath || a.backdropPath ? 1 : 0;
    const bVisual = b.posterPath || b.backdropPath ? 1 : 0;
    if (aVisual !== bVisual) return bVisual - aVisual;
    if ((a.updatedAt || 0) !== (b.updatedAt || 0)) return (b.updatedAt || 0) - (a.updatedAt || 0);
    return a.title.localeCompare(b.title, 'fr');
  })[0];
}

function selectUpcomingTv(
  shows: Show[],
  today: string,
  seasonPremiereOnly: boolean
): { show: Show; episode: EpisodeSample; eventDate: string } | null {
  const candidates: Array<{ show: Show; episode: EpisodeSample; eventDate: string }> = [];
  for (const show of shows) {
    if (show.mediaType !== 'tv') continue;
    for (const episode of getTvEpisodes(show)) {
      if (!isIsoDate(episode.air_date) || episode.air_date < today) continue;
      if (seasonPremiereOnly && Number(episode.episode_number) !== 1) continue;
      candidates.push({ show, episode, eventDate: episode.air_date });
    }
  }
  candidates.sort((a, b) => a.eventDate.localeCompare(b.eventDate) || a.show.title.localeCompare(b.show.title, 'fr'));
  return candidates[0] || null;
}

function selectUpcomingMovie(
  shows: Show[],
  today: string,
  vod: boolean
): { show: Show; eventDate: string } | null {
  const candidates: Array<{ show: Show; eventDate: string }> = [];
  for (const show of shows) {
    if (show.mediaType !== 'movie' || !isIsoDate(show.firstAirDate)) continue;
    const eventDate = vod ? addUtcDays(show.firstAirDate, 120) : show.firstAirDate;
    if (!eventDate || eventDate < today) continue;
    candidates.push({ show, eventDate });
  }
  candidates.sort((a, b) => a.eventDate.localeCompare(b.eventDate) || a.show.title.localeCompare(b.show.title, 'fr'));
  return candidates[0] || null;
}

function buildSample(
  show: Show,
  type: NotificationTestType,
  isUpcoming: boolean,
  eventDate?: string,
  episode?: EpisodeSample
): NotificationTestSample {
  const posterUrl = mediaImageUrl(show.posterPath, 'w154') || SEENIT_ICON_URL;
  const fallbackRich = mediaImageUrl(show.backdropPath, 'w500')
    || mediaImageUrl(show.posterPath, 'w500')
    || SEENIT_ICON_URL;
  const episodeRich = mediaImageUrl(episode?.still_path, 'w500') || fallbackRich;
  const season = episode ? Number(episode.season_number) : undefined;
  const episodeNumber = episode ? Number(episode.episode_number) : undefined;
  const sNum = String(season || 1).padStart(2, '0');
  const eNum = String(episodeNumber || 1).padStart(2, '0');

  if (type === 'release_today_tv') {
    const episodeName = episode?.name ? `« ${episode.name} » ` : '';
    return {
      type,
      show,
      isUpcoming,
      eventDate,
      season,
      episode: episodeNumber,
      notificationTitle: `🆕 ${show.title}`,
      summaryText: '🆕 Nouvel épisode',
      body: `L'épisode S${sNum}E${eNum} ${episodeName}est disponible aujourd'hui !`,
      posterUrl,
      richImageUrl: episodeRich,
      allowMarkWatched: true,
      data: {
        url: `/?showId=${show.id}&tmdbId=${show.tmdbId}&mediaType=tv&season=${season || 1}&episode=${episodeNumber || 1}&tab=watchlist`,
        showId: show.id,
        tmdbId: show.tmdbId,
        mediaType: 'tv',
        season: season || 1,
        episode: episodeNumber || 1,
      },
    };
  }

  if (type === 'season_d7') {
    return {
      type,
      show,
      isUpcoming,
      eventDate,
      season,
      episode: episodeNumber,
      notificationTitle: `📅 ${show.title}`,
      summaryText: '📅 Nouvelle saison',
      body: `La saison ${season || 1} de ${show.title} sort dans 7 jours ! Préparez-vous !`,
      posterUrl,
      richImageUrl: episodeRich,
      allowMarkWatched: false,
      data: {
        url: `/?showId=${show.id}&tmdbId=${show.tmdbId}&mediaType=tv&season=${season || 1}&episode=${episodeNumber || 1}&tab=watchlist`,
        showId: show.id,
        tmdbId: show.tmdbId,
        mediaType: 'tv',
        season: season || 1,
        episode: episodeNumber || 1,
      },
    };
  }

  if (type === 'movie_theater') {
    return {
      type,
      show,
      isUpcoming,
      eventDate,
      notificationTitle: `🎬 ${show.title}`,
      summaryText: '🎬 Sortie cinéma',
      body: `Sortie Cinéma : ${show.title} est dans les salles aujourd'hui !`,
      posterUrl,
      richImageUrl: fallbackRich,
      allowMarkWatched: false,
      data: {
        url: `/?showId=${show.id}&tmdbId=${show.tmdbId}&mediaType=movie&tab=watchlist`,
        showId: show.id,
        tmdbId: show.tmdbId,
        mediaType: 'movie',
      },
    };
  }

  return {
    type,
    show,
    isUpcoming,
    eventDate,
    notificationTitle: `📺 ${show.title}`,
    summaryText: '📺 Sortie DVD / VOD',
    body: `Sortie DVD / VOD : ${show.title} est désormais disponible !`,
    posterUrl,
    richImageUrl: fallbackRich,
    allowMarkWatched: false,
    data: {
      url: `/?showId=${show.id}&tmdbId=${show.tmdbId}&mediaType=movie&tab=watchlist`,
      showId: show.id,
      tmdbId: show.tmdbId,
      mediaType: 'movie',
    },
  };
}

/**
 * Choisit d'abord un vrai événement à venir du type testé. Si la bibliothèque
 * n'en contient aucun, le bouton reste utilisable avec un média actif du bon
 * type afin de tester le rendu (notamment l'affiche), sans prétendre que cet
 * événement fallback est réellement programmé.
 */
export function buildNotificationTestSample(
  shows: Show[],
  type: NotificationTestType,
  now: Date = new Date()
): NotificationTestSample | null {
  const activeShows = shows.filter(show => !show.isArchived && show.status !== 'dropped');
  const today = todayLocal(now);

  if (type === 'release_today_tv' || type === 'season_d7') {
    const upcoming = selectUpcomingTv(activeShows, today, type === 'season_d7');
    if (upcoming) {
      return buildSample(upcoming.show, type, true, upcoming.eventDate, upcoming.episode);
    }

    const fallbackShow = stableFallback(activeShows, 'tv', type === 'season_d7');
    if (!fallbackShow) return null;
    const fallbackEpisode = getTvEpisodes(fallbackShow)
      .sort((a, b) => String(a.air_date || '').localeCompare(String(b.air_date || '')))[0];
    return buildSample(fallbackShow, type, false, undefined, fallbackEpisode);
  }

  const upcoming = selectUpcomingMovie(activeShows, today, type === 'movie_dvd_vod');
  if (upcoming) return buildSample(upcoming.show, type, true, upcoming.eventDate);

  const fallbackShow = stableFallback(activeShows, 'movie');
  return fallbackShow ? buildSample(fallbackShow, type, false) : null;
}
