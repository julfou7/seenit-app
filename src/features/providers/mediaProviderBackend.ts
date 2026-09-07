import type { Application, Request, RequestHandler } from 'express';

type Provider = 'tmdb' | 'omdb';
type Secrets = Partial<Record<'TMDB_API_KEY' | 'OMDB_API_KEY', string>>;
const REQUIRED_SECRET_NAMES = ['TMDB_API_KEY', 'OMDB_API_KEY'] as const;
interface Dependencies {
  authenticate: RequestHandler;
  fetch?: typeof fetch;
  secrets?: () => Secrets;
  now?: () => number;
  timeoutMs?: number;
}
const ORIGINS = { tmdb: 'https://api.themoviedb.org/3/', omdb: 'https://www.omdbapi.com/' };
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_CACHE_BYTES = 16 * 1024 * 1024;
const TTL = 5 * 60_000;
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

export function assertMediaProviderSecrets(secrets: Secrets = process.env): void {
  const missing = REQUIRED_SECRET_NAMES.filter(name => !secrets[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Configuration fournisseurs manquante : ${missing.join(', ')}`);
  }
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
async function readBoundedJson(response: Response, secrets: string[]): Promise<string> {
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
  const text = Buffer.concat(chunks).toString('utf8');
  let data;
  try { data = JSON.parse(text); } catch { throw new ProviderFailure(502); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ProviderFailure(502);
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
  }));
  const timeoutMs = dependencies.timeoutMs ?? 10_000;
  const buckets = new Map<string, { count: number; reset: number }>();
  const cache = new Map<string, { body: string; bytes: number; expires: number }>();
  const inFlight = new Map<string, Promise<string>>();
  let cacheBytes = 0;
  let currentSecrets: Secrets = {};
  const evict = (key: string) => {
    cacheBytes -= cache.get(key)?.bytes || 0;
    cache.delete(key);
  };

  const handler = (provider: Provider): RequestHandler => async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const uid = (req as Request & { user?: { uid?: string } }).user?.uid;
    if (!uid) { res.status(401).json({ error: 'Authentification requise.' }); return; }
    const time = now();
    for (const [key, bucket] of buckets) if (bucket.reset <= time) buckets.delete(key);
    const subject = provider + ':' + uid;
    let bucket = buckets.get(subject);
    if (!bucket) {
      if (buckets.size >= 5000) { res.status(503).json({ error: 'Service occupé.' }); return; }
      bucket = { count: 0, reset: time + 60_000 };
      buckets.set(subject, bucket);
    }
    bucket.count++;
    if (bucket.count > (provider === 'tmdb' ? 240 : 90)) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.reset - time) / 1000))));
      res.status(429).json({ error: 'Trop de requêtes, réessayez plus tard.' }); return;
    }

    const path = provider === 'tmdb' ? String(req.params[0] || '') : '';
    const target = buildProviderRequest(provider, path, req.query);
    if (!target) { res.status(400).json({ error: 'Requête métadonnées refusée.' }); return; }
    const secrets = readSecrets();
    if (secrets.TMDB_API_KEY !== currentSecrets.TMDB_API_KEY || secrets.OMDB_API_KEY !== currentSecrets.OMDB_API_KEY) {
      cache.clear(); cacheBytes = 0; inFlight.clear(); currentSecrets = { ...secrets };
    }
    const credential = secrets[provider === 'tmdb' ? 'TMDB_API_KEY' : 'OMDB_API_KEY']?.trim();
    if (!credential) { res.status(503).json({ error: 'Fournisseur non configuré.' }); return; }
    const generation = currentSecrets;
    // Clé d'opération publique, sans token Firebase ni secret fournisseur.
    const key = provider + ':' + target.pathname + target.search;
    const cached = cache.get(key);
    if (cached && cached.expires > time) {
      cache.delete(key); cache.set(key, cached);
      res.type('json').send(cached.body); return;
    }
    if (cached) evict(key);
    let pending = inFlight.get(key);
    if (!pending) {
      if (inFlight.size >= 48) {
        res.setHeader('Retry-After', '1');
        res.status(429).json({ error: 'Service occupé, réessayez.' }); return;
      }
      target.searchParams.set(provider === 'tmdb' ? 'api_key' : 'apikey', credential);
      pending = (async () => {
        const upstream = await request(target, {
          method: 'GET', headers: { Accept: 'application/json' },
          redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        });
        if (!upstream.ok) {
          await upstream.body?.cancel();
          throw new ProviderFailure(upstream.status === 404 ? 404 : upstream.status === 429 ? 429 : 502);
        }
        const body = await readBoundedJson(upstream, [(secrets.TMDB_API_KEY || '').trim(), (secrets.OMDB_API_KEY || '').trim()]);
        if (generation === currentSecrets) {
          const bytes = Buffer.byteLength(body);
          while (cache.size >= 200 || cacheBytes + bytes > MAX_CACHE_BYTES) evict(cache.keys().next().value!);
          cache.set(key, { body, bytes, expires: now() + TTL });
          cacheBytes += bytes;
        }
        return body;
      })();
      inFlight.set(key, pending);
    }
    try {
      const body = await pending;
      res.type('json').send(body);
    } catch (error) {
      const status = error instanceof ProviderFailure ? error.status
        : error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name) ? 504 : 502;
      if (status === 429) res.setHeader('Retry-After', '60');
      res.status(status).json({ error: status === 504 ? 'Le fournisseur ne répond pas à temps.' : 'Métadonnées indisponibles, réessayez.' });
    } finally {
      if (inFlight.get(key) === pending) inFlight.delete(key);
    }
  };

  app.get('/api/media/tmdb/*', dependencies.authenticate, handler('tmdb'));
  app.get('/api/media/omdb', dependencies.authenticate, handler('omdb'));
  app.all('/api/media/*', dependencies.authenticate, (_req, res) => res.status(404).json({ error: 'Opération inconnue.' }));
}
