import { auth } from './firebase';
import { CURRENT_APP_VERSION } from '../store/updateStore';
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

export async function authenticatedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
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

  return response;
}
