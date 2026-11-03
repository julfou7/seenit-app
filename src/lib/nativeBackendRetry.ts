export type NativeBackendTransport = 'natif Android' | 'WebView';

export interface NativeBackendAttempt<T> {
  transport: NativeBackendTransport;
  endpoint?: string;
  request: () => Promise<T>;
}

export function buildNativeBackendAttempts<T>(params: {
  urls: string[];
  nativeRequest: (url: string) => Promise<T>;
  webViewRequest: (url: string) => Promise<T>;
}): NativeBackendAttempt<T>[] {
  const urls = [...new Set(params.urls.filter(Boolean))];
  return [
    ...urls.map((endpoint) => ({
      transport: 'natif Android' as const,
      endpoint,
      request: () => params.nativeRequest(endpoint)
    })),
    ...urls.map((endpoint) => ({
      transport: 'WebView' as const,
      endpoint,
      request: () => params.webViewRequest(endpoint)
    }))
  ];
}

function readUnknownErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return error == null ? '' : String(error);
}

export function isRetryableBackendNetworkError(error: unknown): boolean {
  const message = readUnknownErrorMessage(error);

  return /unable to resolve host|no address associated with hostname|unknownhost|err_name_not_resolved|failed to fetch|network(?: request)? failed|network error|load failed|timed? ?out|timeout|connection (?:reset|refused)|software caused connection abort/i.test(message);
}

/** Délai de réponse dépassé : le serveur a reçu la requête, la relancer referait tout le travail. */
export function isBackendTimeoutError(error: unknown): boolean {
  return /timed? ?out|timeout|délai/i.test(readUnknownErrorMessage(error));
}

export function describeBackendNetworkFailure(error: unknown): string {
  if (isBackendTimeoutError(error)) {
    return 'Le service SeenIt a mis trop de temps à répondre. Réessaie dans quelques minutes.';
  }
  if (isRetryableBackendNetworkError(error)) {
    return 'Connexion au backend SeenIt impossible. Vérifiez la connexion réseau ou le DNS privé de cet appareil, puis réessayez.';
  }
  return readUnknownErrorMessage(error) || 'Erreur réseau inconnue';
}

export async function executeBackendAttempts<T>(params: {
  attempts: NativeBackendAttempt<T>[];
  delaysMs?: number[];
  /** Par défaut toute panne réseau est retentée ; une collecte Plex exclut les délais dépassés (SEENIT-PLEX-012). */
  isRetryable?: (error: unknown) => boolean;
  onRetry?: (details: {
    failedTransport: NativeBackendTransport;
    nextTransport: NativeBackendTransport;
    failedEndpoint?: string;
    nextEndpoint?: string;
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
      return await attempt.request();
    } catch (error) {
      lastError = error;
      const nextAttempt = params.attempts[index + 1];
      if (!nextAttempt || !(params.isRetryable || isRetryableBackendNetworkError)(error)) throw error;

      params.onRetry?.({
        failedTransport: attempt.transport,
        nextTransport: nextAttempt.transport,
        failedEndpoint: attempt.endpoint,
        nextEndpoint: nextAttempt.endpoint,
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
