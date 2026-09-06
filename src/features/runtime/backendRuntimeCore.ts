import type { Application, ErrorRequestHandler, RequestHandler } from 'express';
import dns from 'node:dns/promises';
import net from 'node:net';
import { sanitizePlexSyncWatchEvidence } from '../plex/plexWatchEvidence.ts';
import {
  buildPlexParentShowIdentityItem,
  extractPlexExternalIds,
  getPlexMetadataLookupKey,
  getPlexParentShowMetadataLookupKey,
  getStrongPlexSourceIdentity,
  unwrapPlexMediaItem
} from '../plex/plexIdentity.ts';
import { buildPlexDeltaWatchedSectionQueries } from '../plex/plexDeltaWatchSnapshot.ts';
import {
  buildExplicitPlexDeltaWatchState,
  findMissingPlexDeltaWatchedLocators,
  getPlexDeltaWatchedLocatorKey,
  hydratePlexDeltaWatchedLocator,
  mergePlexDeltaWatchedLocators,
  sanitizePlexDeltaWatchedLocators,
  type PlexDeltaWatchedLocator
} from '../plex/plexDeltaUnwatch.ts';
import {
  mergePlexLibraryWatchStates,
  type PlexLibraryWatchState
} from '../plex/plexLibraryWatchState.ts';
import {
  buildPlexDeltaUnresolvedWatchedItem,
  canRecheckPlexDeltaUnwatchCandidate,
  isPlexDeltaWatchedQueryTechnicallyComplete,
  type PlexDeltaUnresolvedWatchedItem
} from './plexDeltaUnwatchSafety.ts';

export const SEENIT_BACKEND_IDENTITY = 'canonical';

const PLEX_DELTA_SNAPSHOT_FIELD = 'deltaWatchedSnapshotV1';
const MAX_PLEX_DELTA_SNAPSHOT_ITEMS = 5000;

export function buildBackendHealthPayload() {
  return {
    status: 'ok' as const,
    service: 'seenit-backend' as const,
    identity: SEENIT_BACKEND_IDENTITY
  };
}

export const backendHealthHandler: RequestHandler = (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-SeenIt-Backend', SEENIT_BACKEND_IDENTITY);
  res.json(buildBackendHealthPayload());
};

function wrapRouteHandler(handler: any): any {
  if (Array.isArray(handler)) return handler.map(wrapRouteHandler);
  if (typeof handler !== 'function' || handler.length === 4) return handler;

  return function seenItAsyncRouteGuard(this: unknown, req: any, res: any, next: any) {
    try {
      const result = handler.call(this, req, res, next);
      if (result && typeof result.then === 'function') {
        result.catch(next);
      }
      return result;
    } catch (error) {
      next(error);
    }
  };
}

function isPrivateOrReservedAddress(address: string): boolean {
  const cleanAddress = address.toLowerCase().split('%')[0];

  if (net.isIPv4(cleanAddress)) {
    const [a, b, c] = cleanAddress.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }

  if (net.isIPv6(cleanAddress)) {
    if (cleanAddress.startsWith('::ffff:')) {
      return isPrivateOrReservedAddress(cleanAddress.slice('::ffff:'.length));
    }
    return (
      cleanAddress === '::' ||
      cleanAddress === '::1' ||
      cleanAddress.startsWith('fc') ||
      cleanAddress.startsWith('fd') ||
      /^fe[89ab]/.test(cleanAddress) ||
      cleanAddress.startsWith('ff') ||
      cleanAddress.startsWith('2001:db8:')
    );
  }

  return true;
}

async function validatePlexRemoteConnection(rawUri: unknown): Promise<string | null> {
  if (typeof rawUri !== 'string' || rawUri.length > 2048) return null;

  let parsed: URL;
  try {
    parsed = new URL(rawUri);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.lan')
  ) {
    return null;
  }

  try {
    const addresses = net.isIP(hostname)
      ? [{ address: hostname }]
      : await dns.lookup(hostname, { all: true, verbatim: true });
    if (addresses.length === 0 || addresses.some(({ address }) => isPrivateOrReservedAddress(address))) {
      return null;
    }
  } catch {
    return null;
  }

  return parsed.toString().replace(/\/+$/, '');
}

function readPlexContainer(payload: any): any {
  return payload?.MediaContainer || payload?.mediaContainer || payload || {};
}

function readPlexItems(payload: any): any[] {
  const container = readPlexContainer(payload);
  const candidates = [container?.Metadata, container?.metadata, container?.Directory, container?.directory];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

async function fetchPlexJson(
  url: string,
  token: string,
  clientId: string,
  timeoutMs: number,
  page?: { start: number; size: number }
): Promise<any> {
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'X-Plex-Token': token,
    'X-Plex-Client-Identifier': clientId || 'seenit-delta'
  };
  if (page) {
    headers['X-Plex-Container-Start'] = String(page.start);
    headers['X-Plex-Container-Size'] = String(page.size);
  }

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`PLEX_HTTP_${response.status}`);
  return response.json();
}

