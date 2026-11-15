/**
 * Une recherche/grab interactif Arr peut attendre les indexers ; les autres appels restent courts. Retour terrain
 * du 15/11 (v1.4.315, « timeout » sur La Guerre des mondes et Dexter S02E01) : 30 s ne suffisent pas quand Sonarr
 * ou Radarr interrogent tous leurs indexers ; la recherche des versions attend jusqu'à 90 s.
 */
export const ARR_RELEASE_TIMEOUT_MS = 90_000;
export function downloadServiceTimeoutMs(method: string, targetUrl: string): number {
  return (method === 'GET' || method === 'POST') && /\/api\/v3\/(?:release|indexer\/testall)$/.test(new URL(targetUrl).pathname)
    ? ARR_RELEASE_TIMEOUT_MS : 10_000;
}
