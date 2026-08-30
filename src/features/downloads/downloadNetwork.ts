/** Ajoute un nonce aux GET de polling pour empêcher tout cache natif/intermédiaire. */
export function buildFreshGetUrl(url: string, nonce: number = Date.now()): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}_seenitFresh=${nonce}`;
}

/** Headers explicites pour les endpoints dont les données évoluent à chaque seconde. */
export function buildNoCacheHeaders(headers: Record<string, string> = {}): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (lower === 'cache-control' || lower === 'pragma' || lower === 'expires') continue;
    next[key] = value;
  }
  next['Cache-Control'] = 'no-cache, no-store, max-age=0';
  next.Pragma = 'no-cache';
  next.Expires = '0';
  return next;
}
