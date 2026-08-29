import { useLiveDownloadStore } from '../../store/liveDownloadStore';
import { useDownloadConfigStore } from '../../store/downloadConfigStore';
import { useToastStore } from '../../store/toastStore';
import {
  cleanUrl,
  executeGet,
  type LiveDownloadItem,
  type SonarrRadarrConfig
} from '../../services/sonarrRadarr';

const WATCH_INTERVAL_MS = 2500;
const VERIFY_COOLDOWN_MS = 5000;
const WATCH_TTL_MS = 30 * 60 * 1000;
const RESUME_HISTORY_WINDOW_MS = 60 * 60 * 1000;

const watchers = new Map<string, ReturnType<typeof setTimeout>>();
const watcherStartedAt = new Map<string, number>();
const lastVerificationAt = new Map<string, number>();
let resumeScheduled = false;

function normalize(value?: string): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\(\d{4}\)/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function sameMedia(base: LiveDownloadItem, candidate: LiveDownloadItem): boolean {
  if (base.mediaType !== candidate.mediaType) return false;
  if (base.tmdbId && candidate.tmdbId && Number(base.tmdbId) === Number(candidate.tmdbId)) return true;
  if (base.tvdbId && candidate.tvdbId && Number(base.tvdbId) === Number(candidate.tvdbId)) return true;
  if (base.imdbId && candidate.imdbId && String(base.imdbId).toLowerCase() === String(candidate.imdbId).toLowerCase()) return true;

  const a = normalize(base.seriesTitle || base.movieTitle || base.title);
  const b = normalize(candidate.seriesTitle || candidate.movieTitle || candidate.title);
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
}

function scopeMatches(base: LiveDownloadItem, candidate: LiveDownloadItem): boolean {
  if (!sameMedia(base, candidate)) return false;
  if (base.mediaType !== 'tv') return true;

  if (base.seasonNumber != null && candidate.seasonNumber != null && Number(base.seasonNumber) !== Number(candidate.seasonNumber)) {
    return false;
  }
  if (base.episodeNumber != null && candidate.episodeNumber != null && Number(base.episodeNumber) !== Number(candidate.episodeNumber)) {
    return false;
  }
  return true;
}

function getRecords(response: any): any[] {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.records)) return response.records;
  return [];
}

function isRecentImportedRecord(record: any, sinceMs: number, releaseTitle?: string): boolean {
  const eventType = String(record?.eventType || '').toLowerCase();
  if (eventType !== 'downloadfolderimported') return false;

  const eventDate = Date.parse(record?.date || '');
  if (Number.isFinite(eventDate) && eventDate < sinceMs) return false;

  const expected = normalize(releaseTitle);
  const actual = normalize(record?.sourceTitle || record?.data?.sourceTitle || record?.data?.releaseTitle);
  if (!expected || !actual) return true;

  return expected === actual || expected.includes(actual) || actual.includes(expected);
}

async function verifyRadarrCompletion(
  item: LiveDownloadItem,
  config: SonarrRadarrConfig,
  sinceMs: number
): Promise<boolean> {
  if (!config.radarrUrl || !config.radarrApiKey) return false;

  const base = cleanUrl(config.radarrUrl);
  const headers = { 'X-Api-Key': config.radarrApiKey, 'Accept': 'application/json' };
  const movies = await executeGet(`${base}/api/v3/movie`, headers);
  if (!Array.isArray(movies)) return false;

  const expectedTitle = normalize(item.movieTitle || item.title);
  const movie = movies.find((candidate: any) => {
    if (item.tmdbId && candidate?.tmdbId && Number(item.tmdbId) === Number(candidate.tmdbId)) return true;
    if (item.imdbId && candidate?.imdbId && String(item.imdbId).toLowerCase() === String(candidate.imdbId).toLowerCase()) return true;
    const candidateTitle = normalize(candidate?.title);
    return Boolean(expectedTitle && candidateTitle && expectedTitle === candidateTitle);
  });
  if (!movie?.id) return false;

  const history = await executeGet(
    `${base}/api/v3/history?page=1&pageSize=100&sortKey=date&sortDirection=descending&includeMovie=true`,
    headers
  );

  return getRecords(history).some((record: any) =>
    Number(record?.movieId ?? record?.movie?.id) === Number(movie.id)
    && isRecentImportedRecord(record, sinceMs, item.releaseTitle)
  );
}

