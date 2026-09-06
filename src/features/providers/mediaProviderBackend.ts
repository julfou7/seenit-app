import type { Application, NextFunction, Request, RequestHandler, Response } from 'express';
import { adminAuth } from '../../lib/firebase-admin.ts';

const TMDB_ORIGIN = 'https://api.themoviedb.org/3';
const OMDB_ORIGIN = 'https://www.omdbapi.com/';
const TVDB_ORIGIN = 'https://api4.thetvdb.com/v4';
const PROVIDER_TIMEOUT_MS = 10_000;
const ALLOWED_TMDB_ROOTS = new Set(['search', 'find', 'tv', 'movie', 'collection', 'discover', 'trending', 'person']);
const OMITTED_PROVIDER_QUERY_KEYS = new Set(['api_key', 'apikey', 'access_token']);
const OMDB_ALLOWED_KEYS = new Set(['i', 'Season', 'type', 'y', 'plot', 'r', 'v']);

interface ProviderRequest extends Request {
  providerUid?: string;
}

interface RateBucket {
  count: number;
  resetAt: number;
}

const rateBuckets = new Map<string, RateBucket>();
let tvdbTokenCache: { token: string; expiresAt: number } | null = null;

function applyProviderCors(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Plex-Version');
  res.setHeader('Cache-Control', 'no-store');
  next();
}

const requireProviderAuth: RequestHandler = async (req: ProviderRequest, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized: Missing token' });
    return;
  }
  try {
    const decoded = await adminAuth.verifyIdToken(authHeader.slice('Bearer '.length));
    req.providerUid = decoded.uid;
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

function providerRateLimit(namespace: string, maxRequests: number, windowMs: number): RequestHandler {
  return (req: ProviderRequest, res, next) => {
    const now = Date.now();
    if (rateBuckets.size > 5_000) {
      for (const [key, bucket] of rateBuckets) {
        if (bucket.resetAt <= now) rateBuckets.delete(key);
      }
    }
    const subject = req.providerUid || req.ip || 'unknown';
    const key = `${namespace}:${subject}`;
    const previous = rateBuckets.get(key);
    const bucket = !previous || previous.resetAt <= now
      ? { count: 0, resetAt: now + windowMs }
      : previous;
    bucket.count += 1;
    rateBuckets.set(key, bucket);
    if (bucket.count > maxRequests) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      res.status(429).json({ error: 'Trop de requêtes fournisseur, réessaie plus tard.' });
      return;
    }
    next();
  };
}