async function fetchPlexPagedItems(
  endpoint: string,
  token: string,
  clientId: string,
  timeoutMs: number
): Promise<any[]> {
  const pageSize = 200;
  const items: any[] = [];

  for (let start = 0; start < 20_000; start += pageSize) {
    const payload = await fetchPlexJson(endpoint, token, clientId, timeoutMs, { start, size: pageSize });
    const pageItems = readPlexItems(payload);
    items.push(...pageItems);

    const container = readPlexContainer(payload);
    const totalSize = Number(container?.totalSize ?? container?.size);
    if (pageItems.length < pageSize) break;
    if (Number.isFinite(totalSize) && items.length >= totalSize) break;
  }

  return items;
}

function supportsPlexOwnedUnwatchVersion(rawVersion: unknown): boolean {
  const match = String(rawVersion || '').trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return false;
  const version = match.slice(1).map(Number);
  const minimum = [1, 4, 111];
  for (let index = 0; index < minimum.length; index++) {
    if (version[index] > minimum[index]) return true;
    if (version[index] < minimum[index]) return false;
  }
  return true;
}

async function runPlexDeltaTasks<T>(
  values: T[],
  concurrency: number,
  worker: (value: T) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), values.length) }, async () => {
    while (cursor < values.length) {
      const value = values[cursor++];
      await worker(value);
    }
  });
  await Promise.all(workers);
}

async function loadPlexDeltaWatchedSnapshot(uid: string): Promise<PlexDeltaWatchedLocator[]> {
  if (!uid) return [];
  try {
    const { adminDb } = await import('../../lib/firebase-admin.ts');
    const snapshot = await adminDb.doc(`users/${uid}/settings/plex`).get();
    return sanitizePlexDeltaWatchedLocators(snapshot.get(PLEX_DELTA_SNAPSHOT_FIELD));
  } catch (error: any) {
    console.warn('[Plex Delta Snapshot Store]', {
      action: 'read',
      code: String(error?.code ?? error?.name ?? 'READ_FAILED').slice(0, 80)
    });
    return [];
  }
}

async function loadPlexDeltaResolutionCache(uid: string): Promise<Record<string, any>> {
  if (!uid) return {};
  try {
    const { adminDb } = await import('../../lib/firebase-admin.ts');
    const snapshot = await adminDb.doc(`users/${uid}/settings/plex`).get();
    const cache = snapshot.get('resolutionCache');
    return cache && typeof cache === 'object' && !Array.isArray(cache) ? cache : {};
  } catch (error: any) {
    console.warn('[Plex Delta Snapshot Store]', {
      action: 'read-resolution-cache',
      code: String(error?.code ?? error?.name ?? 'READ_FAILED').slice(0, 80)
    });
    return {};
  }
}

async function persistPlexDeltaWatchedSnapshot(uid: string, locators: PlexDeltaWatchedLocator[]): Promise<void> {
  if (!uid) return;
  try {
    const { adminDb } = await import('../../lib/firebase-admin.ts');
    const safeLocators = sanitizePlexDeltaWatchedLocators(locators);
    const storedLocators = safeLocators.length <= MAX_PLEX_DELTA_SNAPSHOT_ITEMS ? safeLocators : [];
    await adminDb.doc(`users/${uid}/settings/plex`).set({
      [PLEX_DELTA_SNAPSHOT_FIELD]: storedLocators,
      deltaWatchedSnapshotUpdatedAt: Date.now(),
      deltaWatchedSnapshotOverflow: safeLocators.length > MAX_PLEX_DELTA_SNAPSHOT_ITEMS
    }, { merge: true });
    if (safeLocators.length > MAX_PLEX_DELTA_SNAPSHOT_ITEMS) {
      console.warn('[Plex Delta Snapshot Store]', { action: 'write', code: 'SNAPSHOT_TOO_LARGE' });
    }
  } catch (error: any) {
    console.warn('[Plex Delta Snapshot Store]', {
      action: 'write',
      code: String(error?.code ?? error?.name ?? 'WRITE_FAILED').slice(0, 80)
    });
  }
}

