import type { Application, RequestHandler } from 'express';

type MediaType = 'movie' | 'tv';
type Secrets = Partial<Record<'TMDB_API_KEY' | 'TVDB_API_KEY', string>>;

interface Dependencies {
  authenticate: RequestHandler;
  fetch?: typeof fetch;
  secrets?: () => Secrets;
  now?: () => number;
  timeoutMs?: number;
  stallBurstMs?: number;
}

interface ParentalBatchItem {
  mediaType: MediaType;
  id: number;
  key: string;
}

const TMDB_ORIGIN = 'https://api.themoviedb.org/3/';
const AGE_FILTER_TRACE_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export const PARENTAL_BATCH_MAX_ITEMS = 40;
export const PARENTAL_BATCH_MAX_CONCURRENT = 24;
export const PARENTAL_BATCH_STALL_BURST_CONCURRENT = PARENTAL_BATCH_MAX_ITEMS;
export const PARENTAL_BATCH_STALL_BURST_MS = 1_000;
export const PARENTAL_BATCH_ITEM_BUDGET_PER_MINUTE = 240;
const MAX_PARENTAL_RESPONSE_BYTES = 256 * 1024;

interface AgeFilterRequestTrace {
  traceId: string;
  generation: number;
  page: number;
  maxAge: number;
}

function readNumericTraceHeader(req: any, name: string, min: number, max: number): number {
  const value = Number(req?.headers?.[name]);
  return Number.isInteger(value) && value >= min && value <= max ? value : 0;
}

function readAgeFilterRequestTrace(req: any): AgeFilterRequestTrace | null {
  const raw = req?.headers?.['x-seenit-age-trace'];
  const traceId = Array.isArray(raw) ? raw[0] : raw;
  if (!AGE_FILTER_TRACE_ID_PATTERN.test(String(traceId || ''))) return null;
  return {
    traceId: String(traceId),
    generation: readNumericTraceHeader(req, 'x-seenit-age-generation', 1, 1_000_000),
    page: readNumericTraceHeader(req, 'x-seenit-age-page', 1, 10_000),
    maxAge: readNumericTraceHeader(req, 'x-seenit-age-max', 0, 99),
  };
}

