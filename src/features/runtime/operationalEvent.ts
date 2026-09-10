import { randomUUID } from 'node:crypto';

export type OperationalEventCode =
  | 'API_UNHANDLED_ERROR'
  | 'BACKEND_STARTUP_FAILED'
  | 'PLEX_SYNC_PARTIAL';

export type OperationalEventDomain = 'plex' | 'runtime';
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
  const write = sink || (input.level === 'warn'
    ? (line: string) => console.warn(line)
    : (line: string) => console.error(line));
  write(JSON.stringify(envelope));
  return envelope;
}