async function buildPlexDeltaWatchedLocator(params: {
  item: any;
  mediaType: 'movie' | 'episode';
  serverId: string;
  baseUri: string;
  serverToken: string;
  clientId: string;
  parentMetadataCache: Map<string, Promise<any | null>>;
}): Promise<PlexDeltaWatchedLocator | null> {
  const item = unwrapPlexMediaItem(params.item);
  const ratingKey = getPlexMetadataLookupKey(item);
  if (!params.serverId || !ratingKey) return null;

  if (params.mediaType === 'movie') {
    const identityItem = { ...item, serverId: params.serverId, serverIdentifier: params.serverId };
    const tmdbId = extractPlexExternalIds(identityItem).tmdbId || undefined;
    const sourceIdentity = getStrongPlexSourceIdentity(identityItem);
    return sanitizePlexDeltaWatchedLocators([{
      serverId: params.serverId,
      ratingKey,
      mediaType: 'movie',
      ...(tmdbId ? { tmdbId } : {}),
      ...(sourceIdentity ? { resolutionKey: `movie:${sourceIdentity}` } : {})
    }])[0] || null;
  }

  const seasonNumber = Number(item?.parentIndex);
  const episodeNumber = Number(item?.index);
  if (!Number.isInteger(seasonNumber) || seasonNumber < 0 || !Number.isInteger(episodeNumber) || episodeNumber <= 0) {
    return null;
  }

  const originalParentIdentity = buildPlexParentShowIdentityItem({
    ...item,
    serverId: params.serverId,
    serverIdentifier: params.serverId
  });
  const sourceIdentity = getStrongPlexSourceIdentity(originalParentIdentity);
  let tmdbId = extractPlexExternalIds(originalParentIdentity).tmdbId || undefined;
  if (!tmdbId) {
    const parentRatingKey = getPlexParentShowMetadataLookupKey(item);
    if (parentRatingKey) {
      const cacheKey = `${params.serverId}:${parentRatingKey}`;
      let parentPromise = params.parentMetadataCache.get(cacheKey);
      if (!parentPromise) {
        parentPromise = fetchPlexJson(
          `${params.baseUri}/library/metadata/${encodeURIComponent(parentRatingKey)}?includeGuids=1`,
          params.serverToken,
          params.clientId,
          6000
        ).then(payload => readPlexItems(payload)[0] || null).catch(() => null);
        params.parentMetadataCache.set(cacheKey, parentPromise);
      }
      const parentMetadata = await parentPromise;
      tmdbId = extractPlexExternalIds(parentMetadata).tmdbId || undefined;
    }
  }

  return sanitizePlexDeltaWatchedLocators([{
    serverId: params.serverId,
    ratingKey,
    mediaType: 'episode',
    ...(tmdbId ? { tmdbId } : {}),
    ...(sourceIdentity ? { resolutionKey: `tv:${sourceIdentity}` } : {}),
    seasonNumber,
    episodeNumber
  }])[0] || null;
}

/**
 * Le full et la lecture PMS exacte n'expriment pas toujours le zéro de la même façon :
 * un média non vu peut simplement ne plus avoir de champ viewCount. Ce fallback n'est
 * autorisé qu'après relecture du ratingKey exact d'un locator précédemment vu ; il ne
 * transforme donc jamais un 404, un timeout ou une simple absence de snapshot en non vu.
 */
export function buildPlexDeltaAuthoritativeWatchState(
  locator: PlexDeltaWatchedLocator,
  rawMetadata: unknown
): PlexLibraryWatchState | null {
  const explicitState = buildExplicitPlexDeltaWatchState(locator, rawMetadata);
  if (explicitState) return explicitState;
  if (!locator.tmdbId || !rawMetadata || typeof rawMetadata !== 'object') return null;

  const metadata = unwrapPlexMediaItem(rawMetadata);
  const responseRatingKey = getPlexMetadataLookupKey(metadata);
  if (!responseRatingKey || responseRatingKey !== locator.ratingKey) return null;

  const hasViewCountField = Object.prototype.hasOwnProperty.call(metadata, 'viewCount')
    || Object.prototype.hasOwnProperty.call(metadata, 'view_count');
  // Un champ présent mais invalide reste indéterminé. Seule son omission sur l'objet
  // technique exact est le codage PMS du zéro que le full interprète déjà comme non vu.
  if (hasViewCountField) return null;

  return locator.mediaType === 'movie'
    ? {
        mediaType: 'movie',
        tmdbId: locator.tmdbId,
        watched: false,
        serverId: locator.serverId
      }
    : {
        mediaType: 'episode',
        tmdbId: locator.tmdbId,
        seasonNumber: locator.seasonNumber!,
        episodeNumber: locator.episodeNumber!,
        watched: false,
        serverId: locator.serverId
      };
}

/**
 * Un full complet sert aussi de baseline à la delta suivante. On conserve chaque
 * `library-watched` muni d'un ratingKey PMS exact, même si son TMDB n'est pas encore
 * résolu ; jamais un titre. Une collecte partielle/avec serveur ignoré ne remplace pas
 * une baseline antérieure.
 */
