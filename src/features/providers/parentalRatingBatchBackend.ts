import type { Application, Request, RequestHandler } from 'express';
import { emitOperationalEvent } from '../runtime/operationalEvent.ts';

type MediaType = 'movie' | 'tv';
type Secrets = Partial<Record<'TMDB_API_KEY' | 'TVDB_API_KEY', string>>;

interface Dependencies {
  authenticate: RequestHandler;
  fetch?: typeof fetch;
  secrets?: () => Secrets;
  now?: () => number;
  timeoutMs?: number;
  stallBurstMs?: number;
  readPersisted?: (keys: string[]) => Promise<Map<string, any>>;
  writePersisted?: (entries: Array<{ key: string; details: any }>) => Promise<void>;
}

interface ParentalBatchItem {
  mediaType: MediaType;
  id: number;
  key: string;
}

const TMDB_ORIGIN = 'https://api.themoviedb.org/3/';
export const PARENTAL_BATCH_MAX_ITEMS = 40;
export const PARENTAL_BATCH_MAX_CONCURRENT = 24;
export const PARENTAL_BATCH_STALL_BURST_CONCURRENT = PARENTAL_BATCH_MAX_ITEMS;
export const PARENTAL_BATCH_STALL_BURST_MS = 1_000;
export const PARENTAL_BATCH_ITEM_BUDGET_PER_MINUTE = 240;
export const PARENTAL_BATCH_PROVIDER_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const PARENTAL_BATCH_PROVIDER_CACHE_MAX_ENTRIES = 5_000;
const MAX_PARENTAL_RESPONSE_BYTES = 256 * 1024;

