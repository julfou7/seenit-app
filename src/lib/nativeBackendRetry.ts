import { appLogger } from '../store/logStore';

export type NativeBackendTransport = 'natif Android' | 'WebView';

export interface NativeBackendAttempt<T> {
  transport: NativeBackendTransport;
  request: () => Promise<T>;
}

export function isRetryableBackendNetworkError(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : String((error as any)?.message || error || '');

  return /unable to resolve host|no address associated with hostname|unknownhost|err_name_not_resolved|failed to fetch|network(?: request)? failed|network error|load failed|timed? ?out|timeout|connection (?:reset|refused)|software caused connection abort/i.test(message);
}

function logNativePlexDeltaDiagnostics(value: unknown, transport: NativeBackendTransport): void {
  if (transport !== 'natif Android') return;
  const lines = Array.isArray((value as any)?.data?.deltaDiagnostics)
    ? (value as any).data.deltaDiagnostics.filter((line: unknown) => typeof line === 'string' && line.trim()).slice(0, 180)
    : [];
  if (lines.length === 0) return;

  appLogger.info('plex', `[Plex Delta Debug] ===== DIAGNOSTIC DELTA NATIF (${lines.length} ligne(s)) =====`);
  lines.forEach((line: string) => appLogger.info('plex', `[Plex Delta Debug] ${line}`));
  appLogger.info('plex', '[Plex Delta Debug] ===== FIN DIAGNOSTIC DELTA NATIF =====');
}

export async function executeBackendAttempts<T>(params: {
  attempts: NativeBackendAttempt<T>[];
  delaysMs?: number[];
  onRetry?: (details: {
    failedTransport: NativeBackendTransport;
    nextTransport: NativeBackendTransport;
    attempt: number;
    error: unknown;
  }) => void;
}): Promise<T> {
  if (params.attempts.length === 0) {
    throw new Error('Aucune tentative réseau configurée.');
  }

  let lastError: unknown;

  for (let index = 0; index < params.attempts.length; index++) {
    const attempt = params.attempts[index];
    try {
      const result = await attempt.request();
      logNativePlexDeltaDiagnostics(result, attempt.transport);
      return result;
    } catch (error) {
      lastError = error;
      const nextAttempt = params.attempts[index + 1];
      if (!nextAttempt || !isRetryableBackendNetworkError(error)) throw error;

      params.onRetry?.({
        failedTransport: attempt.transport,
        nextTransport: nextAttempt.transport,
        attempt: index + 1,
        error
      });

      const delayMs = params.delaysMs?.[index] || 0;
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError;
}