export function buildPlexFullWatchedDeltaBaseline(payload: any): PlexDeltaWatchedLocator[] | null {
  if (!payload || typeof payload !== 'object') return null;
  const integrity = payload.integrity && typeof payload.integrity === 'object' ? payload.integrity : null;
  if (!integrity || integrity.libraryInventoryScanComplete !== true) return null;
  if (!Array.isArray(integrity.syncedServers) || integrity.syncedServers.length === 0) return null;
  if (!Array.isArray(integrity.skippedServers) || integrity.skippedServers.length > 0) return null;

  const history = Array.isArray(payload.history) ? payload.history : [];
  const locators: PlexDeltaWatchedLocator[] = [];

  for (const rawItem of history) {
    const item = unwrapPlexMediaItem(rawItem);
    if (item?.sourceKind !== 'library-watched') continue;

    const serverId = String(item?.serverId || item?.serverIdentifier || '').trim();
    const ratingKey = getPlexMetadataLookupKey(item);
    if (!serverId || !ratingKey) continue;

    const mediaType = String(item?.type || '').toLowerCase();
    if (mediaType === 'movie') {
      const identityItem = { ...item, serverId, serverIdentifier: serverId };
      const tmdbId = extractPlexExternalIds(identityItem).tmdbId || undefined;
      const sourceIdentity = getStrongPlexSourceIdentity(identityItem);
      locators.push({
        serverId,
        ratingKey,
        mediaType: 'movie',
        ...(tmdbId ? { tmdbId } : {}),
        ...(sourceIdentity ? { resolutionKey: `movie:${sourceIdentity}` } : {})
      });
      continue;
    }

    const isEpisode = mediaType === 'episode' || item?.grandparentTitle || item?.parentTitle;
    if (!isEpisode) continue;
    const seasonNumber = Number(item?.parentIndex);
    const episodeNumber = Number(item?.index);
    if (!Number.isInteger(seasonNumber) || seasonNumber < 0 || !Number.isInteger(episodeNumber) || episodeNumber <= 0) {
      continue;
    }
    const parentIdentity = buildPlexParentShowIdentityItem({ ...item, serverId, serverIdentifier: serverId });
    const tmdbId = extractPlexExternalIds(parentIdentity).tmdbId || undefined;
    const sourceIdentity = getStrongPlexSourceIdentity(parentIdentity);
    locators.push({
      serverId,
      ratingKey,
      mediaType: 'episode',
      ...(tmdbId ? { tmdbId } : {}),
      ...(sourceIdentity ? { resolutionKey: `tv:${sourceIdentity}` } : {}),
      seasonNumber,
      episodeNumber
    });
  }

  return sanitizePlexDeltaWatchedLocators(locators);
}

interface PlexDeltaServerSnapshotResult {
  items: any[];
  locators: PlexDeltaWatchedLocator[];
  unresolvedWatchedItems: PlexDeltaUnresolvedWatchedItem[];
  scanned: boolean;
  completeForUnwatch: boolean;
  serverId: string;
  baseUri: string | null;
  serverToken: string;
}

export function getPlexDeltaAuthoritativeUnwatchServerIds(
  serverResults: Array<{ serverId: string; scanned: boolean; completeForUnwatch: boolean }>
): Set<string> {
  return new Set(
    serverResults
      .filter(result => result.scanned && result.completeForUnwatch && Boolean(result.serverId))
      .map(result => result.serverId)
  );
}

interface PlexDeltaSnapshotResult {
  items: any[];
  watchStates: PlexLibraryWatchState[];
  scannedServers: number;
  skippedServers: number;
  explicitUnwatchItems: number;
  incompleteServers?: number;
  previousLocatorItems?: number;
  previousCanonicalLocatorItems?: number;
  currentLocatorItems?: number;
  currentCanonicalLocatorItems?: number;
  unresolvedWatchedItems?: number;
  missingUnwatchCandidates?: number;
  blockedUnwatchCandidates?: number;
  recheckedUnwatchCandidates?: number;
}

