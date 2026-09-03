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
  mergePlexDeltaWatchedLocators,
  sanitizePlexDeltaWatchedLocators,
  type PlexDeltaWatchedLocator
} from '../plex/plexDeltaUnwatch.ts';
import {
  mergePlexLibraryWatchStates,
  type PlexLibraryWatchState
} from '../plex/plexLibraryWatchState.ts';

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
    const tmdbId = extractPlexExternalIds(item).tmdbId;
    if (!tmdbId) return null;
    return sanitizePlexDeltaWatchedLocators([{
      serverId: params.serverId,
      ratingKey,
      mediaType: 'movie',
      tmdbId
    }])[0] || null;
  }

  const seasonNumber = Number(item?.parentIndex);
  const episodeNumber = Number(item?.index);
  if (!Number.isInteger(seasonNumber) || seasonNumber < 0 || !Number.isInteger(episodeNumber) || episodeNumber <= 0) {
    return null;
  }

  const parentIdentity = buildPlexParentShowIdentityItem({ ...item, serverId: params.serverId });
  let tmdbId = extractPlexExternalIds(parentIdentity).tmdbId;
  if (!tmdbId) {
    const parentRatingKey = getPlexParentShowMetadataLookupKey(item);
    if (!parentRatingKey) return null;

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
    tmdbId = extractPlexExternalIds(parentMetadata).tmdbId;
  }
  if (!tmdbId) return null;

  return sanitizePlexDeltaWatchedLocators([{
    serverId: params.serverId,
    ratingKey,
    mediaType: 'episode',
    tmdbId,
    seasonNumber,
    episodeNumber
  }])[0] || null;
}

/**
 * Le full et la lecture PMS exacte n'expriment pas toujours le zéro de la même façon :
 * un média non-vu peut simplement ne plus avoir de champ viewCount. Ce fallback n'est
 * autorisé qu'après relecture du ratingKey exact d'un locator précédemment vu ; il ne
 * transforme donc jamais un 404, un timeout ou une simple absence de snapshot en dé-vu.
 */
export function buildPlexDeltaAuthoritativeWatchState(
  locator: PlexDeltaWatchedLocator,
  rawMetadata: unknown
): PlexLibraryWatchState | null {
  const explicitState = buildExplicitPlexDeltaWatchState(locator, rawMetadata);
  if (explicitState) return explicitState;
  if (!rawMetadata || typeof rawMetadata !== 'object') return null;

  const metadata = unwrapPlexMediaItem(rawMetadata);
  const responseRatingKey = getPlexMetadataLookupKey(metadata);
  if (!responseRatingKey || responseRatingKey !== locator.ratingKey) return null;

  const hasViewCountField = Object.prototype.hasOwnProperty.call(metadata, 'viewCount')
    || Object.prototype.hasOwnProperty.call(metadata, 'view_count');
  // Un champ présent mais invalide reste indéterminé. Seule son omission sur l'objet
  // technique exact est le codage PMS du zéro que le full interprète déjà comme non-vu.
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
 * Un full complet sert aussi de baseline à la delta suivante. On ne conserve que les
 * entrées `library-watched` munies d'une identité technique suffisante ; jamais un titre.
 * Une collecte partielle/avec serveur ignoré ne remplace pas une baseline antérieure.
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
      const tmdbId = extractPlexExternalIds(item).tmdbId;
      if (!tmdbId) continue;
      locators.push({ serverId, ratingKey, mediaType: 'movie', tmdbId });
      continue;
    }

    const isEpisode = mediaType === 'episode' || item?.grandparentTitle || item?.parentTitle;
    if (!isEpisode) continue;
    const seasonNumber = Number(item?.parentIndex);
    const episodeNumber = Number(item?.index);
    if (!Number.isInteger(seasonNumber) || seasonNumber < 0 || !Number.isInteger(episodeNumber) || episodeNumber <= 0) {
      continue;
    }
    const parentIdentity = buildPlexParentShowIdentityItem({ ...item, serverId });
    const tmdbId = extractPlexExternalIds(parentIdentity).tmdbId;
    if (!tmdbId) continue;
    locators.push({
      serverId,
      ratingKey,
      mediaType: 'episode',
      tmdbId,
      seasonNumber,
      episodeNumber
    });
  }

  return sanitizePlexDeltaWatchedLocators(locators);
}

interface PlexDeltaServerSnapshotResult {
  items: any[];
  locators: PlexDeltaWatchedLocator[];
  scanned: boolean;
  completeForUnwatch: boolean;
  serverId: string;
  baseUri: string | null;
  serverToken: string;
}

