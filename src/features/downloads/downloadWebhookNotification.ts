export const PLEX_AVAILABILITY_CHECK_PUSH_TYPE = 'PLEX_AVAILABILITY_CHECK';

export type DownloadWebhookSource = 'sonarr' | 'radarr';

export interface DownloadWebhookPresentation {
  eventType: string;
  notification: { title: string; body: string };
  data: Record<string, string>;
  plexAvailabilityData: Record<string, string> | null;
}

interface DownloadWebhookMedia {
  title?: unknown;
  tmdbId?: unknown;
}

interface DownloadWebhookPayload {
  eventType?: unknown;
  event_type?: unknown;
  downloadId?: unknown;
  series?: DownloadWebhookMedia;
  movie?: DownloadWebhookMedia;
  release?: { releaseTitle?: unknown };
  episodes?: Array<{ seasonNumber?: unknown; episodeNumber?: unknown }>;
}

function normalizePayload(input: unknown): DownloadWebhookPayload {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? input as DownloadWebhookPayload
    : {};
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function displayText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const clean = value.trim().replace(/\s+/g, ' ');
  return clean ? clean.slice(0, 180) : fallback;
}

function firstEpisode(payload: DownloadWebhookPayload): { season: number; episode: number } | null {
  const candidate = Array.isArray(payload?.episodes) ? payload.episodes[0] : null;
  const season = positiveInteger(candidate?.seasonNumber);
  const episode = positiveInteger(candidate?.episodeNumber);
  return season && episode ? { season, episode } : null;
}

function buildEventKey(
  source: DownloadWebhookSource,
  payload: DownloadWebhookPayload,
  tmdbId: number | null,
  episode: { season: number; episode: number } | null
): string {
  const rawDownloadId = typeof payload?.downloadId === 'string' ? payload.downloadId.trim() : '';
  const transfer = rawDownloadId ? rawDownloadId.slice(0, 96) : (tmdbId ? `tmdb-${tmdbId}` : 'unresolved');
  return [source, transfer, episode ? `s${episode.season}e${episode.episode}` : 'media'].join(':');
}

export function buildDownloadWebhookPresentation(
  source: DownloadWebhookSource,
  input: unknown
): DownloadWebhookPresentation {
  const payload = normalizePayload(input);
  const eventType = typeof payload.eventType === 'string'
    ? payload.eventType.trim()
    : (typeof payload.event_type === 'string' ? payload.event_type.trim() : 'Unknown');
  const commonData: Record<string, string> = {
    type: 'DOWNLOAD_EVENT',
    source,
    eventType
  };

  if (eventType === 'Grab') {
    const mediaTitle = displayText(
      payload?.series?.title || payload?.movie?.title || payload?.release?.releaseTitle,
      'Média'
    );
    return {
      eventType,
      notification: {
        title: 'Téléchargement démarré 🚀',
        body: `"${mediaTitle}" a été envoyé au client de téléchargement.`
      },
      data: commonData,
      plexAvailabilityData: null
    };
  }

  if (eventType !== 'Download') {
    return {
      eventType,
      notification: {
        title: 'Notification Téléchargement',
        body: 'Un événement de téléchargement a eu lieu.'
      },
      data: commonData,
      plexAvailabilityData: null
    };
  }

  const mediaType: 'movie' | 'tv' = payload?.movie ? 'movie' : 'tv';
  const mediaTitle = displayText(payload?.movie?.title || payload?.series?.title, 'Média');
  const tmdbId = positiveInteger(payload?.movie?.tmdbId ?? payload?.series?.tmdbId);
  const episode = mediaType === 'tv' ? firstEpisode(payload) : null;
  const suffix = episode ? ` (S${episode.season}E${episode.episode})` : '';

  const data: Record<string, string> = {
    ...commonData,
    mediaType,
    title: mediaTitle
  };
  if (tmdbId) data.tmdbId = String(tmdbId);
  if (episode) {
    data.season = String(episode.season);
    data.episode = String(episode.episode);
  }

  const plexAvailabilityData = tmdbId ? {
    type: PLEX_AVAILABILITY_CHECK_PUSH_TYPE,
    source,
    eventType,
    mediaType,
    title: mediaTitle,
    tmdbId: String(tmdbId),
    eventKey: buildEventKey(source, payload, tmdbId, episode),
    ...(episode ? {
      season: String(episode.season),
      episode: String(episode.episode)
    } : {})
  } : null;

  return {
    eventType,
    notification: {
      title: 'Import terminé 🍿',
      body: `"${mediaTitle}${suffix}" a été importé. Plex s’actualise.`
    },
    data,
    plexAvailabilityData
  };
}