async function collectPlexDeltaWatchedSnapshot(req: any): Promise<PlexDeltaSnapshotResult> {
  const token = typeof req.headers?.['x-plex-token'] === 'string' ? req.headers['x-plex-token'] : '';
  const clientId = typeof req.body?.clientId === 'string' ? req.body.clientId : 'seenit-delta';
  const uid = String(req.user?.uid || '').trim();
  if (!token) {
    return {
      items: [],
      watchStates: [],
      scannedServers: 0,
      skippedServers: 0,
      explicitUnwatchItems: 0,
      incompleteServers: 0,
      previousLocatorItems: 0,
      previousCanonicalLocatorItems: 0,
      currentLocatorItems: 0,
      currentCanonicalLocatorItems: 0,
      unresolvedWatchedItems: 0,
      missingUnwatchCandidates: 0,
      blockedUnwatchCandidates: 0,
      recheckedUnwatchCandidates: 0
    };
  }

  const previousLocatorsPromise = loadPlexDeltaWatchedSnapshot(uid);
  const resolutionCachePromise = loadPlexDeltaResolutionCache(uid);
  const resourcesResponse = await fetch(
    'https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1',
    {
      headers: {
        'Accept': 'application/json',
        'X-Plex-Token': token,
        'X-Plex-Client-Identifier': clientId
      },
      signal: AbortSignal.timeout(8000)
    }
  );
  if (!resourcesResponse.ok) throw new Error(`PLEX_RESOURCES_${resourcesResponse.status}`);

  const resources = await resourcesResponse.json();
  const servers = Array.isArray(resources)
    ? resources.filter((resource: any) => String(resource?.provides || '').includes('server'))
    : [];

  const serverResults: PlexDeltaServerSnapshotResult[] = await Promise.all(servers.map(async (server: any) => {
    const serverId = String(server?.clientIdentifier || server?.machineIdentifier || '').trim();
    const serverName = String(server?.name || 'Serveur Plex').trim();
    const serverToken = String(server?.accessToken || token).trim();
    const rawConnections = Array.isArray(server?.connections) ? server.connections : [];
    const orderedConnections = [...rawConnections].sort((left: any, right: any) => {
      const leftScore = (left?.local === false ? 0 : 2) + (left?.relay === true ? 1 : 0);
      const rightScore = (right?.local === false ? 0 : 2) + (right?.relay === true ? 1 : 0);
      return leftScore - rightScore;
    });

    let sections: any[] | null = null;
    let baseUri: string | null = null;
    for (const connection of orderedConnections) {
      const safeUri = await validatePlexRemoteConnection(connection?.uri);
      if (!safeUri) continue;
      try {
        const sectionsPayload = await fetchPlexJson(`${safeUri}/library/sections`, serverToken, clientId, 6000);
        sections = readPlexItems(sectionsPayload);
        baseUri = safeUri;
        break;
      } catch {
        // Tester la connexion distante/relay suivante sans exposer l'URI ni le token.
      }
    }

    if (!baseUri || !sections) {
      return {
        items: [],
        locators: [],
        unresolvedWatchedItems: [],
        scanned: false,
        completeForUnwatch: false,
        serverId,
        baseUri: null,
        serverToken
      };
    }

    const parentMetadataCache = new Map<string, Promise<any | null>>();
    const queries = buildPlexDeltaWatchedSectionQueries(baseUri, serverName, sections);
    const queryResults = await Promise.all(queries.map(async (query) => {
      try {
        const pageItems = await fetchPlexPagedItems(query.endpoint, serverToken, clientId, 9000);
        const watchedItems = pageItems
          .filter((item: any) => Number(item?.viewCount ?? item?.view_count ?? 0) > 0)
          .map((item: any) => ({
            ...item,
            source: 'library-watched',
            sourceKind: 'library-watched',
            sourceName: query.sourceName,
            serverId,
            serverIdentifier: serverId,
            serverName,
            viewedAt: item?.lastViewedAt ?? item?.viewedAt ?? item?.lastViewedAtTimestamp ?? Date.now()
          }));

        const locatorResults = await Promise.all(watchedItems.map(item => buildPlexDeltaWatchedLocator({
          item,
          mediaType: query.mediaType,
          serverId,
          baseUri: baseUri!,
          serverToken,
          clientId,
          parentMetadataCache
        })));
        const locators = locatorResults.filter((locator): locator is PlexDeltaWatchedLocator => Boolean(locator));
        const unresolvedWatchedItems = watchedItems.flatMap((item, index) => {
          if (locatorResults[index]) return [];
          const unresolved = buildPlexDeltaUnresolvedWatchedItem(item, query.mediaType, serverId);
          return unresolved ? [unresolved] : [];
        });

        return {
          items: watchedItems,
          locators,
          unresolvedWatchedItems,
          complete: isPlexDeltaWatchedQueryTechnicallyComplete(watchedItems)
        };
      } catch {
        return {
          items: [] as any[],
          locators: [] as PlexDeltaWatchedLocator[],
          unresolvedWatchedItems: [] as PlexDeltaUnresolvedWatchedItem[],
          complete: false
        };
      }
    }));

    return {
      items: queryResults.flatMap(result => result.items),
      locators: queryResults.flatMap(result => result.locators),
      unresolvedWatchedItems: queryResults.flatMap(result => result.unresolvedWatchedItems),
      scanned: true,
      completeForUnwatch: Boolean(serverId) && queryResults.every(result => result.complete),
      serverId,
      baseUri,
      serverToken
    };
  }));

  const resolutionCache = await resolutionCachePromise;
  const previousLocators = (await previousLocatorsPromise)
    .map(locator => hydratePlexDeltaWatchedLocator(locator, resolutionCache));
  const currentLocators = sanitizePlexDeltaWatchedLocators(serverResults.flatMap(result => result.locators))
    .map(locator => hydratePlexDeltaWatchedLocator(locator, resolutionCache));
  const unresolvedWatched = serverResults.flatMap(result => result.unresolvedWatchedItems);
  const scannedServers = serverResults.filter(result => result.scanned).length;
  const skippedServers = serverResults.filter(result => !result.scanned).length;
  const incompleteServers = serverResults.filter(result => result.scanned && !result.completeForUnwatch).length;
  const unwatchServerIds = getPlexDeltaAuthoritativeUnwatchServerIds(serverResults);
  const confirmedUnwatched = new Set<string>();
  const explicitStates: PlexLibraryWatchState[] = [];
  const supportsOwnedUnwatch = supportsPlexOwnedUnwatchVersion(req.headers?.['x-plex-version']);
  let missingUnwatchCandidates = 0;
  let blockedUnwatchCandidates = 0;
  let recheckedUnwatchCandidates = 0;

  if (supportsOwnedUnwatch && unwatchServerIds.size > 0) {
    const missingLocators = findMissingPlexDeltaWatchedLocators(previousLocators, currentLocators, unwatchServerIds);
    missingUnwatchCandidates = missingLocators.length;
    const recheckableLocators = missingLocators.filter(locator => (
      canRecheckPlexDeltaUnwatchCandidate(locator, unresolvedWatched)
    ));
    blockedUnwatchCandidates = missingLocators.length - recheckableLocators.length;
    const serverById = new Map(serverResults.map(result => [result.serverId, result]));
    const recheckParentMetadataCache = new Map<string, Promise<any | null>>();

    await runPlexDeltaTasks(recheckableLocators, 6, async locator => {
      const server = serverById.get(locator.serverId);
      if (!server?.baseUri || !server.serverToken) return;
      recheckedUnwatchCandidates += 1;
      try {
        const metadataPayload = await fetchPlexJson(
          `${server.baseUri}/library/metadata/${encodeURIComponent(locator.ratingKey)}?includeGuids=1`,
          server.serverToken,
          clientId,
          6000
        );
        const metadata = readPlexItems(metadataPayload)[0] || null;
        if (!metadata) return;

        const refreshedLocator = await buildPlexDeltaWatchedLocator({
          item: metadata,
          mediaType: locator.mediaType,
          serverId: locator.serverId,
          baseUri: server.baseUri,
          serverToken: server.serverToken,
          clientId,
          parentMetadataCache: recheckParentMetadataCache
        });
        const authoritativeLocator = hydratePlexDeltaWatchedLocator({
          ...locator,
          ...(refreshedLocator || {}),
          serverId: locator.serverId,
          ratingKey: locator.ratingKey,
          mediaType: locator.mediaType,
          tmdbId: refreshedLocator?.tmdbId || locator.tmdbId,
          resolutionKey: refreshedLocator?.resolutionKey || locator.resolutionKey
        }, resolutionCache);
        const state = buildPlexDeltaAuthoritativeWatchState(authoritativeLocator, metadata);
        if (state?.watched !== false) return;
        confirmedUnwatched.add(getPlexDeltaWatchedLocatorKey(locator));
        explicitStates.push(state);
      } catch {
        // Un timeout/404 est indéterminé : conserver le dernier état vu connu.
      }
    });
  }

  const nextLocators = mergePlexDeltaWatchedLocators({
    previous: previousLocators,
    current: currentLocators,
    scannedServerIds: unwatchServerIds,
    confirmedUnwatched
  });
  await persistPlexDeltaWatchedSnapshot(uid, nextLocators);

  // Une copie toujours vue gagne sur une copie explicitement recontrôlée non vue.
  const currentTrueStates: PlexLibraryWatchState[] = [];
  for (const locator of currentLocators) {
    if (!locator.tmdbId) continue;
    if (locator.mediaType === 'movie') {
      currentTrueStates.push({
        mediaType: 'movie',
        tmdbId: locator.tmdbId,
        watched: true,
        serverId: locator.serverId
      });
      continue;
    }
    currentTrueStates.push({
      mediaType: 'episode',
      tmdbId: locator.tmdbId,
      seasonNumber: locator.seasonNumber!,
      episodeNumber: locator.episodeNumber!,
      watched: true,
      serverId: locator.serverId
    });
  }
  const watchStates = mergePlexLibraryWatchStates([...currentTrueStates, ...explicitStates])
    .filter(state => state.watched === false);
  const previousCanonicalLocatorItems = previousLocators.filter(locator => Boolean(locator.tmdbId)).length;
  const currentCanonicalLocatorItems = currentLocators.filter(locator => Boolean(locator.tmdbId)).length;

  console.log('[Plex Delta Non vu]', {
    previous: previousLocators.length,
    previousCanonical: previousCanonicalLocatorItems,
    current: currentLocators.length,
    currentCanonical: currentCanonicalLocatorItems,
    unresolvedWatched: unresolvedWatched.length,
    candidates: missingUnwatchCandidates,
    blocked: blockedUnwatchCandidates,
    rechecked: recheckedUnwatchCandidates,
    confirmed: watchStates.length,
    incompleteServers,
    skippedServers
  });

  return {
    items: serverResults.flatMap(result => result.items),
    watchStates,
    scannedServers,
    skippedServers,
    explicitUnwatchItems: watchStates.length,
    incompleteServers,
    previousLocatorItems: previousLocators.length,
    previousCanonicalLocatorItems,
    currentLocatorItems: currentLocators.length,
    currentCanonicalLocatorItems,
    unresolvedWatchedItems: unresolvedWatched.length,
    missingUnwatchCandidates,
    blockedUnwatchCandidates,
    recheckedUnwatchCandidates
  };
}

