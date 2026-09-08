import { createHash } from 'node:crypto';
import type { Application, RequestHandler } from 'express';
import { extractPlexExternalIds } from '../features/plex/plexIdentity.ts';

export type PlexAvailabilityMediaType = 'movie' | 'tv';

export interface PlexAvailabilityResult {
  available: true;
  serverName: string;
  serverId?: string;
  title: string | null;
  originalTitle: string | null;
  year: number | null;
  ratingKey: string;
  plexUrl: string;
}

interface PlexConnection {
  uri?: string;
  local?: boolean;
  relay?: boolean;
}

export interface PlexServerResource {
  name?: string;
  clientIdentifier?: string;
  accessToken?: string;
  provides?: string;
  connections?: PlexConnection[];
}

interface FindOptions {
  servers: PlexServerResource[];
  accountToken: string;
  tmdbId: number;
  mediaType: PlexAvailabilityMediaType;
  request?: typeof fetch;
  fastTimeoutMs?: number;
  inventoryTimeoutMs?: number;
  inventoryBudgetMs?: number;
  inventoryPageSize?: number;
  maxInventoryPages?: number;
}

interface RegisterDependencies {
  authenticate: RequestHandler;
  fetch?: typeof fetch;
  now?: () => number;
}

const RESOURCE_CACHE_TTL_MS = 5 * 60_000;
const RESOURCE_CACHE_MAX = 100;
const resourceCache = new Map<string, { servers: PlexServerResource[]; timestamp: number }>();

function extractItems(data: any): any[] {
  if (!data) return [];
  if (Array.isArray(data?.MediaContainer?.Metadata)) return data.MediaContainer.Metadata;
  if (Array.isArray(data?.Metadata)) return data.Metadata;
  const hubs = Array.isArray(data?.MediaContainer?.Hub) ? data.MediaContainer.Hub : [];
  return hubs.flatMap((hub: any) => Array.isArray(hub?.Metadata) ? hub.Metadata : []);
}

function isExactTmdbMatch(item: any, tmdbId: number, mediaType: PlexAvailabilityMediaType): boolean {
  if (!item) return false;
  const type = String(item.type || '').toLowerCase();
  if (['episode', 'season', 'track'].includes(type)) return false;
  if (mediaType === 'movie' && type && type !== 'movie') return false;
  if (mediaType === 'tv' && type && type !== 'show' && type !== 'series') return false;
  return Number(extractPlexExternalIds(item).tmdbId) === tmdbId;
}

function formatResult(server: PlexServerResource, item: any): PlexAvailabilityResult | null {
  const ratingKey = String(item?.ratingKey || '').trim();
  if (!ratingKey) return null;
  const serverId = typeof server.clientIdentifier === 'string' ? server.clientIdentifier : undefined;
  return {
    available: true,
    serverName: server.name || 'Serveur Plex',
    serverId,
    title: item.title || null,
    originalTitle: item.originalTitle || null,
    year: Number.isFinite(Number(item.year)) ? Number(item.year) : null,
    ratingKey,
    plexUrl: serverId
      ? `https://app.plex.tv/desktop/#!/server/${serverId}/details?key=${encodeURIComponent(`/library/metadata/${ratingKey}`)}`
      : 'https://app.plex.tv/desktop'
  };
}

function rankConnections(connections: PlexConnection[]): PlexConnection[] {
  const sorted = [...connections].sort((left, right) => {
    const leftRemoteHttps = !left.local && String(left.uri || '').startsWith('https://');
    const rightRemoteHttps = !right.local && String(right.uri || '').startsWith('https://');
    if (leftRemoteHttps !== rightRemoteHttps) return leftRemoteHttps ? -1 : 1;
    if (!!left.relay !== !!right.relay) return left.relay ? -1 : 1;
    if (!!left.local !== !!right.local) return left.local ? 1 : -1;
    return 0;
  });
  const hasRemote = sorted.some(connection => !connection.local || connection.relay);
  return (hasRemote ? sorted.filter(connection => !connection.local || connection.relay) : sorted)
    .filter(connection => typeof connection.uri === 'string' && connection.uri.length > 0)
    .slice(0, 3);
}

