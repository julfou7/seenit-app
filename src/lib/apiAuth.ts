import { auth } from './firebase';

/**
 * Ajoute le jeton Firebase courant aux appels vers l'API SeenIt.
 * Le jeton est rafraichi automatiquement par le SDK Firebase si necessaire.
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

  return Object.fromEntries(normalizedHeaders.entries());
}

export async function authenticatedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  return fetch(input, {
    ...init,
    headers: await getAuthenticatedHeaders(init.headers)
  });
}