function plexHistoryIdentity(rawItem: any): string | null {
  const item = unwrapPlexMediaItem(rawItem);
  const mediaType = String(item?.type || '').toLowerCase();
  const strongIdentity = getStrongPlexSourceIdentity(item);
  const serverId = String(item?.serverId || item?.serverIdentifier || '').trim();
  const ratingKey = String(item?.ratingKey || '').trim();
  const fallback = strongIdentity || (serverId && ratingKey ? `server:${serverId}:rating:${ratingKey}` : '');
  if (!fallback) return null;

  if (mediaType === 'episode' || item?.grandparentTitle || item?.parentTitle) {
    const season = Number(item?.parentIndex);
    const episode = Number(item?.index);
    if (Number.isFinite(season) && Number.isFinite(episode)) {
      return `${fallback}:S${season}:E${episode}`;
    }
  }
  return fallback;
}

export function mergePlexDeltaWatchedSnapshot(payload: any, snapshot: PlexDeltaSnapshotResult): any {
  if (!payload || typeof payload !== 'object') return payload;
  const history = Array.isArray(payload.history) ? payload.history : [];
  const known = new Set(history.map(plexHistoryIdentity).filter(Boolean) as string[]);
  const appended: any[] = [];

  for (const item of snapshot.items) {
    const identity = plexHistoryIdentity(item);
    if (identity && known.has(identity)) continue;
    if (identity) known.add(identity);
    appended.push(item);
  }

  const nextHistory = [...history, ...appended];
  const nextLibraryWatchStates = mergePlexLibraryWatchStates([
    ...(Array.isArray(payload.libraryWatchStates) ? payload.libraryWatchStates : []),
    ...snapshot.watchStates
  ]);
  const visitedSources = Array.isArray(payload.visitedSources) ? [...payload.visitedSources] : [];
  if (!visitedSources.includes('library-watched-delta')) visitedSources.push('library-watched-delta');
  if (snapshot.explicitUnwatchItems > 0 && !visitedSources.includes('library-unwatched-delta-explicit')) {
    visitedSources.push('library-unwatched-delta-explicit');
  }

  const incompleteServers = Number(snapshot.incompleteServers || 0);
  return {
    ...payload,
    history: nextHistory,
    libraryWatchStates: nextLibraryWatchStates,
    visitedSources,
    stats: {
      ...(payload.stats && typeof payload.stats === 'object' ? payload.stats : {}),
      libraryWatchedItems: snapshot.items.length,
      deltaWatchedSnapshotItems: snapshot.items.length,
      deltaWatchedSnapshotServers: snapshot.scannedServers,
      deltaWatchedSnapshotSkippedServers: snapshot.skippedServers,
      deltaWatchedSnapshotIncompleteServers: incompleteServers,
      deltaPreviousLocatorItems: Number(snapshot.previousLocatorItems || 0),
      deltaPreviousCanonicalLocatorItems: Number(snapshot.previousCanonicalLocatorItems || 0),
      deltaCurrentLocatorItems: Number(snapshot.currentLocatorItems || 0),
      deltaCurrentCanonicalLocatorItems: Number(snapshot.currentCanonicalLocatorItems || 0),
      deltaUnresolvedWatchedItems: Number(snapshot.unresolvedWatchedItems || 0),
      deltaMissingUnwatchCandidates: Number(snapshot.missingUnwatchCandidates || 0),
      deltaBlockedUnwatchCandidates: Number(snapshot.blockedUnwatchCandidates || 0),
      deltaRecheckedUnwatchCandidates: Number(snapshot.recheckedUnwatchCandidates || 0),
      deltaExplicitUnwatchItems: snapshot.explicitUnwatchItems
    },
    integrity: {
      ...(payload.integrity && typeof payload.integrity === 'object' ? payload.integrity : {}),
      deltaWatchedSnapshotComplete: snapshot.skippedServers === 0 && incompleteServers === 0,
      deltaWatchedSnapshotServers: snapshot.scannedServers
    },
    totalFound: nextHistory.length + (Array.isArray(payload.watchlist) ? payload.watchlist.length : 0)
  };
}