async function fetchPlexJson(
  request: typeof fetch,
  url: string,
  token: string,
  timeoutMs: number,
  outerSignal?: AbortSignal
): Promise<any | null> {
  if (timeoutMs <= 0 || outerSignal?.aborted) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  outerSignal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await request(url, {
      headers: { Accept: 'application/json', 'X-Plex-Token': token },
      signal: controller.signal
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener('abort', abort);
  }
}

async function queryConnection(options: {
  server: PlexServerResource;
  uri: string;
  serverToken: string;
  tmdbId: number;
  mediaType: PlexAvailabilityMediaType;
  request: typeof fetch;
  outerSignal: AbortSignal;
  fastTimeoutMs: number;
  inventoryTimeoutMs: number;
  inventoryBudgetMs: number;
  inventoryPageSize: number;
  maxInventoryPages: number;
}): Promise<PlexAvailabilityResult | null> {
  const {
    server, uri, serverToken, tmdbId, mediaType, request, outerSignal,
    fastTimeoutMs, inventoryTimeoutMs, inventoryBudgetMs, inventoryPageSize, maxInventoryPages
  } = options;
  const baseUri = uri.replace(/\/+$/, '');
  const exactGuid = `tmdb://${tmdbId}`;
  const fastEndpoints = [
    `${baseUri}/library/all?guid=${encodeURIComponent(exactGuid)}&includeGuids=1`,
    `${baseUri}/hubs/search?query=${encodeURIComponent(exactGuid)}&limit=5&includeGuids=1`,
    `${baseUri}/library/all?guid=${encodeURIComponent(`com.plexapp.agents.themoviedb://${tmdbId}`)}&includeGuids=1`
  ];

  const fastPayloads = await Promise.all(fastEndpoints.map(endpoint =>
    fetchPlexJson(request, endpoint, serverToken, fastTimeoutMs, outerSignal)
  ));
  for (const payload of fastPayloads) {
    for (const item of extractItems(payload)) {
      if (!isExactTmdbMatch(item, tmdbId, mediaType)) continue;
      const result = formatResult(server, item);
      if (result) return result;
    }
  }

  if (outerSignal.aborted) return null;
  const deadline = Date.now() + inventoryBudgetMs;
  const remainingTimeout = () => Math.max(0, Math.min(inventoryTimeoutMs, deadline - Date.now()));
  const sectionsPayload = await fetchPlexJson(
    request,
    `${baseUri}/library/sections`,
    serverToken,
    remainingTimeout(),
    outerSignal
  );
  const sections = Array.isArray(sectionsPayload?.MediaContainer?.Directory)
    ? sectionsPayload.MediaContainer.Directory
    : [];
  const expectedSectionType = mediaType === 'movie' ? 'movie' : 'show';

  for (const section of sections) {
    if (outerSignal.aborted || Date.now() >= deadline) return null;
    if (String(section?.type || '').toLowerCase() !== expectedSectionType || !section?.key) continue;

    for (let page = 0; page < maxInventoryPages; page++) {
      if (outerSignal.aborted || Date.now() >= deadline) return null;
      const start = page * inventoryPageSize;
      const endpoint = new URL(`${baseUri}/library/sections/${encodeURIComponent(String(section.key))}/all`);
      endpoint.searchParams.set('includeGuids', '1');
      endpoint.searchParams.set('X-Plex-Container-Start', String(start));
      endpoint.searchParams.set('X-Plex-Container-Size', String(inventoryPageSize));

      const payload = await fetchPlexJson(request, endpoint.toString(), serverToken, remainingTimeout(), outerSignal);
      if (!payload) break;
      const items = extractItems(payload);
      for (const item of items) {
        if (!isExactTmdbMatch(item, tmdbId, mediaType)) continue;
        const result = formatResult(server, item);
        if (result) return result;
      }

      const totalSize = Number(payload?.MediaContainer?.totalSize ?? payload?.MediaContainer?.size);
      if (items.length < inventoryPageSize || (Number.isFinite(totalSize) && start + items.length >= totalSize)) break;
    }
  }

  return null;
}

async function queryServer(
  server: PlexServerResource,
  options: Omit<FindOptions, 'servers'>,
  outerSignal: AbortSignal
): Promise<PlexAvailabilityResult | null> {
  const request = options.request || fetch;
  const serverToken = server.accessToken || options.accountToken;
  for (const connection of rankConnections(server.connections || [])) {
    if (outerSignal.aborted) return null;
    const result = await queryConnection({
      server,
      uri: String(connection.uri),
      serverToken,
      tmdbId: options.tmdbId,
      mediaType: options.mediaType,
      request,
      outerSignal,
      fastTimeoutMs: options.fastTimeoutMs ?? 1000,
      inventoryTimeoutMs: options.inventoryTimeoutMs ?? 1100,
      inventoryBudgetMs: options.inventoryBudgetMs ?? 4700,
      inventoryPageSize: options.inventoryPageSize ?? 1000,
      maxInventoryPages: options.maxInventoryPages ?? 8
    });
    if (result) return result;
  }
  return null;
}

export async function findPlexAvailabilityOnServers(options: FindOptions): Promise<PlexAvailabilityResult | null> {
  if (options.servers.length === 0) return null;
  const controller = new AbortController();
  try {
    const attempts = options.servers.map(server => queryServer(server, options, controller.signal).then(result => {
      if (!result) throw new Error('PLEX_AVAILABILITY_MISS');
      return result;
    }));
    const found = await Promise.any(attempts);
    controller.abort();
    return found;
  } catch {
    return null;
  } finally {
    controller.abort();
  }
}

function pruneResourceCache(now: number): void {
  for (const [key, value] of resourceCache) {
    if (now - value.timestamp >= RESOURCE_CACHE_TTL_MS) resourceCache.delete(key);
  }
  while (resourceCache.size > RESOURCE_CACHE_MAX) resourceCache.delete(resourceCache.keys().next().value!);
}

export async function getPlexServers(
  request: typeof fetch,
  token: string,
  clientId: string,
  uid: string,
  now: () => number,
  forceRefresh = false
): Promise<PlexServerResource[] | null> {
  const cacheKey = `${uid}:${createHash('sha256').update(token).digest('hex')}`;
  const timestamp = now();
  pruneResourceCache(timestamp);
  const cached = resourceCache.get(cacheKey);
  if (!forceRefresh && cached && timestamp - cached.timestamp < RESOURCE_CACHE_TTL_MS) return cached.servers;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1400);
  try {
    const response = await request('https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1', {
      headers: {
        Accept: 'application/json',
        'X-Plex-Token': token,
        'X-Plex-Client-Identifier': clientId
      },
      signal: controller.signal
    });
    if (!response.ok) return cached?.servers || null;
    const resources = await response.json();
    if (!Array.isArray(resources)) return cached?.servers || null;
    const servers = resources.filter((resource: PlexServerResource) => String(resource?.provides || '').includes('server'));
    resourceCache.set(cacheKey, { servers, timestamp: now() });
    pruneResourceCache(now());
    return servers;
  } catch {
    return cached?.servers || null;
  } finally {
    clearTimeout(timer);
  }
}

