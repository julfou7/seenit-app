import { normalizeDownloadClientId } from './downloadIdentity.ts';
import { buildTrackedSeasonPackStorageKey } from './downloadUserScope.ts';

export interface TrackedSeasonPackFallback {
  downloadId: string;
  seriesId: number;
  seasonNumber: number;
  episodeNumber: number;
  episodeId?: number;
  title?: string;
  createdAt: number;
  cleanedUp?: boolean;
  cleanedAt?: number;
  lastCheckedAt?: number;
}

export interface ProcessSeasonPackCleanupResult {
  cleanedFallbacks: TrackedSeasonPackFallback[];
  removedQueueIds: number[];
}

export interface CleanupTransport {
  get: (url: string, headers?: Record<string, string>) => Promise<any>;
  del: (url: string, headers?: Record<string, string>) => Promise<any>;
  post: (url: string, body: any, headers?: Record<string, string>) => Promise<any>;
  loginQBit?: (url: string, username?: string, password?: string) => Promise<{ success: boolean; cookie?: string }>;
}

let defaultTransport: CleanupTransport | null = null;

export function setDefaultCleanupTransport(transport: CleanupTransport | null): void {
  defaultTransport = transport;
}

async function resolveTransport(customTransport?: CleanupTransport): Promise<CleanupTransport> {
  if (customTransport) return customTransport;
  if (defaultTransport) return defaultTransport;
  const sonarrModule = await import('../../services/sonarrRadarr');
  return {
    get: sonarrModule.executeGet,
    del: sonarrModule.executeDelete,
    post: sonarrModule.executePost,
    loginQBit: sonarrModule.loginQBittorrent
  };
}

export function cleanUrl(url: string): string {
  let u = (url || '').trim();
  if (!u) return '';
  if (!u.startsWith('http://') && !u.startsWith('https://')) {
    u = `http://${u}`;
  }
  return u.replace(/\/+$/, '');
}

const inMemoryTracked: Record<string, TrackedSeasonPackFallback[]> = {};
const MAX_CLEANED_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ACTIVE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const CHECK_THROTTLE_MS = 3_000;

export function pruneTrackedSeasonPacks(
  items: TrackedSeasonPackFallback[],
  now = Date.now()
): TrackedSeasonPackFallback[] {
  return items.filter(item => {
    if (item.cleanedUp) {
      const cleanedAt = item.cleanedAt || item.createdAt;
      return now - cleanedAt < MAX_CLEANED_TTL_MS;
    }
    return now - item.createdAt < MAX_ACTIVE_TTL_MS;
  });
}

export function getTrackedSeasonPacks(uid?: string | null): TrackedSeasonPackFallback[] {
  const key = buildTrackedSeasonPackStorageKey(uid);
  if (typeof localStorage === 'undefined') {
    return inMemoryTracked[key] || [];
  }
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return inMemoryTracked[key] || [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      inMemoryTracked[key] = parsed;
      return parsed;
    }
  } catch {}
  return inMemoryTracked[key] || [];
}

export function saveTrackedSeasonPacks(items: TrackedSeasonPackFallback[], uid?: string | null): void {
  const key = buildTrackedSeasonPackStorageKey(uid);
  inMemoryTracked[key] = items;
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {}
}

export function registerTrackedSeasonPack(
  item: Omit<TrackedSeasonPackFallback, 'createdAt'> & { createdAt?: number },
  uid?: string | null
): TrackedSeasonPackFallback {
  const normalizedDownloadId = normalizeDownloadClientId(item.downloadId);
  const current = getTrackedSeasonPacks(uid);
  const existing = current.find(p => normalizeDownloadClientId(p.downloadId) === normalizedDownloadId);

  const entry: TrackedSeasonPackFallback = {
    ...item,
    downloadId: normalizedDownloadId,
    createdAt: item.createdAt || Date.now(),
    cleanedUp: item.cleanedUp ?? false
  };

  const updated = existing
    ? current.map(p => normalizeDownloadClientId(p.downloadId) === normalizedDownloadId ? { ...p, ...entry } : p)
    : [...current, entry];

  saveTrackedSeasonPacks(pruneTrackedSeasonPacks(updated), uid);
  return entry;
}

export function markTrackedSeasonPackCleaned(downloadId: string, uid?: string | null): void {
  const normalized = normalizeDownloadClientId(downloadId);
  const current = getTrackedSeasonPacks(uid);
  const updated = current.map(item =>
    normalizeDownloadClientId(item.downloadId) === normalized
      ? { ...item, cleanedUp: true, cleanedAt: Date.now() }
      : item
  );
  saveTrackedSeasonPacks(updated, uid);
}

export function removeTrackedSeasonPack(downloadId: string, uid?: string | null): void {
  const normalized = normalizeDownloadClientId(downloadId);
  const current = getTrackedSeasonPacks(uid);
  const updated = current.filter(item => normalizeDownloadClientId(item.downloadId) !== normalized);
  saveTrackedSeasonPacks(updated, uid);
}

export function resetTrackedSeasonPacksInMemory(): void {
  for (const key of Object.keys(inMemoryTracked)) {
    delete inMemoryTracked[key];
  }
}