async function enrichPlexDeltaResponse(req: any, body: any): Promise<any> {
  if (req.body?.delta === true) {
    try {
      const snapshot = await collectPlexDeltaWatchedSnapshot(req);
      return mergePlexDeltaWatchedSnapshot(body, snapshot);
    } catch (error: any) {
      const code = String(error?.code ?? error?.name ?? 'PLEX_DELTA_SNAPSHOT_FAILED').slice(0, 80);
      console.warn('[Plex Delta Snapshot]', { action: 'delta', code });
      return body;
    }
  }

  // Un full complet donne une baseline immédiate au premier delta suivant. Cette
  // persistance est un miroir technique non destructif ; une collecte partielle ne
  // remplace jamais la dernière baseline connue.
  try {
    const uid = String(req.user?.uid || '').trim();
    const baseline = buildPlexFullWatchedDeltaBaseline(body);
    if (uid && baseline) {
      const resolutionCache = await loadPlexDeltaResolutionCache(uid);
      const hydratedBaseline = baseline.map(locator => hydratePlexDeltaWatchedLocator(locator, resolutionCache));
      await persistPlexDeltaWatchedSnapshot(uid, hydratedBaseline);
      console.log('[Plex Delta Snapshot]', { action: 'seed-full', items: hydratedBaseline.length });
    }
  } catch (error: any) {
    const code = String(error?.code ?? error?.name ?? 'PLEX_FULL_SNAPSHOT_SEED_FAILED').slice(0, 80);
    console.warn('[Plex Delta Snapshot]', { action: 'seed-full', code });
  }
  return body;
}