export function registerPlexAvailabilityRoute(app: Application, dependencies: RegisterDependencies): void {
  const request = dependencies.fetch || fetch;
  const now = dependencies.now || Date.now;

  app.post('/api/plex/availability', dependencies.authenticate, async (req: any, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const token = typeof req.headers['x-plex-token'] === 'string' ? req.headers['x-plex-token'].trim() : '';
    const tmdbId = Number(req.body?.tmdbId);
    const mediaType: PlexAvailabilityMediaType = req.body?.mediaType === 'tv' ? 'tv' : 'movie';
    const clientId = typeof req.body?.clientId === 'string' && req.body.clientId.trim()
      ? req.body.clientId.trim()
      : 'tv-time-ai-studio';
    const uid = String(req.user?.uid || 'anonymous');
    const refreshServers = req.body?.refreshServers === true;

    if (!token || !Number.isInteger(tmdbId) || tmdbId <= 0) {
      return res.json({ available: false });
    }

    const servers = await getPlexServers(request, token, clientId, uid, now, refreshServers);
    if (servers === null) {
      return res.status(502).json({ error: 'Plex est momentanément indisponible.' });
    }
    if (servers.length === 0) return res.json({ available: false });

    const found = await findPlexAvailabilityOnServers({
      servers,
      accountToken: token,
      tmdbId,
      mediaType,
      request
    });

    if (found) {
      console.log(`[Plex Availability] TMDB exact ${mediaType}:${tmdbId} trouvé sur « ${found.serverName} »`);
      return res.json(found);
    }
    return res.json({ available: false });
  });
}
