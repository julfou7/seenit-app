import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { auth } from '../../lib/firebase';
import { useDownloadConfigStore } from '../../store/downloadConfigStore';
import { useLiveDownloadStore } from '../../store/liveDownloadStore';
import {
  cleanUrl,
  extractQualityFromTitle,
  formatSecondsToETA,
  formatSpeed,
  type LiveDownloadItem
} from '../../services/sonarrRadarr';

const REALTIME_INTERVAL_MS = 1000;
const SESSION_TTL_MS = 9 * 60 * 1000;

const runtime = globalThis as typeof globalThis & {
  __seenitQbitRealtimeTimer?: ReturnType<typeof setInterval>;
  __seenitQbitRealtimeInFlight?: boolean;
};

let cachedCookie = '';
let sessionValidUntil = 0;
let lastBaseUrl = '';
let lastUsername = '';

function normalize(value?: string): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function getHeader(headers: Record<string, any> | undefined, name: string): string {
  if (!headers) return '';
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== wanted) continue;
    if (Array.isArray(value)) return String(value[0] || '');
    return String(value || '');
  }
  return '';
}

function extractCookie(headers: Record<string, any> | undefined): string {
  const raw = getHeader(headers, 'set-cookie');
  if (!raw) return '';
  const sidMatch = raw.match(/(?:^|[,;\s])SID=([^;,\s]+)/i);
  return sidMatch ? `SID=${sidMatch[1]}` : raw.split(';')[0].trim();
}

function resetSessionIfConfigChanged(base: string, username: string) {
  if (base === lastBaseUrl && username === lastUsername) return;
  lastBaseUrl = base;
  lastUsername = username;
  cachedCookie = '';
  sessionValidUntil = 0;
}

async function ensureNativeSession(base: string, username: string, password: string): Promise<string> {
  resetSessionIfConfigChanged(base, username);
  if (!username && !password) return '';
  if (Date.now() < sessionValidUntil) return cachedCookie;

  const form = `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
  const response = await CapacitorHttp.post({
    url: `${base}/api/v2/auth/login`,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: base,
      Origin: base
    },
    data: form,
    connectTimeout: 3000,
    readTimeout: 3000
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`qBittorrent login HTTP ${response.status}`);
  }

  const body = String(response.data ?? '').trim();
  if (body && body !== 'Ok.') {
    throw new Error('Authentification qBittorrent refusée');
  }

  cachedCookie = extractCookie(response.headers as Record<string, any> | undefined);
  sessionValidUntil = Date.now() + SESSION_TTL_MS;
  return cachedCookie;
}

async function fetchNativeTorrents(base: string, username: string, password: string): Promise<any[]> {
  const request = async (forceRelogin = false): Promise<any[]> => {
    if (forceRelogin) {
      cachedCookie = '';
      sessionValidUntil = 0;
    }

    const cookie = await ensureNativeSession(base, username, password);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Referer: base,
      Origin: base
    };
    if (cookie) headers.Cookie = cookie;

    const response = await CapacitorHttp.get({
      url: `${base}/api/v2/torrents/info?filter=all&sort=added_on&reverse=true&limit=100`,
      headers,
      connectTimeout: 3000,
      readTimeout: 3000
    });

    if ((response.status === 401 || response.status === 403) && !forceRelogin && (username || password)) {
      return request(true);
    }

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`qBittorrent HTTP ${response.status}`);
    }

    let data = response.data;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch { return []; }
    }
    return Array.isArray(data) ? data : [];
  };

  return request(false);
}

async function fetchWebTorrents(base: string, username: string, password: string): Promise<any[]> {
  if (username || password) {
    const form = new URLSearchParams({ username, password });
    const login = await fetch(`${base}/api/v2/auth/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(3000)
    });
    if (!login.ok) throw new Error(`qBittorrent login HTTP ${login.status}`);
  }

  const response = await fetch(`${base}/api/v2/torrents/info?filter=all&sort=added_on&reverse=true&limit=100`, {
    credentials: 'include',
    signal: AbortSignal.timeout(3000)
  });
  if (!response.ok) throw new Error(`qBittorrent HTTP ${response.status}`);
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

function formatProgress(progress: number): string {
  if (progress >= 100) return '100';
  if (progress < 10) return progress.toFixed(2);
  return progress.toFixed(1);
}