function asScalarQueryValue(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function buildTmdbUrl(req: Request, apiKey: string): URL | null {
  const rawPath = String((req.params as any)?.[0] || '').replace(/^\/+/, '');
  if (!rawPath || rawPath.length > 500 || rawPath.includes('..') || !/^[A-Za-z0-9_./-]+$/.test(rawPath)) return null;
  const root = rawPath.split('/')[0];
  if (!ALLOWED_TMDB_ROOTS.has(root)) return null;

  const target = new URL(`${TMDB_ORIGIN}/${rawPath}`);
  let queryCount = 0;
  for (const [key, rawValue] of Object.entries(req.query || {})) {
    if (OMITTED_PROVIDER_QUERY_KEYS.has(key.toLowerCase())) continue;
    if (!/^[A-Za-z0-9_.-]{1,80}$/.test(key)) return null;
    const value = asScalarQueryValue(rawValue);
    if (value === null || value.length > 2_048 || ++queryCount > 40) return null;
    target.searchParams.set(key, value);
  }
  target.searchParams.set('api_key', apiKey);
  return target;
}

function buildOmdbUrl(req: Request, apiKey: string): URL | null {
  const target = new URL(OMDB_ORIGIN);
  target.searchParams.set('apikey', apiKey);
  for (const [key, rawValue] of Object.entries(req.query || {})) {
    if (OMITTED_PROVIDER_QUERY_KEYS.has(key.toLowerCase())) continue;
    if (!OMDB_ALLOWED_KEYS.has(key)) return null;
    const value = asScalarQueryValue(rawValue);
    if (value === null || value.length > 300) return null;
    target.searchParams.set(key, value);
  }
  const imdbId = target.searchParams.get('i');
  if (!imdbId || !/^tt\d{5,12}$/i.test(imdbId)) return null;
  const season = target.searchParams.get('Season');
  if (season !== null && (!/^\d{1,3}$/.test(season) || Number(season) > 999)) return null;
  return target;
}

async function relayJsonProviderResponse(target: URL, res: Response): Promise<void> {
  try {
    const upstream = await fetch(target, {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': 'SeenIt-Backend/1.0' },
      redirect: 'error',
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    const body = await upstream.text();
    res.status(upstream.status);
    res.type(upstream.headers.get('content-type') || 'application/json');
    res.send(body);
  } catch (error: any) {
    const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    res.status(timeout ? 504 : 502).json({
      error: timeout ? 'Le fournisseur ne répond pas dans le délai imparti.' : 'Le fournisseur est momentanément indisponible.'
    });
  }
}

async function tvdbRequest(path: string, token: string, params?: Record<string, string>): Promise<any | null> {
  const target = new URL(`${TVDB_ORIGIN}/${path.replace(/^\/+/, '')}`);
  Object.entries(params || {}).forEach(([key, value]) => target.searchParams.set(key, value));
  const response = await fetch(target, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'SeenIt-Backend/1.0' },
    redirect: 'error',
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  return response.json();
}

async function getTvdbToken(apiKey: string): Promise<string | null> {
  const now = Date.now();
  if (tvdbTokenCache?.expiresAt && tvdbTokenCache.expiresAt > now) return tvdbTokenCache.token;
  try {
    const response = await fetch(`${TVDB_ORIGIN}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'SeenIt-Backend/1.0' },
      body: JSON.stringify({ apikey: apiKey }),
      redirect: 'error',
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const token = typeof payload?.data?.token === 'string' ? payload.data.token : '';
    if (!token) return null;
    tvdbTokenCache = { token, expiresAt: now + 23 * 60 * 60 * 1000 };
    return token;
  } catch {
    return null;
  }
}

function isFranchiseList(list: any): boolean {
  const name = String(list?.name || '').toLowerCase();
  return Boolean(list?.isOfficial)
    || ['franchise', 'universe', 'whoniverse', 'arrowverse', 'world', 'saga', 'one chicago'].some(term => name.includes(term));
}

function rankFranchiseList(list: any): number {
  const name = String(list?.name || '').toLowerCase();
  let score = list?.isOfficial ? 10 : 0;
  if (['universe', 'world', 'whoniverse', 'franchise'].some(term => name.includes(term))) score += 5;
  if (Number(list?.score) > 0) score += Math.log10(Number(list.score) + 1);
  return score;
}

export async function getTvdbFranchiseTimelineServer(params: {
  apiKey: string;
  tvdbId?: number | null;
  mediaTitle?: string | null;
  mediaType?: 'tv' | 'movie';
}): Promise<Array<{ id: number; media_type: 'tv' | 'movie' }>> {
  const token = await getTvdbToken(params.apiKey);
  if (!token) return [];
  const mediaType = params.mediaType === 'movie' ? 'movie' : 'tv';
  let activeTvdbId = Number(params.tvdbId) > 0 ? Number(params.tvdbId) : null;
  const title = typeof params.mediaTitle === 'string' ? params.mediaTitle.trim().slice(0, 200) : '';
  let listIds: Array<number | string> = [];

  if (!activeTvdbId && title) {
    const search = await tvdbRequest('search', token, { query: title, type: mediaType === 'movie' ? 'movie' : 'series' });
    const first = search?.data?.[0];
    const id = Number(first?.tvdb_id || first?.id);
    if (Number.isFinite(id) && id > 0) activeTvdbId = id;
  }

  if (activeTvdbId) {
    const extended = await tvdbRequest(`${mediaType === 'movie' ? 'movies' : 'series'}/${activeTvdbId}/extended`, token);
    const lists = Array.isArray(extended?.data?.lists) ? extended.data.lists.filter(isFranchiseList) : [];
    listIds = lists.sort((a: any, b: any) => rankFranchiseList(b) - rankFranchiseList(a)).slice(0, 5).map((list: any) => list.id);
  }

  if (!listIds.length && title) {
    const cleanTitle = title.replace(/:(.*)/, '').trim();
    const search = await tvdbRequest('search', token, { query: cleanTitle, type: 'list' });
    const lists = Array.isArray(search?.data) ? search.data.filter(isFranchiseList) : [];
    listIds = lists.sort((a: any, b: any) => rankFranchiseList(b) - rankFranchiseList(a)).slice(0, 5).map((list: any) => list.tvdb_id || list.id);
  }

  if (!listIds.length) return [];
  const entities = new Map<string, any>();
  for (const listId of listIds) {
    const payload = await tvdbRequest(`lists/${encodeURIComponent(String(listId))}/extended`, token);
    for (const entity of payload?.data?.entities || []) {
      const key = entity.seriesId ? `tv_${entity.seriesId}` : entity.movieId ? `movie_${entity.movieId}` : '';
      if (key && !entities.has(key)) entities.set(key, entity);
    }
  }

  const resolved = await Promise.all(Array.from(entities.values()).slice(0, 120).map(async entity => {
    const media_type: 'tv' | 'movie' = entity.seriesId ? 'tv' : 'movie';
    const entityId = entity.seriesId || entity.movieId;
    if (!entityId) return null;
    const payload = await tvdbRequest(`${media_type === 'tv' ? 'series' : 'movies'}/${entityId}/extended`, token);
    const remoteIds = payload?.data?.remoteIds || [];
    const tmdb = remoteIds.find((remote: any) => remote?.type === 12 || /themoviedb|tmdb/i.test(String(remote?.sourceName || '')));
    const id = Number(tmdb?.id);
    return Number.isFinite(id) && id > 0 ? { id, media_type } : null;
  }));
  return resolved.filter((item): item is { id: number; media_type: 'tv' | 'movie' } => item !== null);
}

export function registerMediaProviderRoutes(app: Application): void {
  app.options('/api/media/*', applyProviderCors, (_req, res) => res.sendStatus(204));

  app.get(
    '/api/media/tmdb/*',
    applyProviderCors,
    requireProviderAuth,
    providerRateLimit('provider-tmdb', 120, 60_000),
    async (req, res) => {
      const apiKey = String(process.env.TMDB_API_KEY || '').trim();
      if (!apiKey) return res.status(503).json({ error: 'TMDB indisponible: secret serveur absent.' });
      const target = buildTmdbUrl(req, apiKey);
      if (!target) return res.status(400).json({ error: 'Requête TMDB refusée.' });
      await relayJsonProviderResponse(target, res);
    },
  );

  app.get(
    '/api/media/omdb',
    applyProviderCors,
    requireProviderAuth,
    providerRateLimit('provider-omdb', 90, 60_000),
    async (req, res) => {
      const apiKey = String(process.env.OMDB_API_KEY || '').trim();
      if (!apiKey) return res.status(503).json({ error: 'OMDb indisponible: secret serveur absent.' });
      const target = buildOmdbUrl(req, apiKey);
      if (!target) return res.status(400).json({ error: 'Requête OMDb refusée.' });
      await relayJsonProviderResponse(target, res);
    },
  );

  app.get(
    '/api/media/tvdb/franchise',
    applyProviderCors,
    requireProviderAuth,
    providerRateLimit('provider-tvdb', 30, 60_000),
    async (req, res) => {
      const apiKey = String(process.env.TVDB_API_KEY || '').trim();
      if (!apiKey) return res.status(503).json({ error: 'TVDB indisponible: secret serveur absent.' });
      const mediaType = req.query.mediaType === 'movie' ? 'movie' : 'tv';
      const rawId = asScalarQueryValue(req.query.tvdbId);
      const tvdbId = rawId && /^\d{1,12}$/.test(rawId) ? Number(rawId) : null;
      const mediaTitle = asScalarQueryValue(req.query.mediaTitle);
      if (!tvdbId && !mediaTitle) return res.status(400).json({ error: 'tvdbId ou mediaTitle requis.' });
      if (mediaTitle && mediaTitle.length > 200) return res.status(400).json({ error: 'mediaTitle invalide.' });
      try {
        const results = await getTvdbFranchiseTimelineServer({ apiKey, tvdbId, mediaTitle, mediaType });
        return res.json({ results });
      } catch (error: any) {
        const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
        return res.status(timeout ? 504 : 502).json({ error: 'TVDB momentanément indisponible.' });
      }
    },
  );
}
