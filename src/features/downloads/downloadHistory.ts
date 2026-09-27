import {
  cleanUrl,
  executeGet,
  type LiveDownloadItem,
  type SonarrRadarrConfig
} from '../../services/sonarrRadarr';
import { auth } from '../../lib/firebase';
import type {
  DownloadHistorySnapshot,
  DownloadHistorySource
} from './downloadHistoryPolicy.ts';

export {
  resolveDownloadHistoryOutcome,
  shouldResolveMissingDownloadFromHistory
} from './downloadHistoryPolicy.ts';
export type {
  DownloadHistoryOutcome,
  DownloadHistorySnapshot,
  DownloadHistorySource
} from './downloadHistoryPolicy.ts';

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