function installPlexWatchEvidenceResponseGuard(app: Application): void {
  app.use((req, res, next) => {
    if (req.method !== 'POST' || req.path !== '/api/plex/history') {
      next();
      return;
    }

    const originalJson = res.json.bind(res);
    let responseScheduled = false;
    (res as any).json = (body: any) => {
      if (responseScheduled) return res;
      responseScheduled = true;
      void enrichPlexDeltaResponse(req, body)
        .then(enriched => originalJson(sanitizePlexSyncWatchEvidence(enriched)))
        .catch(() => originalJson(sanitizePlexSyncWatchEvidence(body)));
      return res;
    };
    next();
  });
}

/**
 * Express 4 ne relaie pas nativement les rejets des handlers async vers next(error).
 * On enveloppe les routes de cette instance avant leur déclaration, sans modifier
 * les middlewares de sécurité ni dépendre d'un patch global du framework.
 */
export function installAsyncRouteForwarding(app: Application): void {
  // Ce garde est installé avant les routes : il complète la delta avec l'état vu
  // courant des bibliothèques, recontrôle les disparitions vues avant tout état non vu,
  // puis élimine les preuves Cloud ambiguës.
  installPlexWatchEvidenceResponseGuard(app);

  const methods = ['all', 'delete', 'get', 'head', 'options', 'patch', 'post', 'put'] as const;

  for (const method of methods) {
    const original = (app as any)[method].bind(app);
    (app as any)[method] = (...args: any[]) => {
      // app.get('setting') est aussi un getter Express : ne pas l'altérer.
      if (method === 'get' && args.length === 1) return original(...args);
      if (args.length <= 1) return original(...args);
      return original(args[0], ...args.slice(1).map(wrapRouteHandler));
    };
  }
}

export const apiErrorMiddleware: ErrorRequestHandler = (error: any, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const code = String(error?.code ?? error?.name ?? 'API_ERROR').slice(0, 80);
  // Ne jamais journaliser le message ou les entêtes : ils peuvent contenir une URL ou un secret tiers.
  console.error('[API Error]', { method: req.method, code });
  res.status(500).json({
    error: 'BACKEND_REQUEST_FAILED',
    message: 'Le backend SeenIt a rencontré une erreur.'
  });
};