/**
 * SEENIT-PROVIDER-002 (retour v1.4.303) : en France, Canal+ reste le diffuseur d'une série dont il est la chaîne
 * d'origine, même quand TMDB ne la liste pas dans le catalogue streaming. Une découverte de séries filtrée sur
 * Canal+ (fournisseur TMDB 381) est donc complétée par les séries de la chaîne Canal+ (réseau TMDB 285).
 */
export const CANAL_WATCH_PROVIDER_ID = '381';
export const CANAL_TMDB_NETWORK_ID = '285';

type DiscoverItem = { id?: unknown };
type DiscoverPayload<I extends DiscoverItem> = { page?: number; results?: I[]; total_pages?: number; total_results?: number };

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

/** Union sans doublon (identité TMDB) triée selon le champ et le sens de `sort_by`. */
function sortedUnion<I extends DiscoverItem>(sources: ReadonlyArray<ReadonlyArray<I>>, sortBy: string | null): I[] {
  const seen = new Set<string>();
  const merged: I[] = [];
  for (const item of sources.flat()) {
    const key = String(item?.id ?? '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  // Revue Codex #973 : la fusion suit le champ et le sens de `sort_by` (défaut TMDB : popularity.desc), nombres,
  // dates ISO ou titres ; une valeur absente va en fin de liste dans les deux sens.
  const [field, direction] = (sortBy || 'popularity.desc').split('.');
  const sign = direction === 'asc' ? 1 : -1;
  const valueOf = (item: I): number | string | null => {
    const value = (item as Record<string, unknown>)[field];
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string' && value.trim()) return value;
    return null;
  };
  return merged.sort((left, right) => {
    const a = valueOf(left), b = valueOf(right);
    if (a === null || b === null) return a === null ? (b === null ? 0 : 1) : -1;
    if (typeof a === 'number' && typeof b === 'number') return sign * (a - b);
    return sign * String(a).localeCompare(String(b), 'fr', { sensitivity: 'base' });
  });
}

/** Fusion d'une seule page de chaque source (tests et repli au-delà de la borne de pages). */
export function mergeCanalOriginDiscover<I extends DiscoverItem, T extends DiscoverPayload<I>>(primary: T, origin: DiscoverPayload<I>, sortBy: string | null): T {
  return {
    ...primary,
    results: sortedUnion([primary.results || [], origin.results || []], sortBy),
    total_pages: Math.max(Number(primary.total_pages) || 0, Number(origin.total_pages) || 0),
    total_results: (Number(primary.total_results) || 0) + (Number(origin.total_results) || 0),
  };
}

/** Pages TMDB lues par source pour servir une page fusionnée (au-delà, repli page à page). */
export const CANAL_ORIGIN_MAX_MERGED_PAGES = 20;
export const TMDB_DISCOVER_PAGE_SIZE = 20;

/**
 * Revue Codex #973 : la page N de l'union est la tranche N de la fusion triée des pages 1..N de chaque source.
 * Les N premières pages de chaque source contiennent forcément les N×20 premiers éléments de l'union : l'ordre reste
 * continu d'une page à l'autre, sans doublon entre pages.
 */
export function pageCanalOriginDiscover<I extends DiscoverItem, T extends DiscoverPayload<I>>(primaryPages: readonly T[], originPages: ReadonlyArray<DiscoverPayload<I>>, sortBy: string | null, page: number): T {
  const union = sortedUnion([...primaryPages.map(entry => entry.results || []), ...originPages.map(entry => entry.results || [])], sortBy);
  const totalResults = (Number(primaryPages[0]?.total_results) || 0) + (Number(originPages[0]?.total_results) || 0);
  const totalPages = Math.max(Number(primaryPages[0]?.total_pages) || 0, Number(originPages[0]?.total_pages) || 0, Math.ceil(totalResults / TMDB_DISCOVER_PAGE_SIZE));
  return {
    ...(primaryPages[primaryPages.length - 1] || primaryPages[0]),
    page,
    results: union.slice((page - 1) * TMDB_DISCOVER_PAGE_SIZE, page * TMDB_DISCOVER_PAGE_SIZE),
    total_pages: totalPages,
    total_results: totalResults,
  } as T;
}
