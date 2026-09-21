import { randomUUID } from 'node:crypto';

export type OperationalEventCode =
  | 'API_UNHANDLED_ERROR'
  | 'APP_UPDATE_CLIENT_FAILED'
  | 'BACKEND_STARTUP_FAILED'
  | 'CACHE_CLIENT_STORAGE_FAILED'
  | 'DOWNLOAD_C411_FAILED'
  | 'DOWNLOAD_CLIENT_SYNC_FAILED'
  | 'DOWNLOAD_SERVICE_PROXY_FAILED'
  | 'DOWNLOAD_WEBHOOK_FAILED'
  | 'FIRESTORE_CLIENT_SYNC_FAILED'
  | 'NOTIFICATION_CLIENT_FAILED'
  | 'PARENTAL_RATING_PROVIDER_FAILED'
  | 'PLEX_DELTA_SNAPSHOT_FAILED'
  | 'PLEX_FULL_SNAPSHOT_SEED_FAILED'
  | 'PLEX_SNAPSHOT_STORE_FAILED'
  | 'PLEX_SYNC_PARTIAL'
  | 'PROVIDER_UPSTREAM_FAILED'
  | 'RELEASE_UPDATE_PUSH_FAILED'
  | 'UPDATE_CHECK_BACKEND_FAILED';

export type OperationalEventDomain =
  | 'cache'
  | 'downloads'
  | 'firestore'
  | 'notifications'
  | 'plex'
  | 'providers'
  | 'release'
  | 'runtime';
export type OperationalEventLevel = 'error' | 'warn';

export interface OperationalEventEnvelope {
  seenitEvent: {
    schemaVersion: 1;
    timestamp: string;
    domain: OperationalEventDomain;
    level: OperationalEventLevel;
    code: OperationalEventCode;
    correlationId: string;
    context: Record<string, string | number>;
  };
}

const SAFE_CODE_PATTERN = /^[A-Z][A-Z0-9_:-]{0,79}$/;
const SAFE_CORRELATION_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SAFE_METHODS = new Set(['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT']);

function normalizeErrorCode(value: unknown, fallback: string): string {
  const code = String(value || '').trim().toUpperCase();
  if (!SAFE_CODE_PATTERN.test(code)) return fallback;
  if (code.length > 20 && !/[_:-]/.test(code)) return fallback;
  return code;
}

function normalizeCount(value: unknown): number {
  const count = Number(value);
  if (!Number.isFinite(count)) return 0;
  return Math.max(0, Math.min(100, Math.floor(count)));
}

function normalizeHttpStatus(value: unknown): number {
  const status = Number(value);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}

function normalizeProvider(value: unknown): string {
  const provider = String(value || '').trim().toLowerCase();
  return provider === 'tmdb' || provider === 'tvdb' ? provider : 'unknown';
}

function normalizeSource(value: unknown): string {
  const source = String(value || '').trim().toLowerCase();
  return source === 'sonarr' || source === 'radarr' ? source : 'unknown';
}

function normalizeContext(
  code: OperationalEventCode,
  context: Record<string, unknown>
): Record<string, string | number> {
  if (code === 'API_UNHANDLED_ERROR') {
    const method = String(context.method || '').trim().toUpperCase();
    return {
      method: SAFE_METHODS.has(method) ? method : 'UNKNOWN',
      errorCode: normalizeErrorCode(context.errorCode, 'API_ERROR')
    };
  }

  if (code === 'BACKEND_STARTUP_FAILED') {
    return {
      errorCode: normalizeErrorCode(context.errorCode, 'STARTUP_ERROR')
    };
  }

  if (code === 'PLEX_SNAPSHOT_STORE_FAILED') {
    const action = String(context.action || '').trim();
    return {
      action: ['read', 'read-resolution-cache', 'write'].includes(action) ? action : 'unknown',
      errorCode: normalizeErrorCode(context.errorCode, 'SNAPSHOT_STORE_FAILED')
    };
  }

  if (code === 'PLEX_DELTA_SNAPSHOT_FAILED' || code === 'PLEX_FULL_SNAPSHOT_SEED_FAILED') {
    return {
      errorCode: normalizeErrorCode(
        context.errorCode,
        code === 'PLEX_DELTA_SNAPSHOT_FAILED'
          ? 'PLEX_DELTA_SNAPSHOT_FAILED'
          : 'PLEX_FULL_SNAPSHOT_SEED_FAILED'
      )
    };
  }

  if (code === 'PROVIDER_UPSTREAM_FAILED') {
    return {
      provider: normalizeProvider(context.provider),
      status: normalizeHttpStatus(context.status),
      count: normalizeCount(context.count)
    };
  }

  if (
    code === 'PARENTAL_RATING_PROVIDER_FAILED'
    || code === 'FIRESTORE_CLIENT_SYNC_FAILED'
    || code === 'NOTIFICATION_CLIENT_FAILED'
    || code === 'DOWNLOAD_CLIENT_SYNC_FAILED'
    || code === 'APP_UPDATE_CLIENT_FAILED'
    || code === 'CACHE_CLIENT_STORAGE_FAILED'
  ) {
    return { count: normalizeCount(context.count) };
  }

  if (code === 'DOWNLOAD_C411_FAILED') {
    const action = String(context.action || '').trim().toLowerCase();
    return {
      action: action === 'test' || action === 'search' ? action : 'unknown',
      errorCode: normalizeErrorCode(context.errorCode, 'C411_FAILED')
    };
  }

  if (code === 'DOWNLOAD_WEBHOOK_FAILED') {
    return {
      source: normalizeSource(context.source),
      errorCode: normalizeErrorCode(context.errorCode, 'WEBHOOK_FAILED')
    };
  }

  if (
    code === 'DOWNLOAD_SERVICE_PROXY_FAILED'
    || code === 'UPDATE_CHECK_BACKEND_FAILED'
  ) {
    return { errorCode: normalizeErrorCode(context.errorCode, code) };
  }

  if (code === 'RELEASE_UPDATE_PUSH_FAILED') {
    return {
      status: normalizeHttpStatus(context.status),
      errorCode: normalizeErrorCode(context.errorCode, 'RELEASE_PUSH_FAILED')
    };
  }

  return {
    mode: context.mode === 'delta' ? 'delta' : 'full',
    incompleteSourceCount: normalizeCount(context.incompleteSourceCount)
  };
}

export function buildOperationalEvent(
  input: {
    code: OperationalEventCode;
    context?: Record<string, unknown>;
    domain: OperationalEventDomain;
    level: OperationalEventLevel;
  },
  options: { correlationId?: string; now?: Date } = {}
): OperationalEventEnvelope {
  return {
    seenitEvent: {
      schemaVersion: 1,
      timestamp: (options.now || new Date()).toISOString(),
      domain: input.domain,
      level: input.level,
      code: input.code,
      correlationId: SAFE_CORRELATION_PATTERN.test(String(options.correlationId || ''))
        ? String(options.correlationId)
        : randomUUID(),
      context: normalizeContext(input.code, input.context || {})
    }
  };
}

export function emitOperationalEvent(
  input: Parameters<typeof buildOperationalEvent>[0],
  sink?: (line: string) => void
): OperationalEventEnvelope {
  const envelope = buildOperationalEvent(input);
  const write = sink || ((line: string) => process.stderr.write(`${line}\n`));
  write(JSON.stringify(envelope));
  return envelope;
}
