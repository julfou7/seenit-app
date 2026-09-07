import type { Application, Request, RequestHandler } from 'express';

type Provider = 'tmdb' | 'omdb';
type Secrets = Partial<Record<'TMDB_API_KEY' | 'OMDB_API_KEY' | 'TVDB_API_KEY', string>>;
const REQUIRED_SECRET_NAMES = ['TMDB_API_KEY', 'OMDB_API_KEY'] as const;
interface Dependencies {
  authenticate: RequestHandler;
  fetch?: typeof fetch;
  secrets?: () => Secrets;
  now?: () => number;
  timeoutMs?: number;
}
const ORIGINS = { tmdb: 'https://api.themoviedb.org/3/', omdb: 'https://www.omdbapi.com/' };
const TVDB_ORIGIN = 'https://api4.thetvdb.com/v4/';
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_CACHE_BYTES = 16 * 1024 * 1024;
const TTL = 5 * 60_000;
const TVDB_TOKEN_TTL = 23 * 60 * 60_000;
const TVDB_RELATION_CACHE_MAX = 120;
const TMDB_PATHS = [
  /^search\/(movie|tv|multi|person)$/,
  /^find\/(tt\d{5,12}|[1-9]\d{0,12})$/,
  /^(movie|tv)\/[1-9]\d{0,12}(\/(watch\/providers|keywords|recommendations|similar|external_ids|credits|images|videos|release_dates|content_ratings))?$/,
  /^tv\/[1-9]\d{0,12}\/season\/\d{1,4}(\/episode\/\d{1,5})?$/,
  /^collection\/[1-9]\d{0,12}$/,
  /^discover\/(movie|tv)$/,
  /^trending\/(all|movie|tv|person)\/(day|week)$/,
  /^person\/(popular|[1-9]\d{0,12}(\/combined_credits)?)$/,
];
const TMDB_QUERY = new Set([
  'query', 'language', 'page', 'external_source', 'primary_release_year', 'year',
  'append_to_response', 'include_video_language', 'include_image_language',
  'include_adult', 'region', 'sort_by', 'vote_count.gte', 'vote_average.gte',
  'vote_average.lte', 'primary_release_date.gte', 'primary_release_date.lte',
  'first_air_date.gte', 'first_air_date.lte', 'release_date.gte', 'release_date.lte',
  'with_genres', 'without_genres', 'watch_region', 'with_watch_providers',
  'with_watch_monetization_types', 'with_people', 'with_cast', 'with_release_type',
  'certification_country', 'certification.lte', 'certification.gte', 'with_original_language',
]);
const APPEND = new Set([
  'external_ids', 'credits', 'aggregate_credits', 'images', 'videos', 'keywords',
  'recommendations', 'similar', 'release_dates', 'content_ratings', 'watch/providers',
]);
const OMDB_QUERY = new Set(['i', 'Season']);
const TMDB_REMOTE_SOURCE_NAMES = new Set(['themoviedb.com', 'themoviedb', 'tmdb']);

export type TVDBRelationKind = 'franchise' | 'universe';
export interface TVDBFranchiseItem { id: number; media_type: 'tv' | 'movie'; }
interface TVDBAttachedList { id?: number | string; isOfficial?: boolean; name?: string; nameTranslated?: string; }
interface TVDBListEntity {
  seriesId?: number | string;
  movieId?: number | string;
  series?: { id?: number | string };
  movie?: { id?: number | string };
}
interface TVDBRemoteId { id?: number | string; type?: number | string; sourceName?: string; }

const positiveInteger = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

export function classifyTVDBList(list: unknown): TVDBRelationKind | null {
  if (!list || typeof list !== 'object') return null;
  const candidate = list as TVDBAttachedList;
  const label = String(candidate.nameTranslated || candidate.name || '').trim().toLowerCase();
  if (/\buniverse\b/.test(label)) return 'universe';
  if (/\bfranchise\b/.test(label)) return 'franchise';
  return null;
}

export function selectSingleOfficialTVDBList(lists: unknown): TVDBAttachedList | null {
  if (!Array.isArray(lists)) return null;
  const admissible = lists.filter((list): list is TVDBAttachedList => {
    if (!list || typeof list !== 'object') return false;
    const candidate = list as TVDBAttachedList;
    return candidate.isOfficial === true
      && positiveInteger(candidate.id) !== null
      && classifyTVDBList(candidate) !== null;
  });
  return admissible.length === 1 ? admissible[0] : null;
}

