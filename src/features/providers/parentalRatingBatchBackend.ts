import type { Application, RequestHandler } from 'express';

type MediaType = 'movie' | 'tv';
type Secrets = Partial<Record<'TMDB_API_KEY' | 'TVDB_API_KEY', string>>;

interface Dependencies {
  authenticate: RequestHandler;
  fetch?: typeof fetch;
  secrets?: () => Secrets;
  now?: () => number;
  timeoutMs?: number;
}

interface ParentalBatchItem {
  mediaType: MediaType;
  id: number;
  key: string;
}

const TMDB_ORIGIN = 'https://api.themoviedb.org/3/';
export const PARENTAL_BATCH_MAX_ITEMS = 40;
export const PARENTAL_BATCH_MAX_CONCURRENT = 24;
const PARENTAL_BATCH_ITEM_BUDGET_PER_MINUTE = 240;
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
  const readSecrets = dependencies.secrets || (() => ({
    TMDB_API_KEY: process.env.TMDB_API_KEY,
    TVDB_API_KEY: process.env.TVDB_API_KEY,
  }));
  const budgets = new Map<string, { used: number; resetAt: number }>();

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

  app.get('/api/media/parental-ratings', dependencies.authenticate, async (req: any, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const uid = req.user?.uid;
    if (!uid) {
      res.status(401).json({ error: 'Authentification requise.' });
      return;
    }
    if (Object.keys(req.query).some(key => key !== 'items')) {
      res.status(400).json({ error: 'Requête de classifications refusée.' });
      return;
    }

    const items = parseBatchItems(req.query.items);
    if (!items) {
      res.status(400).json({ error: 'Requête de classifications refusée.' });
      return;
    }
    const budget = takeBudget(uid, items.length);
    if ('retryAfter' in budget) {
      res.setHeader('Retry-After', String(budget.retryAfter));
      res.status(429).json({ error: 'Trop de classifications demandées, réessayez plus tard.' });
      return;
    }

    const credential = readSecrets().TMDB_API_KEY?.trim();
    if (!credential) {
      res.status(503).json({ error: 'Fournisseur non configuré.' });
      return;
    }

    let active = 0;
    const waiters: Array<() => void> = [];
    const runBounded = async <T>(task: () => Promise<T>): Promise<T> => {
      if (active >= PARENTAL_BATCH_MAX_CONCURRENT) {
        await new Promise<void>(resolve => waiters.push(resolve));
      }
      active += 1;
      try {
        return await task();
      } finally {
        active -= 1;
        waiters.shift()?.();
      }
    };

    const results = await Promise.all(items.map(item => runBounded(async () => {
      const endpoint = item.mediaType === 'movie' ? 'release_dates' : 'content_ratings';
      const target = new URL(`${item.mediaType}/${item.id}/${endpoint}`, TMDB_ORIGIN);
      target.searchParams.set('api_key', credential);
      try {
        const response = await request(target, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          redirect: 'error',
          signal: AbortSignal.timeout(timeoutMs),
        });
        const payload = await readJsonResponse(response);
        if (!payload) return { key: item.key, media_type: item.mediaType, id: item.id, details: null };
        const details = item.mediaType === 'movie'
          ? { id: item.id, media_type: item.mediaType, release_dates: payload }
          : { id: item.id, media_type: item.mediaType, content_ratings: payload };
        return { key: item.key, media_type: item.mediaType, id: item.id, details };
      } catch {
        return { key: item.key, media_type: item.mediaType, id: item.id, details: null };
      }
    })));

    res.json({ results });
  });
}
