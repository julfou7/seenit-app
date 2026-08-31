import {
  cleanUrl,
  executeGet,
  type LiveDownloadItem,
  type SonarrRadarrConfig
} from '../../services/sonarrRadarr';
import {
  getPhysicalDownloadIds,
  normalizeDownloadClientId,
  normalizeDownloadRelease,
  normalizeQualityLabel
} from './downloadIdentity';
import { auth } from '../../lib/firebase';

export interface DownloadHistorySource {
  configured: boolean;
  ok: boolean;
  records: any[];
  error?: string;
}

export interface DownloadHistorySnapshot {
  checkedAt: number;
  radarr: DownloadHistorySource;
  sonarr: DownloadHistorySource;
}

export interface DownloadHistoryOutcome {
  state: 'completed' | 'failed' | 'unknown';
  quality?: string;
  date?: number;
  message?: string;
}

const HISTORY_CACHE_MS = 8_000;
let cachedAt = 0;
let cachedKey = '';
let cachedSnapshot: DownloadHistorySnapshot | null = null;

function credentialFingerprint(value?: string): string {
  let hash = 2166136261;
  for (const char of String(value || '')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function emptySource(configured: boolean): DownloadHistorySource {
  return { configured, ok: false, records: [] };
}

function getRecords(response: any): any[] {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.records)) return response.records;
  return [];
}

async function fetchSourceHistory(
  type: 'radarr' | 'sonarr',
  url: string | undefined,
  apiKey: string | undefined
): Promise<DownloadHistorySource> {
  const configured = Boolean(url && apiKey);
  if (!configured) return emptySource(false);

  const base = cleanUrl(url || '');
  const include = type === 'radarr'
    ? 'includeMovie=true'
    : 'includeSeries=true&includeEpisode=true';

  try {
    const response = await executeGet(
      `${base}/api/v3/history?page=1&pageSize=100&sortKey=date&sortDirection=descending&${include}`,
      { 'X-Api-Key': apiKey || '', 'Accept': 'application/json' }
    );
    return { configured: true, ok: true, records: getRecords(response) };
  } catch (error: any) {
    return {
      configured: true,
      ok: false,
      records: [],
      error: error?.message || 'Historique indisponible'
    };
  }
}

export async function fetchRecentDownloadHistory(config: SonarrRadarrConfig): Promise<DownloadHistorySnapshot> {
  const key = [
    auth.currentUser?.uid || 'signed-out',
    cleanUrl(config.radarrUrl || ''),
    credentialFingerprint(config.radarrApiKey),
    cleanUrl(config.sonarrUrl || ''),
    credentialFingerprint(config.sonarrApiKey)
  ].join('|');
  if (cachedSnapshot && cachedKey === key && Date.now() - cachedAt < HISTORY_CACHE_MS) {
    return cachedSnapshot;
  }

  const [radarr, sonarr] = await Promise.all([
    fetchSourceHistory('radarr', config.radarrUrl, config.radarrApiKey),
    fetchSourceHistory('sonarr', config.sonarrUrl, config.sonarrApiKey)
  ]);

  cachedAt = Date.now();
  cachedKey = key;
  cachedSnapshot = { checkedAt: cachedAt, radarr, sonarr };
  return cachedSnapshot;
}

function recordDate(record: any): number {
  const parsed = Date.parse(record?.date || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function eventKind(record: any): 'completed' | 'failed' | 'other' {
  const raw = record?.eventType;
  const numeric = Number(raw);
  if (numeric === 3) return 'completed';
  if (numeric === 4) return 'failed';

  const text = String(raw || '').toLowerCase();
  if (text.includes('downloadfolderimported') || text.includes('seriesfolderimported')) return 'completed';
  if (text.includes('downloadfailed')) return 'failed';
  return 'other';
}

function recordDownloadId(record: any): string | null {
  return normalizeDownloadClientId(
    record?.downloadId
    ?? record?.data?.downloadId
    ?? record?.data?.downloadClientId
  );
}

function canonicalMediaMatches(item: LiveDownloadItem, record: any): boolean {
  if (item.mediaType === 'movie') {
    const movie = record?.movie;
    if (item.tmdbId && movie?.tmdbId && Number(item.tmdbId) === Number(movie.tmdbId)) return true;
    if (item.imdbId && movie?.imdbId && String(item.imdbId).toLowerCase() === String(movie.imdbId).toLowerCase()) return true;
    return false;
  }

  const series = record?.series;
  if (item.tvdbId && series?.tvdbId && Number(item.tvdbId) === Number(series.tvdbId)) return true;
  if (item.tmdbId && series?.tmdbId && Number(item.tmdbId) === Number(series.tmdbId)) return true;
  if (item.imdbId && series?.imdbId && String(item.imdbId).toLowerCase() === String(series.imdbId).toLowerCase()) return true;

  return false;
}

function episodeScopeMatches(item: LiveDownloadItem, record: any): boolean {
  if (item.mediaType !== 'tv') return true;
  const episode = record?.episode;
  if (item.seasonNumber != null && episode?.seasonNumber != null
      && Number(item.seasonNumber) !== Number(episode.seasonNumber)) return false;
  if (item.episodeNumber != null && episode?.episodeNumber != null
      && Number(item.episodeNumber) !== Number(episode.episodeNumber)) return false;
  return true;
}

function releaseMatches(item: LiveDownloadItem, record: any): boolean {
  const expected = normalizeDownloadRelease(item.releaseTitle || item.title);
  const actual = normalizeDownloadRelease(
    record?.sourceTitle
    ?? record?.data?.sourceTitle
    ?? record?.data?.releaseTitle
  );
  if (!expected || !actual) return false;
  return expected === actual || expected.includes(actual) || actual.includes(expected);
}

function recordMatches(item: LiveDownloadItem, record: any): boolean {
  const itemIds = new Set(getPhysicalDownloadIds(item));
  const historyId = recordDownloadId(record);
  if (historyId && itemIds.has(historyId)) return true;

  if (!canonicalMediaMatches(item, record) || !episodeScopeMatches(item, record)) return false;

  // Sans downloadId commun, on reste dans la fenêtre temporelle du transfert afin
  // de ne jamais confondre un ancien import avec un nouveau re-téléchargement.
  const date = recordDate(record);
  const earliest = item.addedAt
    ? Number(item.addedAt) - 5 * 60_000
    : Date.now() - 24 * 60 * 60_000;
  if (date && date < earliest) return false;

  return releaseMatches(item, record) || !item.releaseTitle;
}

export function resolveDownloadHistoryOutcome(
  item: LiveDownloadItem,
  snapshot: DownloadHistorySnapshot
): DownloadHistoryOutcome {
  const source = item.mediaType === 'movie' ? snapshot.radarr : snapshot.sonarr;
  if (!source.configured || !source.ok) return { state: 'unknown' };

  const matching = source.records
    .filter(record => recordMatches(item, record))
    .map(record => ({ record, date: recordDate(record) }))
    .sort((a, b) => b.date - a.date);

  for (const { record, date } of matching) {
    const kind = eventKind(record);
    if (kind === 'completed') {
      return {
        state: 'completed',
        date,
        quality: normalizeQualityLabel(record?.sourceTitle, record?.quality?.quality?.name)
      };
    }
    if (kind === 'failed') {
      return {
        state: 'failed',
        date,
        message: record?.data?.message || record?.data?.reason || 'Le gestionnaire de téléchargement signale un échec.'
      };
    }
  }

  return { state: 'unknown' };
}
