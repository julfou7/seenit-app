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

type ParentalMediaType = 'movie' | 'tv';
interface ParentalRequestIdentity {
  mediaType: ParentalMediaType;
  id: number;
  key: string;
}
interface PendingParentalRequest extends ParentalRequestIdentity {
  resolve: (response: Response) => void;
  reject: (error: unknown) => void;
}

const PARENTAL_CLIENT_BATCH_MAX = 40;
const parentalQueue: PendingParentalRequest[] = [];
let parentalFlushScheduled = false;

function readParentalRequestIdentity(input: RequestInfo | URL, init: RequestInit): ParentalRequestIdentity | null {
  if (String(init.method || 'GET').toUpperCase() !== 'GET') return null;
  let raw: string;
  if (typeof input === 'string') raw = input;
  else if (input instanceof URL) raw = input.toString();
  else raw = input.url;

  try {
    const base = typeof location !== 'undefined' ? location.origin : 'https://seenit.invalid';
    const url = new URL(raw, base);
    const match = url.pathname.match(/^\/api\/media\/tmdb\/(movie|tv)\/([1-9]\d{0,12})\/(release_dates|content_ratings)$/);
    if (!match) return null;
    const mediaType = match[1] as ParentalMediaType;
    const endpoint = match[3];
    if ((mediaType === 'movie' && endpoint !== 'release_dates')
      || (mediaType === 'tv' && endpoint !== 'content_ratings')) return null;
    const id = Number(match[2]);
    return { mediaType, id, key: `${mediaType}:${id}` };
  } catch {
    return null;
  }
}

function cloneBatchFailure(status: number, statusText: string, body: string, headers: Headers): Response {
  return new Response(body, { status, statusText, headers: Array.from(headers.entries()) });
}

async function flushParentalQueue(): Promise<void> {
  parentalFlushScheduled = false;
  const batch = parentalQueue.splice(0, PARENTAL_CLIENT_BATCH_MAX);
  if (batch.length === 0) return;
  if (parentalQueue.length > 0) scheduleParentalFlush();

  const unique = new Map<string, ParentalRequestIdentity>();
  for (const request of batch) unique.set(request.key, request);
  const encodedItems = encodeURIComponent(
    Array.from(unique.values()).map(item => `${item.mediaType}:${item.id}`).join(',')
  );
  const batchUrl = resolveSeenItApiUrl(`/api/media/parental-ratings?items=${encodedItems}`);

  try {
    const response = await fetch(batchUrl, {
      method: 'GET',
      headers: await getAuthenticatedHeaders({ Accept: 'application/json' })
    });
    if (response.ok && isUnexpectedHtmlApiResponse(response.headers.get('content-type'))) {
      const error = new Error('Le backend SeenIt a retourné une page HTML au lieu d’une réponse API.');
      Object.assign(error, { code: 'SEENIT_API_HTML_FALLBACK' });
      throw error;
    }
    if (!response.ok) {
      const body = await response.text();
      for (const pending of batch) {
        pending.resolve(cloneBatchFailure(response.status, response.statusText, body, response.headers));
      }
      return;
    }

    const payload = await response.json();
    const results = new Map<string, any>();
    for (const item of Array.isArray(payload?.results) ? payload.results : []) {
      if (typeof item?.key === 'string') results.set(item.key, item.details ?? null);
    }
    for (const pending of batch) {
      const details = results.get(pending.key);
      if (!details) {
        pending.resolve(new Response(JSON.stringify({ error: 'Classification indisponible.' }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' }
        }));
        continue;
      }
      pending.resolve(new Response(JSON.stringify(details), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }));
    }
  } catch (error) {
    for (const pending of batch) pending.reject(error);
  }
}

function scheduleParentalFlush(): void {
  if (parentalFlushScheduled) return;
  parentalFlushScheduled = true;
  Promise.resolve().then(() => void flushParentalQueue());
}

function enqueueParentalRequest(identity: ParentalRequestIdentity): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    parentalQueue.push({ ...identity, resolve, reject });
    scheduleParentalFlush();
  });
}

export async function authenticatedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const parentalIdentity = readParentalRequestIdentity(input, init);
  if (parentalIdentity) return enqueueParentalRequest(parentalIdentity);

  const originalString = typeof input === 'string' ? input : null;
  const resolvedInput = originalString ? resolveSeenItApiUrl(originalString) : input;
  const response = await fetch(resolvedInput, {
    ...init,
    headers: await getAuthenticatedHeaders(init.headers)
  });

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
