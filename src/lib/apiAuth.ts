import { auth } from './firebase';
import { CURRENT_APP_VERSION } from '../store/updateStore';
import { appLogger } from '../store/logStore';
import {
  isSeenItApiRequest,
  isUnexpectedHtmlApiResponse,
  resolveSeenItApiUrl
} from './seenitApi';

/**
 * Ajoute le jeton Firebase courant aux appels vers l'API SeenIt.
 * Le jeton est rafraichi automatiquement par le SDK Firebase si necessaire.
 * La version applicative accompagne aussi les appels authentifiés afin que les
 * réponses Plex destructrices restent réservées aux clients qui comprennent la
 * provenance `plexImported`.
 */
export async function getAuthenticatedHeaders(
  headers: HeadersInit = {}
): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Utilisateur non authentifie. Veuillez vous reconnecter.');
  }

  const token = await user.getIdToken();
  const normalizedHeaders = new Headers(headers);
  normalizedHeaders.set('Authorization', `Bearer ${token}`);
  normalizedHeaders.set('X-Plex-Version', CURRENT_APP_VERSION);

  return Object.fromEntries(normalizedHeaders.entries());
}

function isPlexDeltaHistoryRequest(input: string | null, init: RequestInit): boolean {
  if (!input || !/\/api\/plex\/history(?:$|[?#])/i.test(input)) return false;
  if (String(init.method || 'GET').toUpperCase() !== 'POST') return false;
  if (typeof init.body !== 'string') return false;
  try {
    return JSON.parse(init.body)?.delta === true;
  } catch {
    return false;
  }
}

async function logPlexDeltaDiagnostics(
  originalInput: string | null,
  init: RequestInit,
  response: Response
): Promise<void> {
  if (!response.ok || !isPlexDeltaHistoryRequest(originalInput, init)) return;
  try {
    const payload = await response.clone().json();
    const lines = Array.isArray(payload?.deltaDiagnostics)
      ? payload.deltaDiagnostics.filter((line: unknown) => typeof line === 'string' && line.trim()).slice(0, 180)
      : [];
    if (lines.length === 0) {
      appLogger.warn('plex', '[Plex Delta Debug] Aucun diagnostic détaillé renvoyé par le backend.');
      return;
    }
    appLogger.info('plex', `[Plex Delta Debug] ===== DIAGNOSTIC DELTA (${lines.length} ligne(s)) =====`);
    lines.forEach((line: string) => appLogger.info('plex', `[Plex Delta Debug] ${line}`));
    appLogger.info('plex', '[Plex Delta Debug] ===== FIN DIAGNOSTIC DELTA =====');
  } catch (error: any) {
    appLogger.warn('plex', `[Plex Delta Debug] Diagnostic illisible : ${String(error?.name || 'PARSE_FAILED').slice(0, 60)}.`);
  }
}

const AGE_FILTER_TRACE_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function readAgeFilterTraceId(headers: HeadersInit | undefined): string | null {
  try {
    const traceId = new Headers(headers).get('X-SeenIt-Age-Trace') || '';
    return AGE_FILTER_TRACE_ID_PATTERN.test(traceId) ? traceId : null;
  } catch {
    return null;
  }
}

function logAgeFilterRequestTiming(traceId: string | null, phase: string, durationMs: number, status?: number): void {
  if (!traceId) return;
  console.info(`[AgeFilterTrace] ${JSON.stringify({
    traceId,
    phase,
    durationMs: Math.max(0, durationMs),
    ...(typeof status === 'number' ? { httpStatus: status } : {}),
  })}`);
}

export async function authenticatedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const originalString = typeof input === 'string' ? input : null;
  const resolvedInput = originalString ? resolveSeenItApiUrl(originalString) : input;
  const traceId = readAgeFilterTraceId(init.headers);
  const authStartedAt = Date.now();
  const authenticatedHeaders = await getAuthenticatedHeaders(init.headers);
  logAgeFilterRequestTiming(traceId, 'auth_headers_ready', Date.now() - authStartedAt);
  const fetchStartedAt = Date.now();
  const response = await fetch(resolvedInput, {
    ...init,
    headers: authenticatedHeaders
  });
  logAgeFilterRequestTiming(traceId, 'http_response_headers', Date.now() - fetchStartedAt, response.status);

  // Un fallback SPA/Vite peut répondre 200 avec index.html quand le backend /api est absent.
  // Ce cas doit être une panne explicite, jamais un faux succès API.
  const resolvedString = typeof resolvedInput === 'string' ? resolvedInput : null;
  const isSeenItApi = Boolean(
    (originalString && isSeenItApiRequest(originalString))
    || (resolvedString && isSeenItApiRequest(resolvedString))
  );
  if (isSeenItApi && response.ok && isUnexpectedHtmlApiResponse(response.headers.get('content-type'))) {
    const error = new Error('Le backend SeenIt a retourné une page HTML au lieu d’une réponse API.');
    Object.assign(error, { code: 'SEENIT_API_HTML_FALLBACK' });
    throw error;
  }

  await logPlexDeltaDiagnostics(originalString, init, response);
  return response;
}
