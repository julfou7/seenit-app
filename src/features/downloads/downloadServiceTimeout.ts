/** Une recherche/grab interactif Arr peut attendre les indexers ; les autres appels restent courts. */
export function downloadServiceTimeoutMs(method: string, targetUrl: string): number {
  return (method === 'GET' || method === 'POST') && /\/api\/v3\/release$/.test(new URL(targetUrl).pathname)
    ? 30_000 : 10_000;
}
