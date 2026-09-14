import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { C411Torrent } from './c411';
import { authenticatedFetch } from '../lib/apiAuth';
import { buildFreshGetUrl, buildNoCacheHeaders } from '../features/downloads/downloadNetwork';
import { extractQbitSessionCookie, isQbitAuthError } from '../features/downloads/qbitNativeSession';
import { getPhysicalDownloadId, isStrongTorrentHash, mergeDownloadIdAliases, normalizeDownloadClientId, normalizeQualityLabel, samePhysicalDownload, sameTransferPath } from '../features/downloads/downloadIdentity';
import { auth } from '../lib/firebase';
import { buildQbitSessionScopeKey } from '../features/downloads/qbitSessionScope';
import { nextDownloadSourceBackoffMs, shouldFetchNextArrQueuePage } from '../features/downloads/downloadPollingPolicy';
import { executeDownloadMutationOnce } from '../features/downloads/downloadMutationPolicy';
import { isSafeMagnetLink } from '../features/downloads/magnetLink';
import {
  type SonarrRadarrConfig,
  cleanUrl,
  executeDelete,
  executeGet,
  executePost,
  invalidateQbitCache,
  loginQBittorrent,
} from './sonarrRadarrTransport';

/* ========================================================================
   GÉRATION DU SUIVI DES TÉLÉCHARGEMENTS EN DIRECT (SONARR, RADARR, QBIT)
   ======================================================================== */

export interface LiveDownloadItem {
  id: string;
  mediaType: 'tv' | 'movie';
  title: string;
  seriesTitle?: string;
  movieTitle?: string;
  episodeTitle?: string;
  quality?: string;
  tmdbId?: number;
  tvdbId?: number;
  imdbId?: string;
  posterPath?: string;
  backdropPath?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  size: number;
  sizeleft: number;
  progress: number;
  timeleft?: string;
  timeleftSeconds?: number;
  speedBytesPerSec?: number;
  speedFormatted?: string;
  status: 'downloading' | 'queued' | 'paused' | 'completed' | 'warning' | 'error' | string;
  statusText: string;
  errorMessage?: string;
  downloadClient?: string;
  releaseTitle?: string;
  /** Identifiant principal du transfert. */
  downloadId?: string;
  /** Tous les identifiants connus du même torrent (hash qBit, infohash v1/v2, alias *Arr). */
  downloadIdAliases?: string[];
  /** Chemin de travail remonté par *Arr / qBittorrent, utile comme identité forte de secours. */
  transferPath?: string;
  /** Date d'ajout du transfert quand la source la fournit. */
  addedAt?: number;
  /** Item réhydraté du stockage local en attente de confirmation serveur. */
  isRestored?: boolean;
  isOptimistic?: boolean;
  /** Demande SeenIt d'origine, utilisée pour corréler *Arr et qBittorrent sans le nom. */
  requestId?: string;
}

export function extractQualityFromTitle(rawTitle?: string, fallbackQuality?: string): string | undefined {
  return normalizeQualityLabel(rawTitle, fallbackQuality);
}