export function getTVDBEntityIdentity(entity: unknown): { id: number; media_type: 'tv' | 'movie' } | null {
  if (!entity || typeof entity !== 'object') return null;
  const candidate = entity as TVDBListEntity;
  const seriesId = positiveInteger(candidate.seriesId ?? candidate.series?.id);
  const movieId = positiveInteger(candidate.movieId ?? candidate.movie?.id);
  if ((seriesId === null) === (movieId === null)) return null;
  return seriesId !== null ? { id: seriesId, media_type: 'tv' } : { id: movieId as number, media_type: 'movie' };
}

export function extractExactTMDBRemoteId(remoteIds: unknown): number | null {
  if (!Array.isArray(remoteIds)) return null;
  const matches = new Set<number>();
  for (const remote of remoteIds as TVDBRemoteId[]) {
    if (!remote || typeof remote !== 'object') continue;
    const sourceType = Number(remote.type);
    const sourceName = String(remote.sourceName || '').trim().toLowerCase();
    if (sourceType !== 12 && !TMDB_REMOTE_SOURCE_NAMES.has(sourceName)) continue;
    const id = positiveInteger(remote.id);
    if (id !== null) matches.add(id);
  }
  return matches.size === 1 ? [...matches][0] : null;
}

export function extractExactTVDBSearchIdentity(results: unknown, mediaType: 'tv' | 'movie'): number | null {
  if (!Array.isArray(results)) return null;
  const matches = new Set<number>();
  for (const result of results as any[]) {
    if (!result || typeof result !== 'object') continue;
    const nested = mediaType === 'movie' ? result.movie?.id : result.series?.id;
    let id = positiveInteger(nested);
    const resultType = String(result.type || '').toLowerCase();
    const expected = mediaType === 'movie' ? 'movie' : 'series';
    if (id === null && resultType === expected) id = positiveInteger(result.tvdb_id ?? result.tvdbId ?? result.id);
    if (id !== null) matches.add(id);
  }
  return matches.size === 1 ? [...matches][0] : null;
}

export function assertMediaProviderSecrets(secrets: Secrets = process.env): void {
  const missing = REQUIRED_SECRET_NAMES.filter(name => !secrets[name]?.trim());
  if (missing.length > 0) throw new Error(`Configuration fournisseurs manquante : ${missing.join(', ')}`);
}

export function buildProviderRequest(provider: Provider, path: string, query: Request['query']): URL | null {
  if (path.length > 160 || (provider === 'tmdb' && !TMDB_PATHS.some(rule => rule.test(path)))) return null;
  if (provider === 'omdb' && path !== '') return null;
  const url = new URL(path, ORIGINS[provider]);
  const allowed = provider === 'tmdb' ? TMDB_QUERY : OMDB_QUERY;
  if (Object.keys(query).length > 30) return null;
  for (const [key, value] of Object.entries(query)) {
    if (!allowed.has(key) || typeof value !== 'string' || value.length > 2048) return null;
    if (key === 'page' && (!/^[1-9]\d{0,2}$/.test(value) || Number(value) > 500)) return null;
    if (key === 'append_to_response' && !value.split(',').every(part => APPEND.has(part))) return null;
    if (key === 'external_source' && !['imdb_id', 'tvdb_id'].includes(value)) return null;
    url.searchParams.set(key, value);
  }
  if (provider === 'tmdb' && path.startsWith('find/') && !url.searchParams.has('external_source')) return null;
  if (provider === 'omdb') {
    if (!/^tt\d{5,12}$/.test(url.searchParams.get('i') || '')) return null;
    const season = url.searchParams.get('Season');
    if (season !== null && !/^\d{1,3}$/.test(season)) return null;
  }
  url.searchParams.sort();
  return url;
}

class ProviderFailure extends Error {
  readonly status: number;
  constructor(status: number) { super('MEDIA_PROVIDER_FAILED'); this.status = status; }
}