interface PlexDeltaSnapshotResult {
  items: any[];
  watchStates: PlexLibraryWatchState[];
  scannedServers: number;
  skippedServers: number;
  explicitUnwatchItems: number;
}

async function collectPlexDeltaWatchedSnapshot(req: any): Promise<PlexDeltaSnapshotResult> {
  const token = typeof req.headers?.['x-plex-token'] === 'string' ? req.headers['x-plex-token'] : '';
  const clientId = typeof req.body?.clientId === 'string' ? req.body.clientId : 'seenit-delta';
  const uid = String(req.user?.uid || '').trim();
  if (!token) return { items: [], watchStates: [], scannedServers: 0, skippedServers: 0, explicitUnwatchItems: 0 };

  const previousLocatorsPromise = loadPlexDeltaWatchedSnapshot(uid);
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

        return {
          items: watchedItems,
          locators,
          complete: locators.length === watchedItems.length
        };
      } catch {
        return { items: [] as any[], locators: [] as PlexDeltaWatchedLocator[], complete: false };
      }
    }));

    return {
      items: queryResults.flatMap(result => result.items),
      locators: queryResults.flatMap(result => result.locators),
      scanned: true,
      completeForUnwatch: Boolean(serverId) && queryResults.every(result => result.complete),
      serverId,
      baseUri,
      serverToken
    };
  }));

  const previousLocators = await previousLocatorsPromise;
  const currentLocators = sanitizePlexDeltaWatchedLocators(serverResults.flatMap(result => result.locators));
  const scannedServers = serverResults.filter(result => result.scanned).length;
  const skippedServers = serverResults.filter(result => !result.scanned).length;
  const allServersSafeForUnwatch = serverResults.length > 0
    && skippedServers === 0
    && serverResults.every(result => result.scanned && result.completeForUnwatch);
  const unwatchServerIds = allServersSafeForUnwatch
    ? new Set(serverResults.map(result => result.serverId).filter(Boolean))
    : new Set<string>();
  const confirmedUnwatched = new Set<string>();
  const explicitStates: PlexLibraryWatchState[] = [];
  const supportsOwnedUnwatch = supportsPlexOwnedUnwatchVersion(req.headers?.['x-plex-version']);

  if (supportsOwnedUnwatch && unwatchServerIds.size > 0) {
    const missingLocators = findMissingPlexDeltaWatchedLocators(previousLocators, currentLocators, unwatchServerIds);
    const serverById = new Map(serverResults.map(result => [result.serverId, result]));

    await runPlexDeltaTasks(missingLocators, 6, async locator => {
      const server = serverById.get(locator.serverId);
      if (!server?.baseUri || !server.serverToken) return;
      try {
        const metadataPayload = await fetchPlexJson(
          `${server.baseUri}/library/metadata/${encodeURIComponent(locator.ratingKey)}?includeGuids=1`,
          server.serverToken,
          clientId,
          6000
        );
        const metadata = readPlexItems(metadataPayload)[0] || null;
        const state = buildPlexDeltaAuthoritativeWatchState(locator, metadata);
        if (state?.watched !== false) return;
        confirmedUnwatched.add(getPlexDeltaWatchedLocatorKey(locator));
        explicitStates.push(state);
      } catch {
        // Un timeout/404 est indéterminé : conserver la dernière vue connue.
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

  // Une copie toujours vue gagne sur une copie explicitement recontrôlée non-vue.
  const currentTrueStates: PlexLibraryWatchState[] = currentLocators.map(locator => (
    locator.mediaType === 'movie'
      ? { mediaType: 'movie', tmdbId: locator.tmdbId, watched: true, serverId: locator.serverId }
      : {
          mediaType: 'episode',
          tmdbId: locator.tmdbId,
          seasonNumber: locator.seasonNumber!,
          episodeNumber: locator.episodeNumber!,
          watched: true,
          serverId: locator.serverId
        }
  ));
  const watchStates = mergePlexLibraryWatchStates([...currentTrueStates, ...explicitStates])
    .filter(state => state.watched === false);

  return {
    items: serverResults.flatMap(result => result.items),
    watchStates,
    scannedServers,
    skippedServers,
    explicitUnwatchItems: watchStates.length
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
      deltaExplicitUnwatchItems: snapshot.explicitUnwatchItems
    },
    integrity: {
      ...(payload.integrity && typeof payload.integrity === 'object' ? payload.integrity : {}),
      deltaWatchedSnapshotComplete: snapshot.skippedServers === 0,
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
      await persistPlexDeltaWatchedSnapshot(uid, baseline);
      console.log('[Plex Delta Snapshot]', { action: 'seed-full', items: baseline.length });
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
  // courant des bibliothèques, recontrôle les disparitions vues avant tout dé-vu,
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