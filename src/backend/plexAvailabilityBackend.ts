import { createHash } from 'node:crypto';
import type { Application, RequestHandler } from 'express';
import { isStrictPlexIdentityMatch } from '../features/plex/plexIdentity.ts';

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
  imdbId?: string | null;
  tvdbId?: number | null;
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

interface StrongPlexIdentity {
  tmdbId: number;
  imdbId?: string | null;
  tvdbId?: number | null;
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

function normalizeImdbId(value: unknown): string | null {
  const imdbId = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^tt\d{5,12}$/.test(imdbId) ? imdbId : null;
}

function normalizeTvdbId(value: unknown): number | null {
  const tvdbId = Number(value);
  return Number.isInteger(tvdbId) && tvdbId > 0 ? tvdbId : null;
}

function buildStrongGuidCandidates(identity: StrongPlexIdentity): string[] {
  const candidates = [
    `tmdb://${identity.tmdbId}`,
    `com.plexapp.agents.themoviedb://${identity.tmdbId}`
  ];
  const imdbId = normalizeImdbId(identity.imdbId);
  if (imdbId) {
    candidates.push(`imdb://${imdbId}`, `com.plexapp.agents.imdb://${imdbId}`);
  }
  const tvdbId = normalizeTvdbId(identity.tvdbId);
  if (tvdbId) {
    candidates.push(`tvdb://${tvdbId}`, `thetvdb://${tvdbId}`, `com.plexapp.agents.thetvdb://${tvdbId}`);
  }
  return [...new Set(candidates)];
}

function isExactIdentityMatch(
  item: any,
  identity: StrongPlexIdentity,
  mediaType: PlexAvailabilityMediaType
): boolean {
  if (!item) return false;
  const type = String(item.type || '').toLowerCase();
  if (['episode', 'season', 'track'].includes(type)) return false;
  return isStrictPlexIdentityMatch(item, {
    tmdbId: identity.tmdbId,
    imdbId: normalizeImdbId(identity.imdbId),
    tvdbId: normalizeTvdbId(identity.tvdbId),
    mediaType
  });
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

async function findFastExactMatch(options: {
  server: PlexServerResource;
  baseUri: string;
  serverToken: string;
  identity: StrongPlexIdentity;
  mediaType: PlexAvailabilityMediaType;
  request: typeof fetch;
  outerSignal: AbortSignal;
  fastTimeoutMs: number;
}): Promise<PlexAvailabilityResult | null> {
  const { server, baseUri, serverToken, identity, mediaType, request, outerSignal, fastTimeoutMs } = options;
  const endpoints = new Set<string>();
  for (const guid of buildStrongGuidCandidates(identity)) {
    endpoints.add(`${baseUri}/library/all?guid=${encodeURIComponent(guid)}&includeGuids=1`);
    endpoints.add(`${baseUri}/hubs/search?query=${encodeURIComponent(guid)}&limit=5&includeGuids=1`);
  }

  const attempts = [...endpoints].map(async endpoint => {
    const payload = await fetchPlexJson(request, endpoint, serverToken, fastTimeoutMs, outerSignal);
    for (const item of extractItems(payload)) {
      if (!isExactIdentityMatch(item, identity, mediaType)) continue;
      const result = formatResult(server, item);
      if (result) return result;
    }
    throw new Error('PLEX_FAST_IDENTITY_MISS');
  });

  try {
    return await Promise.any(attempts);
  } catch {
    return null;
  }
}

async function queryConnection(options: {
  server: PlexServerResource;
  uri: string;
  serverToken: string;
  identity: StrongPlexIdentity;
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
    server, uri, serverToken, identity, mediaType, request, outerSignal,
    fastTimeoutMs, inventoryTimeoutMs, inventoryBudgetMs, inventoryPageSize, maxInventoryPages
  } = options;
  const baseUri = uri.replace(/\/+$/, '');

  const fastResult = await findFastExactMatch({
    server,
    baseUri,
    serverToken,
    identity,
    mediaType,
    request,
    outerSignal,
    fastTimeoutMs
  });
  if (fastResult) return fastResult;

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
        if (!isExactIdentityMatch(item, identity, mediaType)) continue;
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
  const connections = rankConnections(server.connections || []);
  if (connections.length === 0 || outerSignal.aborted) return null;

  // Les URL distantes/relay d'un même PMS sont des chemins alternatifs vers la même
  // bibliothèque. Les essayer en parallèle évite qu'une URL lente consomme tout le
  // budget avant d'atteindre la connexion fonctionnelle suivante.
  const connectionController = new AbortController();
  const abort = () => connectionController.abort();
  outerSignal.addEventListener('abort', abort, { once: true });
  const identity: StrongPlexIdentity = {
    tmdbId: options.tmdbId,
    imdbId: normalizeImdbId(options.imdbId),
    tvdbId: normalizeTvdbId(options.tvdbId)
  };

  try {
    const attempts = connections.map(connection => queryConnection({
      server,
      uri: String(connection.uri),
      serverToken,
      identity,
      mediaType: options.mediaType,
      request,
      outerSignal: connectionController.signal,
      fastTimeoutMs: options.fastTimeoutMs ?? 1000,
      inventoryTimeoutMs: options.inventoryTimeoutMs ?? 3500,
      inventoryBudgetMs: options.inventoryBudgetMs ?? 6000,
      inventoryPageSize: options.inventoryPageSize ?? 1000,
      maxInventoryPages: options.maxInventoryPages ?? 8
    }).then(result => {
      if (!result) throw new Error('PLEX_CONNECTION_MISS');
      return result;
    }));
    const found = await Promise.any(attempts);
    connectionController.abort();
    return found;
  } catch {
    return null;
  } finally {
    connectionController.abort();
    outerSignal.removeEventListener('abort', abort);
  }
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
    const imdbId = normalizeImdbId(req.body?.imdbId);
    const tvdbId = normalizeTvdbId(req.body?.tvdbId);
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
      imdbId,
      tvdbId,
      mediaType,
      request
    });

    if (found) {
      console.log(`[Plex Availability] Identité exacte ${mediaType}:${tmdbId} trouvée sur « ${found.serverName} »`);
      return res.json(found);
    }
    return res.json({ available: false });
  });
}