function mapTorrent(torrent: any): LiveDownloadItem {
  const size = Math.max(0, Number(torrent?.size || torrent?.total_size || 0));
  const rawFraction = Number(torrent?.progress);
  const fraction = Number.isFinite(rawFraction) ? Math.min(1, Math.max(0, rawFraction)) : 0;
  const doneStates = ['uploading', 'stalledup', 'completed', 'pausedup', 'checkingup', 'forcedup'];
  const state = String(torrent?.state || '').toLowerCase();
  const isDone = fraction >= 0.9995 || doneStates.includes(state);
  const progress = isDone ? 100 : Math.min(99.999, fraction * 100);

  const downloadedRaw = Number(torrent?.downloaded);
  const downloaded = Number.isFinite(downloadedRaw)
    ? Math.min(size || downloadedRaw, Math.max(0, downloadedRaw))
    : Math.round(size * fraction);
  const amountLeftRaw = Number(torrent?.amount_left);
  const sizeleft = isDone
    ? 0
    : Number.isFinite(amountLeftRaw) && amountLeftRaw >= 0
      ? amountLeftRaw
      : Math.max(0, size - downloaded);

  const speed = Math.max(0, Number(torrent?.dlspeed || 0));
  const etaRaw = Number(torrent?.eta || 0);
  const eta = Number.isFinite(etaRaw) && etaRaw > 0 && etaRaw < 86400 * 7 ? etaRaw : 0;
  const isError = state === 'error' || state === 'missingfiles';
  const isPaused = state === 'pauseddl';
  const isQueued = ['queueddl', 'metadl', 'checkingdl', 'stalleddl'].includes(state) && speed <= 0;
  const mediaType: 'tv' | 'movie' = torrent?.category === 'tv' || /s\d{1,2}(?:e\d{1,3})?/i.test(String(torrent?.name || ''))
    ? 'tv'
    : 'movie';

  let status = 'downloading';
  let statusText = `Téléchargement ${formatProgress(progress)}%`;
  let errorMessage: string | undefined;

  if (isDone) {
    status = 'completed';
    statusText = 'Téléchargement terminé 🍿';
  } else if (isError) {
    status = 'error';
    statusText = 'Erreur qBittorrent';
    errorMessage = 'qBittorrent signale une erreur sur ce torrent.';
  } else if (isPaused) {
    status = 'paused';
    statusText = `En pause • ${formatProgress(progress)}%`;
  } else if (isQueued) {
    status = 'queued';
    statusText = `En attente • ${formatProgress(progress)}%`;
  }

  return {
    id: `qbit_${torrent?.hash || torrent?.name}`,
    mediaType,
    title: String(torrent?.name || 'Téléchargement'),
    releaseTitle: String(torrent?.name || 'Téléchargement'),
    quality: extractQualityFromTitle(String(torrent?.name || '')),
    size,
    sizeleft,
    progress,
    timeleft: isDone || !eta ? '' : formatSecondsToETA(eta),
    timeleftSeconds: isDone ? 0 : eta,
    speedBytesPerSec: isDone ? 0 : speed,
    speedFormatted: isDone ? '' : formatSpeed(speed),
    status,
    statusText,
    errorMessage,
    downloadClient: 'qBittorrent',
    isOptimistic: false
  };
}

function mergeRealtimeSnapshots(snapshots: LiveDownloadItem[]) {
  if (!snapshots.length) return;

  const store = useLiveDownloadStore.getState();
  const current = store.downloads || [];
  const consumed = new Set<string>();

  const merged = current.map(item => {
    let snapshot = snapshots.find(candidate => candidate.id === item.id);

    if (!snapshot && item.isOptimistic) {
      const expected = normalize(item.releaseTitle || item.title);
      if (expected) {
        snapshot = snapshots.find(candidate => normalize(candidate.releaseTitle || candidate.title) === expected);
      }
    }

    if (!snapshot) return item;
    consumed.add(snapshot.id);

    return {
      ...item,
      ...snapshot,
      id: snapshot.id,
      tmdbId: item.tmdbId,
      tvdbId: item.tvdbId,
      imdbId: item.imdbId,
      posterPath: item.posterPath,
      backdropPath: item.backdropPath,
      seasonNumber: item.seasonNumber,
      episodeNumber: item.episodeNumber,
      seriesTitle: item.seriesTitle,
      movieTitle: item.movieTitle,
      quality: item.quality || snapshot.quality,
      isOptimistic: false
    } satisfies LiveDownloadItem;
  });

  for (const snapshot of snapshots) {
    if (consumed.has(snapshot.id)) continue;
    if (snapshot.status === 'completed' || snapshot.progress >= 100) continue;
    merged.unshift(snapshot);
  }

  const deduped = new Map<string, LiveDownloadItem>();
  for (const item of merged) deduped.set(item.id, item);

  useLiveDownloadStore.setState({
    downloads: Array.from(deduped.values()),
    lastUpdated: Date.now()
  });
}

async function tickRealtimeMonitor() {
  if (runtime.__seenitQbitRealtimeInFlight) return;
  if (!auth.currentUser) return;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;

  const config = useDownloadConfigStore.getState();
  const base = cleanUrl(config.qbittorrentUrl || '');
  if (!base) return;

  const downloads = useLiveDownloadStore.getState().downloads || [];
  const hasActiveRequest = downloads.some(item =>
    item.status !== 'completed' && item.status !== 'error' && Number(item.progress || 0) < 100
  );
  if (!hasActiveRequest) return;

  runtime.__seenitQbitRealtimeInFlight = true;
  try {
    const torrents = Capacitor.isNativePlatform()
      ? await fetchNativeTorrents(base, config.qbittorrentUsername || '', config.qbittorrentPassword || '')
      : await fetchWebTorrents(base, config.qbittorrentUsername || '', config.qbittorrentPassword || '');

    mergeRealtimeSnapshots(torrents.map(mapTorrent));
  } catch (error) {
    // Le moniteur temps réel est un accélérateur d'UX. Le polling principal reste le fallback.
    console.debug('[qBit Realtime] rafraîchissement indisponible:', error);
  } finally {
    runtime.__seenitQbitRealtimeInFlight = false;
  }
}

export function ensureQbitRealtimeMonitor() {
  if (typeof window === 'undefined') return;
  if (runtime.__seenitQbitRealtimeTimer) return;

  void tickRealtimeMonitor();
  runtime.__seenitQbitRealtimeTimer = setInterval(() => {
    void tickRealtimeMonitor();
  }, REALTIME_INTERVAL_MS);
}
