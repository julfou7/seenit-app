import type { Application, Request, RequestHandler } from 'express';
import { emitOperationalEvent } from '../runtime/operationalEvent.ts';

/**
 * #853 — Diffuseurs groupés : une requête authentifiée par écran d'Explorer au lieu d'une par carte.
 * Chaque titre est lu sur `{type}/{id}/watch/providers` de TMDB (concurrence bornée), réduit à la région FR
 * (seule lue par l'app) et mis en cache 6 h par instance. Une erreur fournisseur n'est jamais mise en cache :
 * l'entrée revient `null` et le client la redemande seule.
 */
type MediaType = 'movie' | 'tv';
type UnknownRecord = Record<string, unknown>;

interface Dependencies {
  authenticate: RequestHandler;
  fetch?: typeof fetch;
  secrets?: () => Partial<Record<'TMDB_API_KEY', string>>;
  now?: () => number;
  timeoutMs?: number;
}

interface BatchItem { mediaType: MediaType; id: number; key: string }

const TMDB_ORIGIN = 'https://api.themoviedb.org/3/';
export const WATCH_PROVIDER_BATCH_MAX_ITEMS = 40;
export const WATCH_PROVIDER_BATCH_MAX_CONCURRENT = 8;
export const WATCH_PROVIDER_BATCH_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
export const WATCH_PROVIDER_BATCH_CACHE_MAX_ENTRIES = 5_000;
export const WATCH_PROVIDER_BATCH_ITEM_BUDGET_PER_MINUTE = 600;
const MAX_RESPONSE_BYTES = 512 * 1024;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as UnknownRecord : null;
}

export function parseWatchProviderBatchItems(raw: unknown): BatchItem[] | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 1024) return null;
  const parts = raw.split(',');
  if (parts.length > WATCH_PROVIDER_BATCH_MAX_ITEMS) return null;
  const seen = new Set<string>();
  const items: BatchItem[] = [];
  for (const part of parts) {
    const match = part.match(/^(movie|tv):([1-9]\d{0,12})$/);
    if (!match) return null;
    const key = `${match[1]}:${match[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ mediaType: match[1] as MediaType, id: Number(match[2]), key });
  }
  return items.length > 0 ? items : null;
}

/** Réponse TMDB réduite à la France : `{ id, results: { FR } }` (ou `results: {}` sans offre française). */
export function compactWatchProviders(item: BatchItem, payload: unknown): UnknownRecord {
  const results = asRecord(asRecord(payload)?.results);
  const fr = asRecord(results?.FR);
  return { id: item.id, results: fr ? { FR: fr } : {} };
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok || !/^application\/(?:[\w.+-]*\+)?json(?:;|$)/i.test(response.headers.get('content-type') || '')) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) return null;
  try { return JSON.parse(text); } catch { return null; }
}

export function registerWatchProviderBatchRoute(app: Application, dependencies: Dependencies): void {
  const request = dependencies.fetch || fetch;
  const now = dependencies.now || Date.now;
  const timeoutMs = dependencies.timeoutMs ?? 8_000;
  const readSecrets = dependencies.secrets || (() => ({ TMDB_API_KEY: process.env.TMDB_API_KEY }));
  const cache = new Map<string, { data: UnknownRecord; expiresAt: number }>();
  const budgets = new Map<string, { used: number; resetAt: number }>();

  const readCache = (key: string): UnknownRecord | null => {
    const entry = cache.get(key);
    if (!entry) return null;
    cache.delete(key);
    if (entry.expiresAt <= now()) return null;
    cache.set(key, entry);
    return entry.data;
  };
  const writeCache = (key: string, data: UnknownRecord) => {
    cache.delete(key);
    cache.set(key, { data, expiresAt: now() + WATCH_PROVIDER_BATCH_CACHE_TTL_MS });
    while (cache.size > WATCH_PROVIDER_BATCH_CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  };
  const takeBudget = (uid: string, cost: number): number | null => {
    const time = now();
    for (const [key, bucket] of budgets) if (bucket.resetAt <= time) budgets.delete(key);
    const bucket = budgets.get(uid) || { used: 0, resetAt: time + 60_000 };
    budgets.set(uid, bucket);
    if (bucket.used + cost > WATCH_PROVIDER_BATCH_ITEM_BUDGET_PER_MINUTE) return Math.max(1, Math.ceil((bucket.resetAt - time) / 1000));
    bucket.used += cost;
    return null;
  };

  app.get('/api/media/watch-providers', dependencies.authenticate, async (req: Request & { user?: { uid?: string } }, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const uid = req.user?.uid;
    if (!uid) { res.status(401).json({ error: 'Authentification requise.' }); return; }
    const items = Object.keys(req.query).every(key => key === 'items') ? parseWatchProviderBatchItems(req.query.items) : null;
    if (!items) { res.status(400).json({ error: 'Requête de diffuseurs refusée.' }); return; }

    const misses = items.filter(item => !readCache(item.key));
    const retryAfter = takeBudget(uid, misses.length);
    if (retryAfter !== null) {
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({ error: 'Trop de diffuseurs demandés, réessayez plus tard.' });
      return;
    }
    const credential = misses.length > 0 ? readSecrets().TMDB_API_KEY?.trim() : '';
    if (misses.length > 0 && !credential) { res.status(503).json({ error: 'Fournisseur non configuré.' }); return; }

    const clientAbort = new AbortController();
    res.once('close', () => { if (!res.writableFinished) clientAbort.abort(); });
    let failures = 0;
    let next = 0;
    const fetchOne = async (item: BatchItem): Promise<void> => {
      const target = new URL(`${item.mediaType}/${item.id}/watch/providers`, TMDB_ORIGIN);
      target.searchParams.set('api_key', credential || '');
      try {
        const response = await request(target, {
          method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error',
          signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), clientAbort.signal]),
        });
        const payload = await readJson(response);
        if (asRecord(payload)) writeCache(item.key, compactWatchProviders(item, payload));
        else failures += 1;
      } catch {
        if (!clientAbort.signal.aborted) failures += 1;
      }
    };
    await Promise.all(Array.from({ length: Math.min(WATCH_PROVIDER_BATCH_MAX_CONCURRENT, misses.length) }, async () => {
      while (next < misses.length && !clientAbort.signal.aborted) await fetchOne(misses[next++]);
    }));
    if (failures > 0) {
      emitOperationalEvent({ code: 'PROVIDER_UPSTREAM_FAILED', context: { provider: 'tmdb', count: failures }, domain: 'providers', level: 'warn' });
    }
    if (clientAbort.signal.aborted || res.destroyed) return;
    res.status(200).json({ results: items.map(item => ({ key: item.key, providers: readCache(item.key) })) });
  });
}
