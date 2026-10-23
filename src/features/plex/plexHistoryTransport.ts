import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { auth } from '../../lib/firebase';
import { authenticatedFetch, getAuthenticatedHeaders } from '../../lib/apiAuth';
import { buildNativeBackendAttempts, executeBackendAttempts } from '../../lib/nativeBackendRetry';
import { resolveSeenItApiCandidates } from '../../lib/seenitApi';
import { appLogger } from '../../store/logStore';
import { getPlexSyncRetryAt, rememberPlexSyncRetry, PlexSyncHttpError, plexRetryAfter } from './plexSyncRetry';
import type { PlexCollectionIntegrity } from './plexSyncIntegrity';
import type { PlexLibraryWatchState } from './plexLibraryWatchState';

interface PlexHistoryPayload {
  history?: Record<string, unknown>[];
  watchlist?: Record<string, unknown>[];
  libraryAvailability?: Array<{ tmdbId?: number; mediaType?: string; serverId?: string; serverName?: string; ratingKey?: string }>;
  libraryWatchStates?: PlexLibraryWatchState[];
  visitedSources?: string[];
  cursor?: number;
  integrity?: PlexCollectionIntegrity;
  stats?: Record<string, number | boolean>;
}

function checkStatus(status: number, retryAfter?: string | null): void {
  if (status >= 200 && status < 300) return;
  throw new PlexSyncHttpError(status, status === 429 || status === 503 && Boolean(retryAfter) ? plexRetryAfter(retryAfter) : 0);
}

function readPayload(raw: unknown): PlexHistoryPayload {
  let value: unknown = raw;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); }
    catch { throw new Error('Réponse du service Plex illisible. Réessayez plus tard.'); }
  }
  if (!value || typeof value !== 'object' || !('history' in value && Array.isArray(value.history) || 'watchlist' in value && Array.isArray(value.watchlist))) {
    throw new Error('Réponse du service Plex non reconnue. Réessayez plus tard.');
  }
  return value as PlexHistoryPayload;
}

export async function fetchPlexHistoryData(token: string, clientId: string, delta: boolean, since?: number): Promise<PlexHistoryPayload> {
  const uid = auth.currentUser?.uid;
  const retryAt = getPlexSyncRetryAt(uid);
  if (retryAt) throw new PlexSyncHttpError(429, retryAt);
  const isNative = Capacitor.isNativePlatform();
  const urls = resolveSeenItApiCandidates('/api/plex/history', isNative);
  const timeoutMs = delta ? 45_000 : 120_000;
  const payload = { clientId, delta, since };
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Plex-Token': token };
  const webRequest = async (url: string) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await authenticatedFetch(url, { method: 'POST', headers, body: JSON.stringify(payload), signal: controller.signal });
      checkStatus(response.status, response.headers.get('retry-after'));
      return readPayload(await response.text());
    } finally { clearTimeout(timer); }
  };
  try {
    appLogger.info('plex', `Interrogation Plex (${isNative ? 'Android' : 'Web'}, ${delta ? 'delta' : 'complet'})`);
    const data = isNative ? await executeBackendAttempts({
      attempts: buildNativeBackendAttempts({ urls,
        nativeRequest: async url => {
          const response = await CapacitorHttp.post({ url, headers: await getAuthenticatedHeaders(headers), data: payload, connectTimeout: Math.min(timeoutMs, 15_000), readTimeout: timeoutMs });
          const retryAfter = Object.entries(response.headers || {}).find(([key]) => key.toLowerCase() === 'retry-after')?.[1];
          checkStatus(response.status, retryAfter);
          return readPayload(response.data);
        },
        webViewRequest: webRequest,
      }), delaysMs: [250, 500, 1000],
      onRetry: ({ nextTransport, attempt }) => appLogger.warn('plex', `Connexion Plex indisponible, tentative ${attempt + 1} via ${nextTransport}.`),
    }) : await webRequest(urls[0]);
    appLogger.success('plex', `Données Plex reçues : ${data.history?.length || 0} visionnage(s), ${data.watchlist?.length || 0} watchlist`);
    return data;
  } catch (error) {
    if (error instanceof PlexSyncHttpError && error.retryAt) rememberPlexSyncRetry(uid, error.retryAt);
    appLogger.warn('plex', error instanceof Error ? error.message : 'Échec du service de synchronisation Plex.');
    throw error;
  }
}