async function verifySonarrCompletion(
  item: LiveDownloadItem,
  config: SonarrRadarrConfig,
  sinceMs: number
): Promise<boolean> {
  if (!config.sonarrUrl || !config.sonarrApiKey) return false;
  if (item.seasonNumber == null || item.episodeNumber == null) return false;

  const base = cleanUrl(config.sonarrUrl);
  const headers = { 'X-Api-Key': config.sonarrApiKey, 'Accept': 'application/json' };
  const seriesList = await executeGet(`${base}/api/v3/series`, headers);
  if (!Array.isArray(seriesList)) return false;

  const expectedTitle = normalize(item.seriesTitle || item.title);
  const series = seriesList.find((candidate: any) => {
    if (item.tvdbId && candidate?.tvdbId && Number(item.tvdbId) === Number(candidate.tvdbId)) return true;
    if (item.tmdbId && candidate?.tmdbId && Number(item.tmdbId) === Number(candidate.tmdbId)) return true;
    if (item.imdbId && candidate?.imdbId && String(item.imdbId).toLowerCase() === String(candidate.imdbId).toLowerCase()) return true;
    const candidateTitle = normalize(candidate?.title);
    return Boolean(expectedTitle && candidateTitle && expectedTitle === candidateTitle);
  });
  if (!series?.id) return false;

  const episodes = await executeGet(`${base}/api/v3/episode?seriesId=${series.id}`, headers);
  if (!Array.isArray(episodes)) return false;

  const episode = episodes.find((candidate: any) =>
    Number(candidate?.seasonNumber) === Number(item.seasonNumber)
    && Number(candidate?.episodeNumber) === Number(item.episodeNumber)
  );
  if (!episode?.id) return false;

  const history = await executeGet(
    `${base}/api/v3/history?page=1&pageSize=100&sortKey=date&sortDirection=descending&includeSeries=true&includeEpisode=true`,
    headers
  );

  return getRecords(history).some((record: any) =>
    Number(record?.episodeId ?? record?.episode?.id) === Number(episode.id)
    && isRecentImportedRecord(record, sinceMs, item.releaseTitle)
  );
}

async function verifyCompletion(item: LiveDownloadItem, sinceMs: number): Promise<boolean> {
  const config = useDownloadConfigStore.getState();
  try {
    if (item.mediaType === 'movie') {
      return await verifyRadarrCompletion(item, config, sinceMs);
    }
    return await verifySonarrCompletion(item, config, sinceMs);
  } catch (error) {
    console.warn('[DownloadCompletion] Vérification import impossible:', error);
    return false;
  }
}

function shouldVerify(item: LiveDownloadItem): boolean {
  if (item.isOptimistic) return false;
  if (item.status === 'completed' || item.progress >= 100) return false;
  if (!item.id.startsWith('sonarr_') && !item.id.startsWith('radarr_')) return false;

  const text = `${item.status || ''} ${item.statusText || ''}`.toLowerCase();
  return text.includes('synchronisation')
    || text.includes('introuvable')
    || text.includes('vérification')
    || text.includes('verification')
    || item.status === 'warning';
}

function watcherKey(base: LiveDownloadItem): string {
  const canonical = base.tmdbId
    ? `tmdb:${base.tmdbId}`
    : base.tvdbId
      ? `tvdb:${base.tvdbId}`
      : base.imdbId
        ? `imdb:${base.imdbId}`
        : `title:${normalize(base.seriesTitle || base.movieTitle || base.title)}`;
  return `${base.mediaType}:${canonical}:s${base.seasonNumber ?? '*'}:e${base.episodeNumber ?? '*'}`;
}

function markCompleted(item: LiveDownloadItem) {
  useLiveDownloadStore.getState().updateDownloadRequest(item.id, {
    progress: 100,
    status: 'completed',
    statusText: 'Téléchargement terminé 🍿',
    errorMessage: undefined,
    sizeleft: 0,
    speedBytesPerSec: 0,
    speedFormatted: '',
    timeleft: '',
    timeleftSeconds: 0,
    isOptimistic: false
  });

  try {
    useToastStore.getState().showToast(`Téléchargement terminé 🍿 : ${item.seriesTitle || item.movieTitle || item.title}`, 'success');
  } catch {}
}

export function startDownloadCompletionWatcher(baseItem: LiveDownloadItem, startedAt = Date.now()) {
  if (typeof window === 'undefined') return;
  if (baseItem.downloadClient && !/sonarr|radarr/i.test(baseItem.downloadClient)) return;

  const key = watcherKey(baseItem);
  if (watchers.has(key)) return;
  watcherStartedAt.set(key, startedAt);

  const tick = async () => {
    const watchStart = watcherStartedAt.get(key) || startedAt;
    if (Date.now() - watchStart > WATCH_TTL_MS) {
      watchers.delete(key);
      watcherStartedAt.delete(key);
      return;
    }

    const downloads = useLiveDownloadStore.getState().downloads || [];
    const candidates = downloads.filter(item => scopeMatches(baseItem, item));

    for (const candidate of candidates) {
      if (!shouldVerify(candidate)) continue;

      const lastCheck = lastVerificationAt.get(candidate.id) || 0;
      if (Date.now() - lastCheck < VERIFY_COOLDOWN_MS) continue;
      lastVerificationAt.set(candidate.id, Date.now());

      const sinceMs = Math.max(watchStart - 60_000, Date.now() - RESUME_HISTORY_WINDOW_MS);
      const completed = await verifyCompletion(candidate, sinceMs);
      if (completed) {
        markCompleted(candidate);
        lastVerificationAt.delete(candidate.id);
      }
    }

    const timer = setTimeout(() => void tick(), WATCH_INTERVAL_MS);
    watchers.set(key, timer);
  };

  const timer = setTimeout(() => void tick(), 1200);
  watchers.set(key, timer);
}

export function scheduleResumeDownloadCompletionWatchers() {
  if (typeof window === 'undefined' || resumeScheduled) return;
  resumeScheduled = true;

  window.setTimeout(() => {
    const resumeStartedAt = Date.now() - RESUME_HISTORY_WINDOW_MS;
    const downloads = useLiveDownloadStore.getState().downloads || [];
    downloads
      .filter(item => item.status !== 'completed' && item.progress < 100)
      .forEach(item => startDownloadCompletionWatcher(item, resumeStartedAt));
  }, 1800);
}