function emitAgeFilterRequestTrace(
  trace: AgeFilterRequestTrace | null,
  phase: string,
  context: Record<string, string | number | boolean | null>,
): void {
  if (!trace) return;
  console.info(JSON.stringify({
    seenitDiagnostic: {
      schemaVersion: 1,
      code: 'AGE_FILTER_REQUEST_TRACE',
      timestamp: new Date().toISOString(),
      traceId: trace.traceId,
      generation: trace.generation,
      page: trace.page,
      maxAge: trace.maxAge,
      phase,
      context,
    },
  }));
}

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
  const stallBurstMs = dependencies.stallBurstMs ?? PARENTAL_BATCH_STALL_BURST_MS;
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
    const trace = readAgeFilterRequestTrace(req);
    const requestStartedAt = now();
    const traceLog = (phase: string, context: Record<string, string | number | boolean | null> = {}) => {
      emitAgeFilterRequestTrace(trace, phase, {
        elapsedMs: Math.max(0, now() - requestStartedAt),
        ...context,
      });
    };
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
    traceLog('request_received', {
      stream,
      itemCount: items.length,
      movieCount: items.filter(item => item.mediaType === 'movie').length,
      tvCount: items.filter(item => item.mediaType === 'tv').length,
      steadyConcurrency: PARENTAL_BATCH_MAX_CONCURRENT,
      burstConcurrency: PARENTAL_BATCH_STALL_BURST_CONCURRENT,
      stallBurstMs,
      timeoutMs,
    });
    const budget = takeBudget(uid, items.length);
    if ('retryAfter' in budget) {
      traceLog('request_rejected_budget', { itemCount: items.length, retryAfter: budget.retryAfter });
      res.setHeader('Retry-After', String(budget.retryAfter));
      res.status(429).json({ error: 'Trop de classifications demandées, réessayez plus tard.' });
      return;
    }

    const credential = readSecrets().TMDB_API_KEY?.trim();
    if (!credential) {
      traceLog('request_rejected_provider_config', { itemCount: items.length });
      res.status(503).json({ error: 'Fournisseur non configuré.' });
      return;
    }

    const clientAbort = new AbortController();
    let responseFinished = false;
    if (typeof (res as any).once === 'function') {
      res.once('finish', () => { responseFinished = true; });
      res.once('close', () => {
        if (!responseFinished) {
          traceLog('client_connection_closed', { active, queued: waiters.length });
          clientAbort.abort();
        }
      });
    }

    let active = 0;
    let maxActive = 0;
    let maxQueued = 0;
    let burstGrants = 0;
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
      maxActive = Math.max(maxActive, active);
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
        maxActive = Math.max(maxActive, active);
        return;
      }
      await new Promise<void>(resolve => {
        const waiter: Waiter = { granted: false, resolve, timer: null };
        waiter.timer = setTimeout(() => {
          if (!waiter.granted && active < PARENTAL_BATCH_STALL_BURST_CONCURRENT) {
            burstGrants += 1;
            grant(waiter);
          }
        }, stallBurstMs);
        waiters.push(waiter);
        maxQueued = Math.max(maxQueued, waiters.length);
      });
    };
    const runBounded = async <T>(task: (queueWaitMs: number) => Promise<T>): Promise<T> => {
      const queuedAt = now();
      await acquire();
      const queueWaitMs = Math.max(0, now() - queuedAt);
      try { return await task(queueWaitMs); }
      finally {
        active -= 1;
        grantSteadySlots();
      }
    };

    const resolveItem = (item: ParentalBatchItem, ordinal: number) => runBounded(async queueWaitMs => {
      const providerStartedAt = now();
      traceLog('provider_start', {
        ordinal,
        mediaType: item.mediaType,
        queueWaitMs,
        active,
        queued: waiters.length,
      });
      const endpoint = item.mediaType === 'movie' ? 'release_dates' : 'content_ratings';
      const target = new URL(`${item.mediaType}/${item.id}/${endpoint}`, TMDB_ORIGIN);
      target.searchParams.set('api_key', credential);
      let details: any | null = null;
      let outcome = 'error';
      let httpStatus = 0;
      try {
        const response = await request(target, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          redirect: 'error',
          signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), clientAbort.signal]),
        });
        httpStatus = response.status;
        const payload = await readJsonResponse(response);
        if (payload) {
          details = item.mediaType === 'movie'
            ? { id: item.id, media_type: item.mediaType, release_dates: payload }
            : { id: item.id, media_type: item.mediaType, content_ratings: payload };
          outcome = 'ok';
        } else {
          outcome = response.ok ? 'invalid_payload' : 'http_error';
        }
      } catch (error: any) {
        outcome = clientAbort.signal.aborted
          ? 'client_aborted'
          : String(error?.name || '').toLowerCase().includes('timeout')
            ? 'timeout'
            : 'error';
      }
      traceLog('provider_done', {
        ordinal,
        mediaType: item.mediaType,
        queueWaitMs,
        providerMs: Math.max(0, now() - providerStartedAt),
        outcome,
        httpStatus,
        hasDetails: Boolean(details),
        active,
        queued: waiters.length,
      });
      return { key: item.key, media_type: item.mediaType, id: item.id, details };
    });

    if (stream) {
      res.status(200);
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.flushHeaders?.();
      let firstWriteMs: number | null = null;
      let writeSequence = 0;
      let resolvedCount = 0;
      await Promise.all(items.map(async (item, index) => {
        const result = await resolveItem(item, index + 1);
        if (result.details) resolvedCount += 1;
        if (!clientAbort.signal.aborted && !res.destroyed) {
          writeSequence += 1;
          if (firstWriteMs === null) {
            firstWriteMs = Math.max(0, now() - requestStartedAt);
            traceLog('stream_first_write', { firstWriteMs, ordinal: index + 1 });
          }
          traceLog('stream_item_write', {
            sequence: writeSequence,
            ordinal: index + 1,
            mediaType: item.mediaType,
            hasDetails: Boolean(result.details),
          });
          res.write(`${JSON.stringify(result)}\n`);
        }
      }));
      traceLog('request_complete', {
        stream: true,
        itemCount: items.length,
        resolvedCount,
        nullCount: items.length - resolvedCount,
        firstWriteMs: firstWriteMs ?? -1,
        maxActive,
        maxQueued,
        burstGrants,
        aborted: clientAbort.signal.aborted,
      });
      if (!res.destroyed) res.end();
      return;
    }

    const results = await Promise.all(items.map((item, index) => resolveItem(item, index + 1)));
    traceLog('request_complete', {
      stream: false,
      itemCount: items.length,
      resolvedCount: results.filter(result => Boolean(result.details)).length,
      nullCount: results.filter(result => !result.details).length,
      firstWriteMs: -1,
      maxActive,
      maxQueued,
      burstGrants,
      aborted: clientAbort.signal.aborted,
    });
    if (!clientAbort.signal.aborted && !res.destroyed) res.json({ results });
  });
}
