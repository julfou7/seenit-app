import type { Application, ErrorRequestHandler, RequestHandler } from 'express';
import dns from 'node:dns/promises';
import net from 'node:net';
import { sanitizePlexSyncWatchEvidence } from '../plex/plexWatchEvidence.ts';
import {
  getStrongPlexSourceIdentity,
  unwrapPlexMediaItem
} from '../plex/plexIdentity.ts';
import { buildPlexDeltaWatchedSectionQueries } from '../plex/plexDeltaWatchSnapshot.ts';

export const SEENIT_BACKEND_IDENTITY = 'canonical';

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

interface PlexDeltaSnapshotResult {
  items: any[];
  scannedServers: number;
  skippedServers: number;
}

async function collectPlexDeltaWatchedSnapshot(req: any): Promise<PlexDeltaSnapshotResult> {
  const token = typeof req.headers?.['x-plex-token'] === 'string' ? req.headers['x-plex-token'] : '';
  const clientId = typeof req.body?.clientId === 'string' ? req.body.clientId : 'seenit-delta';
  if (!token) return { items: [], scannedServers: 0, skippedServers: 0 };

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

  const serverResults = await Promise.all(servers.map(async (server: any) => {
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

    if (!baseUri || !sections) return { items: [] as any[], scanned: false };

    const queries = buildPlexDeltaWatchedSectionQueries(baseUri, serverName, sections);
    const queryResults = await Promise.all(queries.map(async (query) => {
      try {
        const pageItems = await fetchPlexPagedItems(query.endpoint, serverToken, clientId, 9000);
        return pageItems
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
      } catch {
        return [] as any[];
      }
    }));

    return { items: queryResults.flat(), scanned: true };
  }));

  return {
    items: serverResults.flatMap(result => result.items),
    scannedServers: serverResults.filter(result => result.scanned).length,
    skippedServers: serverResults.filter(result => !result.scanned).length
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
  const visitedSources = Array.isArray(payload.visitedSources) ? [...payload.visitedSources] : [];
  if (!visitedSources.includes('library-watched-delta')) visitedSources.push('library-watched-delta');

  return {
    ...payload,
    history: nextHistory,
    visitedSources,
    stats: {
      ...(payload.stats && typeof payload.stats === 'object' ? payload.stats : {}),
      libraryWatchedItems: snapshot.items.length,
      deltaWatchedSnapshotItems: snapshot.items.length,
      deltaWatchedSnapshotServers: snapshot.scannedServers,
      deltaWatchedSnapshotSkippedServers: snapshot.skippedServers
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
  if (req.body?.delta !== true) return body;
  try {
    const snapshot = await collectPlexDeltaWatchedSnapshot(req);
    return mergePlexDeltaWatchedSnapshot(body, snapshot);
  } catch (error: any) {
    const code = String(error?.code ?? error?.name ?? 'PLEX_DELTA_SNAPSHOT_FAILED').slice(0, 80);
    console.warn('[Plex Delta Snapshot]', { code });
    return body;
  }
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
  // courant des bibliothèques, puis élimine les preuves Cloud ambiguës.
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
