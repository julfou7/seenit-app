import { App as CapacitorApp } from '@capacitor/app';
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

interface PlexRequestLifecycle {
  epoch: () => number;
  waitForForeground: () => Promise<void>;
  setActiveController: (controller: AbortController | null) => void;
  dispose: () => void;
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

function assertCurrentUser(uid: string): void {
  if (auth.currentUser?.uid !== uid) throw new Error('Compte SeenIt modifié pendant la synchronisation Plex');
}

function readErrorName(error: unknown): string {
  return error && typeof error === 'object' && 'name' in error ? String((error as { name?: unknown }).name || '') : '';
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return error && typeof error === 'object' && 'message' in error
    ? String((error as { message?: unknown }).message || '')
    : String(error ?? '');
}

function isAbortLikeError(error: unknown): boolean {
  return readErrorName(error) === 'AbortError'
    || /signal is aborted|aborted without reason|operation was aborted|request (?:was )?aborted/i.test(readErrorMessage(error));
}

function normalizeUnexpectedAbort(error: unknown): unknown {
  return isAbortLikeError(error)
    ? new Error('Network request failed: Plex request aborted before response')
    : error;
}

async function createRequestLifecycle(isNative: boolean): Promise<PlexRequestLifecycle | null> {
  const pageDocument = typeof document === 'undefined' ? null : document;
  if (!pageDocument && !isNative) return null;

  let active = !pageDocument || pageDocument.visibilityState !== 'hidden';
  let lifecycleEpoch = 0;
  let activeController: AbortController | null = null;
  const waiters = new Set<() => void>();

  const markForeground = () => {
    if (pageDocument?.visibilityState === 'hidden') return;
    active = true;
    for (const resolve of waiters) resolve();
    waiters.clear();
  };
  const markBackground = () => {
    if (!active) return;
    active = false;
    lifecycleEpoch += 1;
    activeController?.abort();
  };
  const onVisibilityChange = () => pageDocument?.visibilityState === 'hidden' ? markBackground() : markForeground();

  pageDocument?.addEventListener('visibilitychange', onVisibilityChange);
  const nativeHandle = isNative
    ? await CapacitorApp.addListener('appStateChange', ({ isActive }) => isActive ? markForeground() : markBackground())
    : null;

  return {
    epoch: () => lifecycleEpoch,
    waitForForeground: () => active && pageDocument?.visibilityState !== 'hidden'
      ? Promise.resolve()
      : new Promise<void>(resolve => waiters.add(resolve)),
    setActiveController: controller => { activeController = controller; },
    dispose: () => {
      activeController = null;
      pageDocument?.removeEventListener('visibilitychange', onVisibilityChange);
      if (nativeHandle) void nativeHandle.remove();
    },
  };
}

export async function fetchPlexHistoryData(uid: string, token: string, clientId: string, delta: boolean, since?: number): Promise<PlexHistoryPayload> {
  assertCurrentUser(uid);
  const retryAt = getPlexSyncRetryAt(uid);
  if (retryAt) throw new PlexSyncHttpError(429, retryAt);
  const isNative = Capacitor.isNativePlatform();
  const urls = resolveSeenItApiCandidates('/api/plex/history', isNative);
  const timeoutMs = delta ? 45_000 : 120_000;
  const payload = { clientId, delta, since };
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Plex-Token': token };
  const lifecycle = await createRequestLifecycle(isNative);

  const webRequest = async (url: string): Promise<PlexHistoryPayload> => {
    for (;;) {
      assertCurrentUser(uid);
      await lifecycle?.waitForForeground();
      const requestEpoch = lifecycle?.epoch() ?? 0;
      const controller = new AbortController();
      let timedOut = false;
      let lifecycleInterrupted = false;
      lifecycle?.setActiveController(controller);
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
      try {
        const response = await authenticatedFetch(url, { method: 'POST', headers, body: JSON.stringify(payload), signal: controller.signal }, uid);
        checkStatus(response.status, response.headers.get('retry-after'));
        return readPayload(await response.text());
      } catch (error) {
        lifecycleInterrupted = Boolean(lifecycle && lifecycle.epoch() !== requestEpoch);
        if (!lifecycleInterrupted) {
          if (timedOut && isAbortLikeError(error)) throw new Error(`Plex history request timeout after ${Math.round(timeoutMs / 1000)}s`);
          throw normalizeUnexpectedAbort(error);
        }
      } finally {
        clearTimeout(timer);
        lifecycle?.setActiveController(null);
      }

      if (lifecycleInterrupted) {
        appLogger.info('plex', 'Synchronisation Plex suspendue pendant la mise en arrière-plan ; reprise au retour.');
        await lifecycle?.waitForForeground();
      }
    }
  };

  const nativeRequest = async (url: string): Promise<PlexHistoryPayload> => {
    for (;;) {
      await lifecycle?.waitForForeground();
      const requestEpoch = lifecycle?.epoch() ?? 0;
      const authenticatedHeaders = await getAuthenticatedHeaders(headers);
      if (lifecycle && lifecycle.epoch() !== requestEpoch) {
        await lifecycle.waitForForeground();
        continue;
      }
      assertCurrentUser(uid);

      let response: Awaited<ReturnType<typeof CapacitorHttp.post>>;
      try {
        response = await CapacitorHttp.post({ url, headers: authenticatedHeaders, data: payload, connectTimeout: Math.min(timeoutMs, 15_000), readTimeout: timeoutMs });
      } catch (error) {
        if (lifecycle && lifecycle.epoch() !== requestEpoch) {
          appLogger.info('plex', 'Requête Plex native suspendue pendant la mise en arrière-plan ; nouvelle tentative au retour.');
          await lifecycle.waitForForeground();
          continue;
        }
        throw normalizeUnexpectedAbort(error);
      }

      if (lifecycle && lifecycle.epoch() !== requestEpoch) await lifecycle.waitForForeground();
      const retryAfter = Object.entries(response.headers || {}).find(([key]) => key.toLowerCase() === 'retry-after')?.[1];
      checkStatus(response.status, retryAfter);
      return readPayload(response.data);
    }
  };

  try {
    appLogger.info('plex', `Interrogation Plex (${isNative ? 'Android' : 'Web'}, ${delta ? 'delta' : 'complet'})`);
    const data = isNative ? await executeBackendAttempts({
      attempts: buildNativeBackendAttempts({ urls, nativeRequest, webViewRequest: webRequest }),
      delaysMs: [250, 500, 1000],
      onRetry: ({ nextTransport, attempt }) => appLogger.warn('plex', `Connexion Plex indisponible, tentative ${attempt + 1} via ${nextTransport}.`),
    }) : await webRequest(urls[0]);
    appLogger.success('plex', `Données Plex reçues : ${data.history?.length || 0} visionnage(s), ${data.watchlist?.length || 0} watchlist`);
    return data;
  } catch (error) {
    if (error instanceof PlexSyncHttpError && error.retryAt) rememberPlexSyncRetry(uid, error.retryAt);
    appLogger.warn('plex', error instanceof Error ? error.message : 'Échec du service de synchronisation Plex.');
    throw error;
  } finally {
    lifecycle?.dispose();
  }
}