function parseBatchItems(raw: unknown): ParentalBatchItem[] | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 1024) return null;
  const parts = raw.split(',');
  if (parts.length === 0 || parts.length > PARENTAL_BATCH_MAX_ITEMS) return null;

  const seen = new Set<string>();
  const items: ParentalBatchItem[] = [];
  for (const part of parts) {
    const match = part.match(/^(movie|tv):([1-9]\d{0,12})$/);
    if (!match) return null;
    const mediaType = match[1] as MediaType;
    const id = Number(match[2]);
    const key = `${mediaType}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ mediaType, id, key });
  }
  return items.length > 0 ? items : null;
}

function compactParentalDetails(item: ParentalBatchItem, payload: any): any {
  if (item.mediaType === 'movie') {
    const results = Array.isArray(payload?.results)
      ? payload.results
          .filter((entry: any) => entry?.iso_3166_1 === 'US')
          .map((entry: any) => ({
            iso_3166_1: 'US',
            release_dates: Array.isArray(entry?.release_dates)
              ? entry.release_dates.map((release: any) => ({
                  certification: String(release?.certification ?? '').trim(),
                }))
              : [],
          }))
      : [];
    return { id: item.id, media_type: item.mediaType, release_dates: { results } };
  }

  const results = Array.isArray(payload?.results)
    ? payload.results
        .filter((entry: any) => entry?.iso_3166_1 === 'US')
        .map((entry: any) => ({
          iso_3166_1: 'US',
          rating: String(entry?.rating ?? '').trim(),
        }))
    : [];
  return { id: item.id, media_type: item.mediaType, content_ratings: { results } };
}

async function readJsonResponse(response: Response): Promise<any | null> {
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!/^application\/(?:[\w.+-]*\+)?json(?:;|$)/i.test(response.headers.get('content-type') || '')) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_PARENTAL_RESPONSE_BYTES) return null;
  try {
    const payload = JSON.parse(text);
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
  } catch {
    return null;
  }
}

export function registerParentalRatingBatchRoute(app: Application, dependencies: Dependencies): void {
  const request = dependencies.fetch || fetch;
  const now = dependencies.now || Date.now;
  const timeoutMs = dependencies.timeoutMs ?? 10_000;
  const stallBurstMs = dependencies.stallBurstMs ?? PARENTAL_BATCH_STALL_BURST_MS;
  const readSecrets = dependencies.secrets || (() => ({
    TMDB_API_KEY: process.env.TMDB_API_KEY,
    TVDB_API_KEY: process.env.TVDB_API_KEY,
  }));
  const budgets = new Map<string, { used: number; resetAt: number }>();
  const providerCache = new Map<string, { details: any; expiresAt: number }>();
  let providerCacheCredential = '';

  const readProviderCache = (key: string): any | null => {
    const current = now();
    const entry = providerCache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= current) {
      providerCache.delete(key);
      return null;
    }
    providerCache.delete(key);
    providerCache.set(key, entry);
    return entry.details;
  };
  const writeProviderCache = (key: string, details: any) => {
    providerCache.delete(key);
    providerCache.set(key, { details, expiresAt: now() + PARENTAL_BATCH_PROVIDER_CACHE_TTL_MS });
    while (providerCache.size > PARENTAL_BATCH_PROVIDER_CACHE_MAX_ENTRIES) {
      providerCache.delete(providerCache.keys().next().value!);
    }
  };

  const takeBudget = (uid: string, cost: number): { ok: true } | { ok: false; retryAfter: number } => {
    const time = now();
    for (const [key, bucket] of budgets) if (bucket.resetAt <= time) budgets.delete(key);
    let bucket = budgets.get(uid);
    if (!bucket) {
      bucket = { used: 0, resetAt: time + 60_000 };
      budgets.set(uid, bucket);
    }
    if (bucket.used + cost > PARENTAL_BATCH_ITEM_BUDGET_PER_MINUTE) {
      return { ok: false, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - time) / 1000)) };
    }
    bucket.used += cost;
    return { ok: true };
  };

  app.get('/api/media/parental-ratings', dependencies.authenticate, async (req: Request & { user?: { uid?: string } }, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const uid = req.user?.uid;
    if (!uid) {
      res.status(401).json({ error: 'Authentification requise.' });
      return;
    }
    if (Object.keys(req.query).some(key => key !== 'items' && key !== 'stream')) {
      res.status(400).json({ error: 'Requête de classifications refusée.' });
      return;
    }
    const stream = req.query.stream === '1';
    if (req.query.stream !== undefined && !stream) {
      res.status(400).json({ error: 'Requête de classifications refusée.' });
      return;
    }

    const items = parseBatchItems(req.query.items);
    if (!items) {
      res.status(400).json({ error: 'Requête de classifications refusée.' });
      return;
    }
    const persistedByKey = dependencies.readPersisted
      ? await dependencies.readPersisted(items.map(item => item.key)).catch(() => new Map<string, any>())
      : new Map<string, any>();
    for (const [key, details] of persistedByKey) writeProviderCache(key, details);
    const misses = items.filter(item => !readProviderCache(item.key));

    const budget = takeBudget(uid, misses.length);
    if ('retryAfter' in budget) {
      res.setHeader('Retry-After', String(budget.retryAfter));
      res.status(429).json({ error: 'Trop de classifications demandées, réessayez plus tard.' });
      return;
    }

    const credential = misses.length > 0 ? readSecrets().TMDB_API_KEY?.trim() : '';
    if (misses.length > 0 && !credential) {
      res.status(503).json({ error: 'Fournisseur non configuré.' });
      return;
    }
    if (credential && providerCacheCredential !== credential) {
      providerCacheCredential = credential;
      for (const item of misses) providerCache.delete(item.key);
    }

    const newlyResolved = new Map<string, any>();
    let providerFailureCount = 0;
    const emitProviderFailures = () => {
      if (providerFailureCount <= 0) return;
      emitOperationalEvent({
        code: 'PARENTAL_RATING_PROVIDER_FAILED',
        context: { count: providerFailureCount },
        domain: 'providers',
        level: 'warn'
      });
    };
    const persistNewEvidence = async () => {
      if (!dependencies.writePersisted || newlyResolved.size === 0) return;
      await dependencies.writePersisted(
        [...newlyResolved.entries()].map(([key, details]) => ({ key, details })),
      ).catch(() => undefined);
    };

    const clientAbort = new AbortController();
    let responseFinished = false;
    if (typeof (res as any).once === 'function') {
      res.once('finish', () => { responseFinished = true; });
      res.once('close', () => {
        if (!responseFinished) {
          clientAbort.abort();
        }
      });
    }

    let active = 0;
    type Waiter = { granted: boolean; resolve: () => void; timer: ReturnType<typeof setTimeout> | null };
    const waiters: Waiter[] = [];

    const grant = (waiter: Waiter): boolean => {
      if (waiter.granted) return false;
      waiter.granted = true;
      if (waiter.timer !== null) clearTimeout(waiter.timer);
      waiter.timer = null;
      const index = waiters.indexOf(waiter);
      if (index >= 0) waiters.splice(index, 1);
      active += 1;
      waiter.resolve();
      return true;
    };
    const grantSteadySlots = () => {
      while (active < PARENTAL_BATCH_MAX_CONCURRENT && waiters.length > 0) {
        if (!grant(waiters[0])) waiters.shift();
      }
    };
    const acquire = async () => {
      if (active < PARENTAL_BATCH_MAX_CONCURRENT) {
        active += 1;
          return;
      }
      await new Promise<void>(resolve => {
        const waiter: Waiter = { granted: false, resolve, timer: null };
        waiter.timer = setTimeout(() => {
          if (!waiter.granted && active < PARENTAL_BATCH_STALL_BURST_CONCURRENT) {
            grant(waiter);
          }
        }, stallBurstMs);
        waiters.push(waiter);
      });
    };
    const runBounded = async <T>(task: () => Promise<T>): Promise<T> => {
      await acquire();
      try { return await task(); }
      finally { active -= 1; grantSteadySlots(); }
    };

    const resolveItem = async (item: ParentalBatchItem) => {
      const cachedDetails = readProviderCache(item.key);
      if (cachedDetails) return { key: item.key, media_type: item.mediaType, id: item.id, details: cachedDetails };
      return runBounded(async () => {
        const endpoint = item.mediaType === 'movie' ? 'release_dates' : 'content_ratings';
        const target = new URL(`${item.mediaType}/${item.id}/${endpoint}`, TMDB_ORIGIN);
        target.searchParams.set('api_key', credential);
        let details: any | null = null;
        try {
          const response = await request(target, {
            method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error',
            signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), clientAbort.signal]),
          });
          const payload = await readJsonResponse(response);
          if (payload) {
            details = compactParentalDetails(item, payload);
            writeProviderCache(item.key, details);
            newlyResolved.set(item.key, details);
          }
        } catch { /* fournisseur indisponible : fail-closed */ }
        if (!details && !clientAbort.signal.aborted) providerFailureCount += 1;
        return { key: item.key, media_type: item.mediaType, id: item.id, details };
      });
    };

    if (stream) {
      res.status(200);
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.flushHeaders?.();
      await Promise.all(items.map(async item => {
        const result = await resolveItem(item);
        if (!clientAbort.signal.aborted && !res.destroyed) res.write(`${JSON.stringify(result)}\n`);
      }));
      await persistNewEvidence();
      emitProviderFailures();
      if (!res.destroyed) res.end();
      return;
    }

    const results = await Promise.all(items.map(item => resolveItem(item)));
    await persistNewEvidence();
    emitProviderFailures();
    if (!clientAbort.signal.aborted && !res.destroyed) res.json({ results });
  });
}