export function formatBytes(bytes: number, decimals = 1): string {
  if (!bytes || bytes === 0) return '0 Octet';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Octets', 'Ko', 'Mo', 'Go', 'To'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

export function formatSpeed(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return '0 Ko/s';
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatSecondsToETA(seconds: number): string {
  if (!seconds || seconds <= 0 || !isFinite(seconds) || seconds > 86400 * 7) return '--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const h = Math.floor(m / 60);
  const remainingM = m % 60;

  if (h > 0) return `${h}h ${remainingM}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function parseTimeStringToSeconds(timeStr?: string): number {
  if (!timeStr) return 0;
  const parts = timeStr.trim().split(':');
  if (parts.length === 3) {
    const hours = parseInt(parts[0], 10) || 0;
    const mins = parseInt(parts[1], 10) || 0;
    const secs = parseInt(parts[2], 10) || 0;
    return hours * 3600 + mins * 60 + secs;
  }
  if (parts.length === 2) {
    const mins = parseInt(parts[0], 10) || 0;
    const secs = parseInt(parts[1], 10) || 0;
    return mins * 60 + secs;
  }
  return 0;
}

/**
 * Nettoie le nom brut d'un torrent/release et extrait le titre propre de la série/film et le numéro d'épisode
 */
export function formatCleanMediaInfo(item: LiveDownloadItem): {
  cleanTitle: string;
  subTitle?: string;
  isTv: boolean;
} {
  // 1. Si c'est un item Sonarr/Radarr structuré
  if (item.seriesTitle) {
    let cleanSeries = item.seriesTitle.trim();
    cleanSeries = cleanSeries.replace(/\s*\((?:s\d{1,2}[e._-]?\d{1,2}|\d{1,2}x\d{1,2}|saison\s*\d+|season\s*\d+)\)\s*$/i, '').trim();
    const sStr = item.seasonNumber ? `S${String(item.seasonNumber).padStart(2, '0')}` : '';
    const eStr = item.episodeNumber ? `E${String(item.episodeNumber).padStart(2, '0')}` : '';
    const epCode = sStr && eStr ? `${sStr} | ${eStr}` : (sStr || eStr);
    return {
      cleanTitle: cleanSeries,
      subTitle: epCode || undefined,
      isTv: true
    };
  }

  if (item.movieTitle) {
    return {
      cleanTitle: item.movieTitle,
      isTv: false
    };
  }

  const raw = (item.title || item.releaseTitle || '').trim();

  // Détection épisode S01E02, S1E2, S01.E02 ou 1x02
  const tvMatch = raw.match(/s(\d{1,2})[e._-]?(\d{1,2})/i) || raw.match(/(\d{1,2})x(\d{1,2})/i);
  let isTv = item.mediaType === 'tv' || Boolean(tvMatch);
  let seasonNumber = item.seasonNumber;
  let episodeNumber = item.episodeNumber;

  if (tvMatch && (!seasonNumber || !episodeNumber)) {
    seasonNumber = parseInt(tvMatch[1], 10);
    episodeNumber = parseInt(tvMatch[2], 10);
  }

  // Nettoyage du titre (enlever la qualité, codec, release group, etc.)
  let cleanName = raw;
  if (tvMatch && tvMatch.index !== undefined && tvMatch.index > 0) {
    cleanName = raw.substring(0, tvMatch.index);
  } else {
    // Chercher l'année (ex: 2026, 2024) ou premier tag de qualité (2160p, 1080p, MULTI, etc.)
    const tagMatch = raw.match(/(19\d\d|20\d\d|2160p|1080p|720p|4k|hdr|bluray|web-dl|webrip|h264|hevc|x264|x265|multi|vf\d*|vostfr)/i);
    if (tagMatch && tagMatch.index !== undefined && tagMatch.index > 2) {
      cleanName = raw.substring(0, tagMatch.index);
    }
  }

  // Remplacement des séparateurs
  cleanName = cleanName.replace(/[._]/g, ' ').trim();
  cleanName = cleanName.replace(/^[-–—\s]+|[-–—\s]+$/g, '').trim();
  // Les releases TV utilisent souvent "Titre.(2022).S01E01". Une coupe avant
  // l'épisode ne doit pas laisser "(2022)" ou une parenthèse orpheline à l'écran.
  cleanName = cleanName.replace(/\s*\((?:19|20)\d{2}\)\s*$/i, '').trim();
  cleanName = cleanName.replace(/[([{]+\s*$/g, '').trim();

  // Extension de fichier (.mkv, .mp4, etc.)
  cleanName = cleanName.replace(/\.(mkv|mp4|avi|iso)$/i, '').trim();

  if (!cleanName || cleanName.length < 2) {
    cleanName = raw;
  }

  // Capitalisation élégante des mots
  cleanName = cleanName.replace(/\b[a-z]/g, (char) => char.toUpperCase());

  let subTitle: string | undefined = undefined;
  if (isTv && (seasonNumber || episodeNumber)) {
    const sStr = seasonNumber ? `S${String(seasonNumber).padStart(2, '0')}` : 'S01';
    const eStr = episodeNumber ? `E${String(episodeNumber).padStart(2, '0')}` : '';
    subTitle = eStr ? `${sStr} | ${eStr}` : sStr;
  }

  return {
    cleanTitle: cleanName,
    subTitle,
    isTv
  };
}

export function matchShowDownload(
  item: LiveDownloadItem,
  tmdbId?: number | string,
  _tvdbId?: number | string,
  _showTitle?: string
): boolean {
  if (item.mediaType !== 'tv' || !tmdbId || !item.tmdbId) return false;
  return Number(item.tmdbId) === Number(tmdbId);
}

export function matchMovieDownload(
  item: LiveDownloadItem,
  tmdbId?: number | string,
  _movieTitle?: string
): boolean {
  if (item.mediaType !== 'movie') return false;
  if (tmdbId && item.tmdbId && Number(item.tmdbId) === Number(tmdbId)) return true;
  return false;
}

function parseQueueRecordStatus(rec: any): { status: string; statusText: string; errorMessage?: string } {
  const statusMsgs: string[] = [];
  if (Array.isArray(rec.statusMessages)) {
    for (const sm of rec.statusMessages) {
      if (Array.isArray(sm?.messages) && sm.messages.length > 0) {
        statusMsgs.push(...sm.messages.filter(Boolean));
      } else if (sm?.title && sm.title !== 'Downloading' && sm.title !== 'Queued') {
        statusMsgs.push(sm.title);
      }
    }
  }
  if (rec.errorMessage) statusMsgs.push(rec.errorMessage);

  const isTrackedError = rec.trackedDownloadStatus?.toLowerCase() === 'error';
  const isTrackedWarning = rec.trackedDownloadStatus?.toLowerCase() === 'warning';
  const isFailed = rec.status?.toLowerCase() === 'failed' || rec.status?.toLowerCase() === 'error';

  let errorMessage: string | undefined;
  if (statusMsgs.length > 0) {
    errorMessage = statusMsgs.join(' • ');
  } else if (isTrackedError || isFailed) {
    errorMessage = 'Erreur lors du téléchargement (espace disque ou client torrent)';
  } else if (isTrackedWarning) {
    errorMessage = 'Avertissement de téléchargement';
  }

  // Traductions des erreurs courantes en français
  if (errorMessage) {
    if (/disk is full|not enough free space|no space left|space left on device/i.test(errorMessage)) {
      errorMessage = 'Disque plein : espace de stockage insuffisant';
    } else if (/access denied|permission denied/i.test(errorMessage)) {
      errorMessage = 'Erreur d\'accès / permissions disque';
    } else if (/client unavailable|could not connect/i.test(errorMessage)) {
      errorMessage = 'Client de téléchargement injoignable';
    }
  }

  const hasError = Boolean(errorMessage || isTrackedError || isFailed);
  const status = hasError ? 'error' : (isTrackedWarning ? 'warning' : (rec.status || 'downloading'));

  let statusText = rec.status === 'downloading' ? 'Téléchargement' : (rec.status || 'En cours');
  if (hasError) {
    statusText = 'Erreur';
  } else if (isTrackedWarning) {
    statusText = 'Attention';
  }

  return { status, statusText, errorMessage };
}

export interface LiveDownloadSourceState {
  configured: boolean;
  ok: boolean;
  checkedAt: number;
  error?: string;
}

export interface LiveDownloadSourceHealth {
  sonarr: LiveDownloadSourceState;
  radarr: LiveDownloadSourceState;
  qbittorrent: LiveDownloadSourceState;
}

const emptySourceHealth = (configured = false): LiveDownloadSourceState => ({
  configured,
  ok: false,
  checkedAt: Date.now()
});

let lastLiveDownloadSourceHealth: LiveDownloadSourceHealth = {
  sonarr: emptySourceHealth(false),
  radarr: emptySourceHealth(false),
  qbittorrent: emptySourceHealth(false)
};

export function getLastLiveDownloadSourceHealth(): LiveDownloadSourceHealth {
  return {
    sonarr: { ...lastLiveDownloadSourceHealth.sonarr },
    radarr: { ...lastLiveDownloadSourceHealth.radarr },
    qbittorrent: { ...lastLiveDownloadSourceHealth.qbittorrent }
  };
}

type LiveSourceName = keyof LiveDownloadSourceHealth;
interface LiveSourceRetryState { failures: number; retryAt: number }
const liveSourceRetries = new Map<string, LiveSourceRetryState>();

function liveSourceRetryKey(source: LiveSourceName, url?: string): string {
  return `${auth.currentUser?.uid || 'signed-out'}|${source}|${cleanUrl(url || '').toLowerCase()}`;
}

function sourceRetryDelay(source: LiveSourceName, url?: string): number {
  const state = liveSourceRetries.get(liveSourceRetryKey(source, url));
  return state ? Math.max(0, state.retryAt - Date.now()) : 0;
}

function recordSourceResult(source: LiveSourceName, url: string | undefined, ok: boolean) {
  const key = liveSourceRetryKey(source, url);
  if (ok) {
    liveSourceRetries.delete(key);
    return;
  }
  const previous = liveSourceRetries.get(key);
  const failures = Math.min(8, (previous?.failures || 0) + 1);
  const delay = nextDownloadSourceBackoffMs(failures);
  liveSourceRetries.set(key, { failures, retryAt: Date.now() + delay });
}

async function fetchAllArrQueuePages(
  base: string,
  apiKey: string,
  query: string
): Promise<any[]> {
  const pageSize = 100;
  const allRecords: any[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const res = await executeGet(
      `${base}/api/v3/queue?page=${page}&pageSize=${pageSize}&${query}`,
      { 'X-Api-Key': apiKey, Accept: 'application/json' }
    );
    if (Array.isArray(res)) return res;
    const records = Array.isArray(res?.records) ? res.records : [];
    allRecords.push(...records);
    const totalRecords = Number(res?.totalRecords ?? res?.total ?? 0);
    if (!shouldFetchNextArrQueuePage(records.length, totalRecords, allRecords.length, pageSize)) break;
  }
  return allRecords;
}

async function fetchQbitTorrentQueue(config: SonarrRadarrConfig): Promise<any> {
  const qbitBase = cleanUrl(config.qbittorrentUrl || '');
  const fetchInfo = async (forceRelogin = false): Promise<any> => {
    if (forceRelogin) invalidateQbitCache(qbitBase, config.qbittorrentUsername, false);
    let cookieHeader = '';
    if (config.qbittorrentUsername || config.qbittorrentPassword) {
      const loginRes = await loginQBittorrent(qbitBase, config.qbittorrentUsername, config.qbittorrentPassword);
      if (!loginRes.success) throw new Error(loginRes.message || 'Authentification qBittorrent impossible');
      cookieHeader = loginRes.cookie || '';
    }
    const headers: Record<string, string> = { Accept: 'application/json', Referer: qbitBase, Origin: qbitBase };
    if (cookieHeader) headers.Cookie = cookieHeader;
    return executeGet(`${qbitBase}/api/v2/torrents/info?filter=all&sort=added_on&reverse=true`, headers);
  };

  try {
    return await fetchInfo(false);
  } catch (firstError: any) {
    if (!isQbitAuthError(firstError) || !(config.qbittorrentUsername || config.qbittorrentPassword)) throw firstError;
    return fetchInfo(true);
  }
}

export async function fetchLiveDownloadsQueue(config: SonarrRadarrConfig): Promise<LiveDownloadItem[]> {
  const items: LiveDownloadItem[] = [];
  const sourceHealth: LiveDownloadSourceHealth = {
    sonarr: emptySourceHealth(Boolean(config.sonarrUrl && config.sonarrApiKey)),
    radarr: emptySourceHealth(Boolean(config.radarrUrl && config.radarrApiKey)),
    qbittorrent: emptySourceHealth(Boolean(config.qbittorrentUrl))
  };
  const arrTasks: Promise<void>[] = [];

  // 1. Sonarr Queue
  if (config.sonarrUrl && config.sonarrApiKey) {
    const retryDelay = sourceRetryDelay('sonarr', config.sonarrUrl);
    if (retryDelay > 0) {
      sourceHealth.sonarr = {
        configured: true,
        ok: false,
        checkedAt: Date.now(),
        error: `Nouvelle tentative Sonarr dans ${Math.ceil(retryDelay / 1000)} s`
      };
    } else {
      const sonarrBase = cleanUrl(config.sonarrUrl);
      arrTasks.push((async () => {
        try {
          const records = await fetchAllArrQueuePages(
            sonarrBase,
            config.sonarrApiKey!,
            'includeSeries=true&includeEpisode=true'
          );

          recordSourceResult('sonarr', config.sonarrUrl, true);
          sourceHealth.sonarr = { configured: true, ok: true, checkedAt: Date.now() };

          for (const rec of records) {
        const totalSize = rec.size || 0;
        const leftSize = rec.sizeleft || 0;
        const downloaded = Math.max(0, totalSize - leftSize);
        const progress = totalSize > 0 ? Math.min(100, Math.max(0, Math.round((downloaded / totalSize) * 100))) : (leftSize === 0 ? 100 : 0);

        const timeleftSeconds = parseTimeStringToSeconds(rec.timeleft);
        const timeleftStr = timeleftSeconds > 0 ? formatSecondsToETA(timeleftSeconds) : (rec.timeleft || '');

        const seriesTitle = rec.series?.title || rec.title || 'Série';
        const seasonNum = rec.seasonNumber ?? rec.episode?.seasonNumber ?? 1;
        const epNum = rec.episode?.episodeNumber ?? rec.episodeNumber;
        const epTitle = epNum ? `S${seasonNum}E${epNum}` : `Saison ${seasonNum}`;
        const epName = rec.episode?.title || undefined;

        const posterImg = rec.series?.images?.find((i: any) => i.coverType === 'poster');
        const posterUrl = posterImg?.remoteUrl || (posterImg?.url ? `${sonarrBase}${posterImg.url}` : undefined);
        const qualityName = extractQualityFromTitle(rec.title, rec.quality?.quality?.name);

        const statusInfo = parseQueueRecordStatus(rec);

            items.push({
          id: `sonarr_${rec.id}`,
          mediaType: 'tv',
          title: `${seriesTitle} ${epTitle}` ,
          seriesTitle: seriesTitle,
          episodeTitle: epName,
          quality: qualityName,
          posterPath: posterUrl,
          tmdbId: rec.series?.tmdbId,
          tvdbId: rec.series?.tvdbId,
          imdbId: rec.series?.imdbId,
          seasonNumber: seasonNum,
          episodeNumber: epNum,
          size: totalSize,
          sizeleft: leftSize,
          progress,
          timeleft: timeleftStr,
          timeleftSeconds,
          speedBytesPerSec: timeleftSeconds > 0 && leftSize > 0 ? Math.round(leftSize / timeleftSeconds) : 0,
          speedFormatted: timeleftSeconds > 0 && leftSize > 0 ? formatSpeed(Math.round(leftSize / timeleftSeconds)) : '',
          status: statusInfo.status,
          statusText: statusInfo.status === 'downloading' ? `Téléchargement ${progress}%` : statusInfo.statusText,
          errorMessage: statusInfo.errorMessage,
          downloadClient: rec.downloadClient || 'Sonarr',
          downloadId: normalizeDownloadClientId(rec.downloadId) || undefined,
          downloadIdAliases: normalizeDownloadClientId(rec.downloadId) ? [normalizeDownloadClientId(rec.downloadId)!] : undefined,
          releaseTitle: rec.title,
          transferPath: rec.outputPath || undefined,
          addedAt: rec.added ? Date.parse(rec.added) : undefined,
          isRestored: false
            });
          }
        } catch (e: any) {
          recordSourceResult('sonarr', config.sonarrUrl, false);
          sourceHealth.sonarr = { configured: true, ok: false, checkedAt: Date.now(), error: e?.message || 'Sonarr indisponible' };
          if (!e?.message?.includes('PWA Web')) {
            console.warn('[LiveQueue] Erreur Sonarr queue:', e);
          }
        }
      })());
    }
  }

  // 2. Radarr Queue
  if (config.radarrUrl && config.radarrApiKey) {
    const retryDelay = sourceRetryDelay('radarr', config.radarrUrl);
    if (retryDelay > 0) {
      sourceHealth.radarr = {
        configured: true,
        ok: false,
        checkedAt: Date.now(),
        error: `Nouvelle tentative Radarr dans ${Math.ceil(retryDelay / 1000)} s`
      };
    } else {
      const radarrBase = cleanUrl(config.radarrUrl);
      arrTasks.push((async () => {
        try {
          const records = await fetchAllArrQueuePages(
            radarrBase,
            config.radarrApiKey!,
            'includeMovie=true'
          );

          recordSourceResult('radarr', config.radarrUrl, true);
          sourceHealth.radarr = { configured: true, ok: true, checkedAt: Date.now() };

          for (const rec of records) {
        const totalSize = rec.size || 0;
        const leftSize = rec.sizeleft || 0;
        const downloaded = Math.max(0, totalSize - leftSize);
        const progress = totalSize > 0 ? Math.min(100, Math.max(0, Math.round((downloaded / totalSize) * 100))) : (leftSize === 0 ? 100 : 0);

        const timeleftSeconds = parseTimeStringToSeconds(rec.timeleft);
        const timeleftStr = timeleftSeconds > 0 ? formatSecondsToETA(timeleftSeconds) : (rec.timeleft || '');

        const movieTitle = rec.movie?.title || rec.title || 'Film';
        const posterImg = rec.movie?.images?.find((i: any) => i.coverType === 'poster');
        const posterUrl = posterImg?.remoteUrl || (posterImg?.url ? `${radarrBase}${posterImg.url}` : undefined);
        const qualityName = extractQualityFromTitle(rec.title, rec.quality?.quality?.name);
        const statusInfo = parseQueueRecordStatus(rec);

            items.push({
          id: `radarr_${rec.id}`,
          mediaType: 'movie',
          title: movieTitle,
          movieTitle: movieTitle,
          quality: qualityName,
          posterPath: posterUrl,
          tmdbId: rec.movie?.tmdbId,
          imdbId: rec.movie?.imdbId,
          size: totalSize,
          sizeleft: leftSize,
          progress,
          timeleft: timeleftStr,
          timeleftSeconds,
          speedBytesPerSec: timeleftSeconds > 0 && leftSize > 0 ? Math.round(leftSize / timeleftSeconds) : 0,
          speedFormatted: timeleftSeconds > 0 && leftSize > 0 ? formatSpeed(Math.round(leftSize / timeleftSeconds)) : '',
          status: statusInfo.status,
          statusText: statusInfo.status === 'downloading' ? `Téléchargement ${progress}%` : statusInfo.statusText,
          errorMessage: statusInfo.errorMessage,
          downloadClient: rec.downloadClient || 'Radarr',
          downloadId: normalizeDownloadClientId(rec.downloadId) || undefined,
          downloadIdAliases: normalizeDownloadClientId(rec.downloadId) ? [normalizeDownloadClientId(rec.downloadId)!] : undefined,
          releaseTitle: rec.title,
          transferPath: rec.outputPath || undefined,
          addedAt: rec.added ? Date.parse(rec.added) : undefined,
          isRestored: false
            });
          }
        } catch (e: any) {
          recordSourceResult('radarr', config.radarrUrl, false);
          sourceHealth.radarr = { configured: true, ok: false, checkedAt: Date.now(), error: e?.message || 'Radarr indisponible' };
          if (!e?.message?.includes('PWA Web')) {
            console.warn('[LiveQueue] Erreur Radarr queue:', e);
          }
        }
      })());
    }
  }

  const qbitRetryDelay = config.qbittorrentUrl
    ? sourceRetryDelay('qbittorrent', config.qbittorrentUrl)
    : 0;
  // La collecte réseau qBittorrent démarre en même temps que les deux *Arr. Sa
  // fusion attend ensuite leurs métadonnées techniques (TMDB/TVDB/hash).
  const qbitQueuePromise = config.qbittorrentUrl && qbitRetryDelay === 0
    ? fetchQbitTorrentQueue(config).then(
        value => ({ value, error: null as unknown }),
        error => ({ value: null, error })
      )
    : null;

  await Promise.all(arrTasks);

  // 3. qBittorrent direct
  if (config.qbittorrentUrl) {
    const qbitBase = cleanUrl(config.qbittorrentUrl);
    if (qbitRetryDelay > 0) {
      sourceHealth.qbittorrent = {
        configured: true,
        ok: false,
        checkedAt: Date.now(),
        error: `Nouvelle tentative qBittorrent dans ${Math.ceil(qbitRetryDelay / 1000)} s`
      };
    } else try {
      const qbitResult = await qbitQueuePromise;
      if (qbitResult?.error) throw qbitResult.error;
      const res: any = qbitResult?.value;

      recordSourceResult('qbittorrent', config.qbittorrentUrl, true);
      sourceHealth.qbittorrent = { configured: true, ok: true, checkedAt: Date.now() };
      if (Array.isArray(res)) {
        for (const t of res) {
          const isDone = Boolean(
            (typeof t.progress === 'number' && t.progress >= 0.995) ||
            ['uploading', 'stalledUP', 'completed', 'pausedUP', 'checkingUP', 'forcedUP'].includes(t.state)
          );
          const rawProgress = isDone
            ? 100
            : (typeof t.progress === 'number'
                ? Math.min(99.9, Math.max(0, Math.round(t.progress * 1000) / 10))
                : 0);
          const speed = t.dlspeed || 0;
          const etaSec = t.eta || 0;
          const isTv = t.category === 'tv' || /s\d{1,2}e\d{1,2}/i.test(t.name);
          const qbitDownloadId = normalizeDownloadClientId(t.hash);
          const qbitDownloadIdAliases = Array.from(new Set([
            normalizeDownloadClientId(t.hash),
            normalizeDownloadClientId(t.infohash_v1),
            normalizeDownloadClientId(t.infohash_v2),
            normalizeDownloadClientId(t.magnet_uri)
          ].filter(Boolean) as string[]));

          const isQbitError = t.state === 'error' || t.state === 'missingFiles';
          const qbitErrorMsg = isQbitError ? 'Erreur de téléchargement (espace disque insuffisant ou fichier manquant)' : undefined;
          const qbitStatus = isQbitError
            ? 'error'
            : (isDone ? 'completed' : (t.state === 'stalledDL' ? 'warning' : (t.state === 'pausedDL' ? 'paused' : 'downloading')));
          const qbitStatusText = isQbitError
            ? 'Erreur'
            : (isDone
                ? 'Téléchargement terminé 🍿'
                : (t.state === 'stalledDL'
                    ? 'En attente de sources'
                    : (t.state === 'pausedDL' ? `Téléchargement en pause • ${rawProgress}%` : `Téléchargement ${rawProgress}%`)));

          const normTName = (t.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          const qbitProbe: LiveDownloadItem = {
            id: `qbit_${t.hash || t.name}`,
            downloadId: qbitDownloadId || undefined,
            downloadIdAliases: qbitDownloadIdAliases,
            mediaType: isTv ? 'tv' : 'movie',
            title: t.name,
            releaseTitle: t.name,
            size: Number(t.size || 0),
            sizeleft: 0,
            progress: rawProgress,
            status: qbitStatus,
            statusText: qbitStatusText,
            transferPath: t.content_path || t.save_path || undefined,
            addedAt: Number(t.added_on) > 0 ? Number(t.added_on) * 1000 : undefined,
            isRestored: false
          };

          const exactIndexes: number[] = [];
          items.forEach((it, index) => {
            if (qbitDownloadId && samePhysicalDownload(it, qbitProbe)) {
              exactIndexes.push(index);
              return;
            }
            if (sameTransferPath(it, qbitProbe)) {
              exactIndexes.push(index);
              return;
            }
          });

          const matchingIndexes = exactIndexes;
          const metadataScore = (it: LiveDownloadItem) =>
            (it.posterPath ? 8 : 0)
            + (it.tmdbId ? 8 : 0)
            + (it.tvdbId ? 4 : 0)
            + (it.movieTitle || it.seriesTitle ? 4 : 0)
            + (it.imdbId ? 2 : 0);
          const primaryIndex = matchingIndexes.length > 0
            ? [...matchingIndexes].sort((a, b) => metadataScore(items[b]) - metadataScore(items[a]))[0]
            : -1;
          const existing = primaryIndex >= 0 ? items[primaryIndex] : undefined;

          if (existing && matchingIndexes.length > 1) {
            for (const duplicateIndex of [...matchingIndexes].sort((a, b) => b - a)) {
              if (duplicateIndex === primaryIndex) continue;
              const duplicate = items[duplicateIndex];
              if (!existing.posterPath && duplicate.posterPath) existing.posterPath = duplicate.posterPath;
              if (!existing.backdropPath && duplicate.backdropPath) existing.backdropPath = duplicate.backdropPath;
              if (!existing.tmdbId && duplicate.tmdbId) existing.tmdbId = duplicate.tmdbId;
              if (!existing.tvdbId && duplicate.tvdbId) existing.tvdbId = duplicate.tvdbId;
              if (!existing.imdbId && duplicate.imdbId) existing.imdbId = duplicate.imdbId;
              if (!existing.movieTitle && duplicate.movieTitle) existing.movieTitle = duplicate.movieTitle;
              if (!existing.seriesTitle && duplicate.seriesTitle) existing.seriesTitle = duplicate.seriesTitle;
              if (!existing.quality && duplicate.quality) existing.quality = duplicate.quality;
              items.splice(duplicateIndex, 1);
            }
          }

          if (existing) {
            // Métadonnées *Arr (TMDB, titre, poster) + télémétrie qBittorrent (source de vérité live).
            existing.downloadIdAliases = mergeDownloadIdAliases(existing, qbitProbe);
            existing.transferPath = existing.transferPath || qbitProbe.transferPath;
            existing.addedAt = existing.addedAt || qbitProbe.addedAt;
            existing.isRestored = false;
            existing.quality = extractQualityFromTitle(t.name, existing.quality);
            // Le hash qBittorrent devient l'identifiant principal uniquement lorsque
            // *Arr n'en fournit pas un vrai. Les alias v1/v2 restent tous conservés.
            if (qbitDownloadId && (!existing.downloadId || !isStrongTorrentHash(existing.downloadId))) {
              existing.downloadId = qbitDownloadId;
            }
            if (Number(t.size) > 0) existing.size = Number(t.size);
            existing.progress = rawProgress;
            existing.sizeleft = isDone
              ? 0
              : Math.max(0, Math.round((Number(t.size) || existing.size || 0) * (1 - (Number(t.progress) || 0))));
            existing.speedBytesPerSec = isDone ? 0 : speed;
            existing.speedFormatted = !isDone && speed > 0 ? formatSpeed(speed) : '';

            const hasUsefulEta = !isDone && etaSec > 0 && etaSec < 86400 * 7;
            existing.timeleftSeconds = hasUsefulEta ? etaSec : 0;
            existing.timeleft = hasUsefulEta ? formatSecondsToETA(etaSec) : '';
            existing.downloadClient = 'qBittorrent';

            if (isQbitError) {
              existing.status = 'error';
              existing.statusText = 'Erreur';
              existing.errorMessage = qbitErrorMsg;
            } else if (existing.status === 'error' && existing.errorMessage) {
              // Ne pas masquer une erreur d'import *Arr par un torrent sain.
            } else {
              existing.status = qbitStatus;
              existing.statusText = qbitStatusText;
              existing.errorMessage = undefined;
            }
          } else {
            // Pour qBittorrent direct sans correspondance Radarr/Sonarr, n'ajouter les complétés que si non terminés ou récents
            if (!isDone || (rawProgress >= 100 && (t.completion_on > 0 && Date.now()/1000 - t.completion_on < 86400 * 2))) {
              items.push({
                id: `qbit_${t.hash || t.name}`,
                downloadId: qbitDownloadId || undefined,
                downloadIdAliases: qbitDownloadIdAliases,
                mediaType: isTv ? 'tv' : 'movie',
                title: t.name,
                quality: extractQualityFromTitle(t.name),
                size: t.size || 0,
                sizeleft: isDone ? 0 : Math.round((t.size || 0) * (1 - (t.progress || 0))),
                progress: rawProgress,
                timeleft: isDone ? '' : formatSecondsToETA(etaSec),
                timeleftSeconds: isDone ? 0 : etaSec,
                speedBytesPerSec: isDone ? 0 : speed,
                speedFormatted: isDone ? '' : formatSpeed(speed),
                status: qbitStatus,
                statusText: qbitStatusText,
                errorMessage: qbitErrorMsg,
                downloadClient: 'qBittorrent',
                releaseTitle: t.name,
                transferPath: t.content_path || t.save_path || undefined,
                addedAt: Number(t.added_on) > 0 ? Number(t.added_on) * 1000 : undefined,
                isRestored: false
              });
            }
          }
        }
      }
    } catch (e: any) {
      recordSourceResult('qbittorrent', config.qbittorrentUrl, false);
      sourceHealth.qbittorrent = { configured: true, ok: false, checkedAt: Date.now(), error: e?.message || 'qBittorrent indisponible' };
      if (!e?.message?.includes('PWA Web')) {
        console.warn('[LiveQueue] Erreur qBittorrent queue:', e);
      }
    }
  }

  lastLiveDownloadSourceHealth = sourceHealth;
  return items;
}

/**
 * Supprime ou annule un téléchargement de la file d'attente Sonarr / Radarr / qBittorrent
 */
export async function deleteLiveDownloadItem(
  item: LiveDownloadItem,
  config: SonarrRadarrConfig,
  removeFromClient: boolean = true
): Promise<{ success: boolean; message: string }> {
  try {
    // 1. Sonarr Queue Item
    if (item.id.startsWith('sonarr_') && config.sonarrUrl && config.sonarrApiKey) {
      const queueId = item.id.replace('sonarr_', '');
      const sonarrBase = cleanUrl(config.sonarrUrl);
      const url = `${sonarrBase}/api/v3/queue/${queueId}?removeFromClient=${removeFromClient}&blocklist=false`;
      await executeDelete(url, {
        'X-Api-Key': config.sonarrApiKey,
        'Accept': 'application/json'
      });
      return { success: true, message: 'Téléchargement retiré de Sonarr' };
    }

    // 2. Radarr Queue Item
    if (item.id.startsWith('radarr_') && config.radarrUrl && config.radarrApiKey) {
      const queueId = item.id.replace('radarr_', '');
      const radarrBase = cleanUrl(config.radarrUrl);
      const url = `${radarrBase}/api/v3/queue/${queueId}?removeFromClient=${removeFromClient}&blocklist=false`;
      await executeDelete(url, {
        'X-Api-Key': config.radarrApiKey,
        'Accept': 'application/json'
      });
      return { success: true, message: 'Téléchargement retiré de Radarr' };
    }

    // 3. qBittorrent Item
    if (item.id.startsWith('qbit_') && config.qbittorrentUrl) {
      const qbitBase = cleanUrl(config.qbittorrentUrl);
      const hash = item.id.replace('qbit_', '');
      let cookieHeader = '';
      if (config.qbittorrentUsername || config.qbittorrentPassword) {
        const loginRes = await loginQBittorrent(qbitBase, config.qbittorrentUsername, config.qbittorrentPassword);
        if (loginRes.success && loginRes.cookie) cookieHeader = loginRes.cookie;
      }
      const qHeaders: Record<string, string> = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': qbitBase,
        'Origin': qbitBase
      };
      if (cookieHeader) qHeaders['Cookie'] = cookieHeader;

      const url = `${qbitBase}/api/v2/torrents/delete`;
      await executePost(url, `hashes=${encodeURIComponent(hash)}&deleteFiles=false`, qHeaders);
      return { success: true, message: 'Torrent supprimé de qBittorrent' };
    }

    return { success: true, message: 'Élément retiré de la liste' };
  } catch (err: any) {
    console.warn('[deleteLiveDownloadItem error]', err);
    return { success: false, message: err?.message || 'Erreur lors de la suppression' };
  }
}