async function readJsonBody(response: Response): Promise<any> {
  if (!/^application\/(?:[\w.+-]*\+)?json(?:;|$)/i.test(response.headers.get('content-type') || '')) {
    await response.body?.cancel();
    throw new ProviderFailure(502);
  }
  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_RESPONSE_BYTES || !response.body) {
    await response.body?.cancel();
    throw new ProviderFailure(502);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new ProviderFailure(502);
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('shape');
    return data;
  } catch {
    throw new ProviderFailure(502);
  }
}

async function readBoundedJson(response: Response, secrets: string[]): Promise<string> {
  const data = await readJsonBody(response);
  const canonical = JSON.stringify(data);
  if (secrets.some(secret => secret && (canonical.includes(secret) || canonical.includes(encodeURIComponent(secret))))
      || /"(api_key|apikey|access_token|authorization|token)"\s*:/i.test(canonical)) throw new ProviderFailure(502);
  if (data.Response === 'False' || data.success === false || data.status_code) throw new ProviderFailure(502);
  return canonical;
}

/** Authentification injectée depuis server.ts : ce module pur ne charge pas Firebase Admin. */
export function registerMediaProviderRoutes(app: Application, dependencies: Dependencies): void {
  const request = dependencies.fetch || fetch;
  const now = dependencies.now || Date.now;
  const readSecrets = dependencies.secrets || (() => ({
    TMDB_API_KEY: process.env.TMDB_API_KEY,
    OMDB_API_KEY: process.env.OMDB_API_KEY,
    TVDB_API_KEY: process.env.TVDB_API_KEY,
  }));
  const timeoutMs = dependencies.timeoutMs ?? 10_000;
  const buckets = new Map<string, { count: number; reset: number }>();
  const cache = new Map<string, { body: string; bytes: number; expires: number }>();
  const inFlight = new Map<string, Promise<string>>();
  const tvdbRelationCache = new Map<string, { value: { kind: TVDBRelationKind; results: TVDBFranchiseItem[] } | null; expires: number }>();
  let tvdbToken: { value: string; expires: number; apiKey: string } | null = null;
  let cacheBytes = 0;
  let currentSecrets: Secrets = {};
  const evict = (key: string) => { cacheBytes -= cache.get(key)?.bytes || 0; cache.delete(key); };

  const takeQuota = (provider: 'tmdb' | 'omdb' | 'tvdb', uid: string, limit: number, res: any): boolean => {
    const time = now();
    for (const [key, bucket] of buckets) if (bucket.reset <= time) buckets.delete(key);
    const subject = `${provider}:${uid}`;
    let bucket = buckets.get(subject);
    if (!bucket) {
      if (buckets.size >= 5000) { res.status(503).json({ error: 'Service occupé.' }); return false; }
      bucket = { count: 0, reset: time + 60_000 };
      buckets.set(subject, bucket);
    }
    bucket.count++;
    if (bucket.count > limit) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.reset - time) / 1000))));
      res.status(429).json({ error: 'Trop de requêtes, réessayez plus tard.' });
      return false;
    }
    return true;
  };

  const syncSecrets = () => {
    const secrets = readSecrets();
    if (secrets.TMDB_API_KEY !== currentSecrets.TMDB_API_KEY
      || secrets.OMDB_API_KEY !== currentSecrets.OMDB_API_KEY
      || secrets.TVDB_API_KEY !== currentSecrets.TVDB_API_KEY) {
      cache.clear(); cacheBytes = 0; inFlight.clear(); tvdbRelationCache.clear(); tvdbToken = null; currentSecrets = { ...secrets };
    }
    return secrets;
  };

  const handler = (provider: Provider): RequestHandler => async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const uid = (req as Request & { user?: { uid?: string } }).user?.uid;
    if (!uid) { res.status(401).json({ error: 'Authentification requise.' }); return; }
    if (!takeQuota(provider, uid, provider === 'tmdb' ? 240 : 90, res)) return;

    const path = provider === 'tmdb' ? String(req.params[0] || '') : '';
    const target = buildProviderRequest(provider, path, req.query);
    if (!target) { res.status(400).json({ error: 'Requête métadonnées refusée.' }); return; }
    const secrets = syncSecrets();
    const credential = secrets[provider === 'tmdb' ? 'TMDB_API_KEY' : 'OMDB_API_KEY']?.trim();
    if (!credential) { res.status(503).json({ error: 'Fournisseur non configuré.' }); return; }
    const generation = currentSecrets;
    const key = provider + ':' + target.pathname + target.search;
    const time = now();
    const cached = cache.get(key);
    if (cached && cached.expires > time) { cache.delete(key); cache.set(key, cached); res.type('json').send(cached.body); return; }
    if (cached) evict(key);
    let pending = inFlight.get(key);
    if (!pending) {
      if (inFlight.size >= 48) { res.setHeader('Retry-After', '1'); res.status(429).json({ error: 'Service occupé, réessayez.' }); return; }
      target.searchParams.set(provider === 'tmdb' ? 'api_key' : 'apikey', credential);
      pending = (async () => {
        const upstream = await request(target, { method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
        if (!upstream.ok) {
          await upstream.body?.cancel();
          throw new ProviderFailure(upstream.status === 404 ? 404 : upstream.status === 429 ? 429 : 502);
        }
        const body = await readBoundedJson(upstream, [(secrets.TMDB_API_KEY || '').trim(), (secrets.OMDB_API_KEY || '').trim(), (secrets.TVDB_API_KEY || '').trim()]);
        if (generation === currentSecrets) {
          const bytes = Buffer.byteLength(body);
          while (cache.size >= 200 || cacheBytes + bytes > MAX_CACHE_BYTES) evict(cache.keys().next().value!);
          cache.set(key, { body, bytes, expires: now() + TTL }); cacheBytes += bytes;
        }
        return body;
      })();
      inFlight.set(key, pending);
    }
    try { res.type('json').send(await pending); }
    catch (error) {
      const status = error instanceof ProviderFailure ? error.status : error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name) ? 504 : 502;
      if (status === 429) res.setHeader('Retry-After', '60');
      res.status(status).json({ error: status === 504 ? 'Le fournisseur ne répond pas à temps.' : 'Métadonnées indisponibles, réessayez.' });
    } finally { if (inFlight.get(key) === pending) inFlight.delete(key); }
  };

  const tvdbRequest = async (path: string, token: string): Promise<any | null> => {
    const target = new URL(path.replace(/^\/+/, ''), TVDB_ORIGIN);
    const upstream = await request(target, { method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
    if (!upstream.ok) { await upstream.body?.cancel(); return null; }
    return readJsonBody(upstream);
  };

  const getTVDBToken = async (apiKey: string): Promise<string | null> => {
    if (tvdbToken && tvdbToken.apiKey === apiKey && tvdbToken.expires > now()) return tvdbToken.value;
    const target = new URL('login', TVDB_ORIGIN);
    const upstream = await request(target, {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ apikey: apiKey }), redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
    });
    if (!upstream.ok) { await upstream.body?.cancel(); return null; }
    const payload = await readJsonBody(upstream);
    const token = typeof payload?.data?.token === 'string' ? payload.data.token.trim() : '';
    if (!token) return null;
    tvdbToken = { value: token, expires: now() + TVDB_TOKEN_TTL, apiKey };
    return token;
  };

  const resolveTVDBRelation = async (
    apiKey: string,
    tvdbId: number | null,
    imdbId: string | null,
    mediaType: 'tv' | 'movie',
  ): Promise<{ kind: TVDBRelationKind; results: TVDBFranchiseItem[] } | null> => {
    const token = await getTVDBToken(apiKey);
    if (!token) return null;
    let exactTVDBId = tvdbId;
    if (exactTVDBId === null && imdbId) {
      const search = await tvdbRequest(`search/remoteid/${encodeURIComponent(imdbId)}`, token);
      exactTVDBId = extractExactTVDBSearchIdentity(search?.data, mediaType);
    }
    if (exactTVDBId === null) return null;

    const mediaEndpoint = mediaType === 'movie' ? `movies/${exactTVDBId}/extended` : `series/${exactTVDBId}/extended`;
    const mediaPayload = await tvdbRequest(mediaEndpoint, token);
    const selected = selectSingleOfficialTVDBList(mediaPayload?.data?.lists);
    const listId = positiveInteger(selected?.id);
    const kind = classifyTVDBList(selected);
    if (listId === null || kind === null) return null;

    const listPayload = await tvdbRequest(`lists/${listId}/extended`, token);
    const entities = Array.isArray(listPayload?.data?.entities) ? listPayload.data.entities.slice(0, 120) : [];
    if (entities.length < 2) return null;
    if (!entities.some((entity: unknown) => {
      const identity = getTVDBEntityIdentity(entity);
      return identity?.id === exactTVDBId && identity.media_type === mediaType;
    })) return null;

    const results: TVDBFranchiseItem[] = [];
    for (let index = 0; index < entities.length; index += 6) {
      const batch = await Promise.all(entities.slice(index, index + 6).map(async (entity: unknown) => {
        const identity = getTVDBEntityIdentity(entity);
        if (!identity) return null;
        const payload = await tvdbRequest(`${identity.media_type === 'movie' ? 'movies' : 'series'}/${identity.id}/extended`, token);
        const tmdbId = extractExactTMDBRemoteId(payload?.data?.remoteIds);
        return tmdbId === null ? null : { id: tmdbId, media_type: identity.media_type } as TVDBFranchiseItem;
      }));
      for (const item of batch) if (item) results.push(item);
    }
    const seen = new Set<string>();
    const unique = results.filter(item => {
      const key = `${item.media_type}:${item.id}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
    return unique.length > 1 ? { kind, results: unique } : null;
  };

  const tvdbHandler: RequestHandler = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const uid = (req as Request & { user?: { uid?: string } }).user?.uid;
    if (!uid) { res.status(401).json({ error: 'Authentification requise.' }); return; }
    if (!takeQuota('tvdb', uid, 30, res)) return;
    const mediaType = req.query.mediaType === 'movie' ? 'movie' : req.query.mediaType === 'tv' ? 'tv' : null;
    const tvdbRaw = typeof req.query.tvdbId === 'string' ? req.query.tvdbId : '';
    const imdbRaw = typeof req.query.imdbId === 'string' ? req.query.imdbId.trim() : '';
    const tvdbId = /^\d{1,12}$/.test(tvdbRaw) ? positiveInteger(tvdbRaw) : null;
    const imdbId = /^tt\d{5,12}$/i.test(imdbRaw) ? imdbRaw : null;
    if (!mediaType || (tvdbId === null && imdbId === null)
      || (tvdbRaw && tvdbId === null) || (imdbRaw && imdbId === null)
      || Object.keys(req.query).some(key => !['mediaType', 'tvdbId', 'imdbId'].includes(key))) {
      res.status(400).json({ error: 'Requête TVDB refusée.' }); return;
    }
    const secrets = syncSecrets();
    const apiKey = secrets.TVDB_API_KEY?.trim();
    if (!apiKey) { res.status(503).json({ error: 'Fournisseur non configuré.' }); return; }
    const key = `${mediaType}:${tvdbId || ''}:${imdbId || ''}`;
    const cached = tvdbRelationCache.get(key);
    if (cached && cached.expires > now()) {
      const value = cached.value;
      res.json(value ? { kind: value.kind, results: value.results } : { kind: null, results: [] }); return;
    }
    try {
      const value = await resolveTVDBRelation(apiKey, tvdbId, imdbId, mediaType);
      tvdbRelationCache.delete(key);
      tvdbRelationCache.set(key, { value, expires: now() + TTL });
      while (tvdbRelationCache.size > TVDB_RELATION_CACHE_MAX) tvdbRelationCache.delete(tvdbRelationCache.keys().next().value!);
      res.json(value ? { kind: value.kind, results: value.results } : { kind: null, results: [] });
    } catch (error) {
      const status = error instanceof ProviderFailure ? error.status : error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name) ? 504 : 502;
      res.status(status).json({ error: status === 504 ? 'Le fournisseur ne répond pas à temps.' : 'Métadonnées indisponibles, réessayez.' });
    }
  };

  app.get('/api/media/tmdb/*', dependencies.authenticate, handler('tmdb'));
  app.get('/api/media/omdb', dependencies.authenticate, handler('omdb'));
  app.get('/api/media/tvdb/franchise', dependencies.authenticate, tvdbHandler);
  app.all('/api/media/*', dependencies.authenticate, (_req, res) => res.status(404).json({ error: 'Opération inconnue.' }));
}