export async function checkEpisodeImportedInSonarr(
  sonarrUrl: string,
  sonarrApiKey: string,
  target: { seriesId: number; seasonNumber: number; episodeNumber: number; episodeId?: number },
  transport?: CleanupTransport
): Promise<boolean> {
  const base = cleanUrl(sonarrUrl);
  if (!base || !sonarrApiKey) return false;
  const headers = {
    'X-Api-Key': sonarrApiKey,
    'Accept': 'application/json'
  };

  const client = await resolveTransport(transport);

  if (target.episodeId && Number.isFinite(Number(target.episodeId))) {
    try {
      const ep = await client.get(`${base}/api/v3/episode/${target.episodeId}`, headers);
      if (ep && typeof ep.hasFile === 'boolean') {
        return ep.hasFile === true;
      }
    } catch {}
  }

  try {
    const episodes = await client.get(`${base}/api/v3/episode?seriesId=${target.seriesId}`, headers);
    if (Array.isArray(episodes)) {
      const match = episodes.find(
        (ep: any) => Number(ep.seasonNumber) === Number(target.seasonNumber)
           && Number(ep.episodeNumber) === Number(target.episodeNumber)
      );
      return match ? match.hasFile === true : false;
    }
  } catch {}

  return false;
}

export async function cleanupSeasonPackFromSonarrAndQbit(
  downloadId: string,
  config: {
    sonarrUrl?: string;
    sonarrApiKey?: string;
    qbittorrentUrl?: string;
    qbittorrentUsername?: string;
    qbittorrentPassword?: string;
  },
  transport?: CleanupTransport
): Promise<{ sonarrCleaned: boolean; qbitCleaned: boolean; removedQueueIds: number[] }> {
  const normalizedTargetId = normalizeDownloadClientId(downloadId);
  const removedQueueIds: number[] = [];
  let sonarrCleaned = false;
  let qbitCleaned = false;

  const client = await resolveTransport(transport);

  if (config.sonarrUrl && config.sonarrApiKey) {
    const sonarrBase = cleanUrl(config.sonarrUrl);
    const sonarrHeaders = {
      'X-Api-Key': config.sonarrApiKey,
      'Accept': 'application/json'
    };

    try {
      const res = await client.get(`${sonarrBase}/api/v3/queue?pageSize=100`, sonarrHeaders);
      const queue: any[] = Array.isArray(res) ? res : (Array.isArray(res?.records) ? res.records : []);
      const matching = queue.filter(
        rec => normalizeDownloadClientId(rec.downloadId) === normalizedTargetId
      );

      for (const rec of matching) {
        if (rec.id != null) {
          try {
            await client.del(
              `${sonarrBase}/api/v3/queue/${rec.id}?removeFromClient=true&blocklist=false`,
              sonarrHeaders
            );
            removedQueueIds.push(Number(rec.id));
            sonarrCleaned = true;
          } catch (delErr) {
            console.warn('[SeasonPackCleanup] Sonarr queue delete error', rec.id, delErr);
          }
        }
      }
    } catch (qErr) {
      console.warn('[SeasonPackCleanup] Sonarr queue fetch error', qErr);
    }
  }

  if (config.qbittorrentUrl) {
    const qbitBase = cleanUrl(config.qbittorrentUrl);
    let cookieHeader = '';
    try {
      if (client.loginQBit && (config.qbittorrentUsername || config.qbittorrentPassword)) {
        const loginRes = await client.loginQBit(qbitBase, config.qbittorrentUsername, config.qbittorrentPassword);
        if (loginRes.success && loginRes.cookie) cookieHeader = loginRes.cookie;
      }
      const qHeaders: Record<string, string> = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': qbitBase,
        'Origin': qbitBase
      };
      if (cookieHeader) qHeaders['Cookie'] = cookieHeader;

      await client.post(
        `${qbitBase}/api/v2/torrents/delete`,
        `hashes=${encodeURIComponent(normalizedTargetId)}&deleteFiles=false`,
        qHeaders
      );
      qbitCleaned = true;
    } catch (qbitErr) {
      console.warn('[SeasonPackCleanup] qBittorrent delete notice', qbitErr);
    }
  }

  return { sonarrCleaned, qbitCleaned, removedQueueIds };
}

export async function processTrackedSeasonPackFallbacks(
  config: {
    sonarrUrl?: string;
    sonarrApiKey?: string;
    qbittorrentUrl?: string;
    qbittorrentUsername?: string;
    qbittorrentPassword?: string;
  },
  uid?: string | null,
  transport?: CleanupTransport
): Promise<ProcessSeasonPackCleanupResult> {
  const result: ProcessSeasonPackCleanupResult = {
    cleanedFallbacks: [],
    removedQueueIds: []
  };

  if (!config.sonarrUrl || !config.sonarrApiKey) {
    return result;
  }

  const allTracked = getTrackedSeasonPacks(uid);
  const activeTracked = allTracked.filter(p => !p.cleanedUp);
  if (activeTracked.length === 0) {
    return result;
  }

  const now = Date.now();
  let updatedAny = false;

  for (const pack of activeTracked) {
    if (pack.lastCheckedAt && now - pack.lastCheckedAt < CHECK_THROTTLE_MS) {
      continue;
    }
    pack.lastCheckedAt = now;
    updatedAny = true;

    const isImported = await checkEpisodeImportedInSonarr(config.sonarrUrl, config.sonarrApiKey, {
      seriesId: pack.seriesId,
      seasonNumber: pack.seasonNumber,
      episodeNumber: pack.episodeNumber,
      episodeId: pack.episodeId
    }, transport);

    if (isImported) {
      const cleanupResult = await cleanupSeasonPackFromSonarrAndQbit(pack.downloadId, config, transport);
      pack.cleanedUp = true;
      pack.cleanedAt = Date.now();
      result.cleanedFallbacks.push(pack);
      result.removedQueueIds.push(...cleanupResult.removedQueueIds);
    }
  }

  if (updatedAny) {
    saveTrackedSeasonPacks(allTracked, uid);
  }

  return result;
}
