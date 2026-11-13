/**
 * SEENIT-PROVIDER-002 (retour v1.4.303) : en France, Canal+ reste le diffuseur d'une série dont il est la chaîne
 * d'origine, même quand TMDB ne la liste pas dans le catalogue streaming. Une découverte de séries filtrée sur
 * Canal+ (fournisseur TMDB 381) est donc complétée par les séries de la chaîne Canal+ (réseau TMDB 285).
 */
export const CANAL_WATCH_PROVIDER_ID = '381';
export const CANAL_TMDB_NETWORK_ID = '285';

type DiscoverItem = { id?: unknown; popularity?: unknown; vote_average?: unknown };
type DiscoverPayload<I extends DiscoverItem> = { results?: I[]; total_pages?: number; total_results?: number };

/** Requête complémentaire « chaîne Canal+ » pour une découverte de séries filtrée sur Canal+, sinon null. */
export function canalOriginDiscoverVariant(url: URL): URL | null {
  if (!/\/discover\/tv\/?$/.test(url.pathname)) return null;
  const providers = (url.searchParams.get('with_watch_providers') || '').split('|').map(value => value.trim());
  if (!providers.includes(CANAL_WATCH_PROVIDER_ID)) return null;
  const variant = new URL(url.toString());
  for (const key of ['with_watch_providers', 'watch_region', 'with_watch_monetization_types']) variant.searchParams.delete(key);
  variant.searchParams.set('with_networks', CANAL_TMDB_NETWORK_ID);
  return variant;
}

/** Union sans doublon (identité TMDB) dans l'ordre de tri de la requête d'origine. */
export function mergeCanalOriginDiscover<I extends DiscoverItem, T extends DiscoverPayload<I>>(primary: T, origin: DiscoverPayload<I>, sortBy: string | null): T {
  const seen = new Set<string>();
  const merged: I[] = [];
  for (const item of [...(primary.results || []), ...(origin.results || [])]) {
    const key = String(item?.id ?? '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  const field = sortBy?.startsWith('vote_average') ? 'vote_average' : sortBy?.startsWith('popularity') ? 'popularity' : null;
  if (field) merged.sort((left, right) => (Number(right[field]) || 0) - (Number(left[field]) || 0));
  return {
    ...primary,
    results: merged,
    total_pages: Math.max(Number(primary.total_pages) || 0, Number(origin.total_pages) || 0),
    total_results: (Number(primary.total_results) || 0) + (Number(origin.total_results) || 0),
  };
}
