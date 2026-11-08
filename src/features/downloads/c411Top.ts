import { normalizeBtih } from './magnetLink.ts';

/**
 * SEENIT-C411-004 (#900, décision du propriétaire du 08/11 : « un filtre dans Explorer, car c'est presque plus
 * pertinent que TMDB parfois ») — les titres les plus partagés sur C411. Une release n'est rattachée à une fiche
 * que par l'identifiant TMDB exact de ses métadonnées C411, jamais par son titre, son année ou son nom de
 * fichier (§5.1).
 */
export type C411TopScope = 'videos' | 'movie' | 'tv';
export const C411_TOP_SCOPES: readonly C411TopScope[] = ['videos', 'movie', 'tv'];
export const C411_TOP_RELEASE_LIMIT = 100;
export const C411_TOP_MAX_PAGES = 4;
/** Releases sans identité dans la liste dont le détail est lu (une requête chacune), au plus. */
export const C411_TOP_DETAIL_LOOKUPS = 30;

export const isC411TopScope = (value: unknown): value is C411TopScope => C411_TOP_SCOPES.includes(value as C411TopScope);

/** Catalogue vidéo C411 trié par seeders, releases individuelles (mode plat). */
export function buildC411TopParams(scope: C411TopScope, page: number, perPage = C411_TOP_RELEASE_LIMIT): URLSearchParams {
  const params = new URLSearchParams({ category: '1', sortBy: 'seeders', sortOrder: 'desc', page: String(page), perPage: String(perPage), viewMode: 'flat' });
  if (scope === 'movie') params.set('subcat', '6');
  if (scope === 'tv') params.set('subcat', '7');
  return params;
}

export interface C411TmdbIdentity { mediaType: 'movie' | 'tv'; tmdbId: number }

const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

function declaredType(value: unknown): 'movie' | 'tv' | null {
  const type = String(value ?? '').trim().toLowerCase();
  if (type === 'movie' || type === 'film') return 'movie';
  if (type === 'tv' || type === 'series' || type === 'serie' || type === 'show') return 'tv';
  return null;
}

/** Type porté par la sous-catégorie C411 explicite (`6` Film, `7` Série), comme la recherche SeenIt. */
function subcategoryType(item: Record<string, unknown>): 'movie' | 'tv' | null {
  const metadata = record(item.metadata);
  const id = Number(record(item.subcategory)?.id ?? record(metadata?.subcategory)?.id ?? item.subcat ?? item.subcategoryId);
  return id === 6 ? 'movie' : id === 7 ? 'tv' : null;
}

/**
 * Identité TMDB exacte d'une release C411 : `metadata.tmdbData` (ou `tmdbData`/`tmdb`, ou `tmdbId`), type
 * déclaré par C411 sinon sous-catégorie explicite. Un désaccord entre les deux, ou une identité absente,
 * écarte la release : jamais de rapprochement par le titre.
 */
export function c411TmdbIdentity(item: unknown): C411TmdbIdentity | null {
  const root = record(item);
  if (!root) return null;
  const metadata = record(root.metadata);
  const tmdb = record(metadata?.tmdbData) || record(root.tmdbData) || record(root.tmdb);
  const rawId = tmdb?.id ?? metadata?.tmdbId ?? root.tmdbId;
  const tmdbId = typeof rawId === 'number' ? rawId : typeof rawId === 'string' && /^\d+$/.test(rawId.trim()) ? Number(rawId) : NaN;
  if (!Number.isSafeInteger(tmdbId) || tmdbId <= 0) return null;
  const declared = declaredType(tmdb?.type ?? metadata?.tmdbType ?? root.tmdbType);
  const fromSubcategory = subcategoryType(root);
  if (declared && fromSubcategory && declared !== fromSubcategory) return null;
  const mediaType = declared || fromSubcategory;
  return mediaType ? { mediaType, tmdbId } : null;
}

export interface C411TopRelease { key: string; infoHash: string | null; name: string; seeders: number; identity: C411TmdbIdentity | null }

/** Release exploitable : un nom et un nombre entier de seeders positif ou nul ; l'identité peut manquer. */
export function parseC411TopRelease(item: unknown): C411TopRelease | null {
  const root = record(item);
  if (!root) return null;
  const name = typeof root.name === 'string' ? root.name.trim() : typeof root.title === 'string' ? root.title.trim() : '';
  const seeders = Number(root.seeders);
  if (!name || !Number.isSafeInteger(seeders) || seeders < 0) return null;
  const infoHash = normalizeBtih(root.infoHash);
  const id = root.id ?? root.slug;
  const key = infoHash ? `btih:${infoHash}` : id !== undefined && id !== null && String(id) ? `id:${String(id)}` : '';
  if (!key) return null;
  return { key, infoHash, name, seeders, identity: c411TmdbIdentity(root) };
}

export interface C411TopEntry { mediaType: 'movie' | 'tv'; tmdbId: number; rank: number; seeders: number; releases: number }

/**
 * Regroupe les releases d'un même titre (type + TMDB exact) : le titre prend la place de sa release la plus
 * partagée et en garde les seeders. L'ordre suit les seeders décroissants (ex æquo : ordre de C411).
 */
export function rankC411TopMedia(releases: readonly C411TopRelease[]): { entries: C411TopEntry[]; unresolved: number } {
  const ordered = releases.map((release, index) => ({ release, index })).sort((a, b) => b.release.seeders - a.release.seeders || a.index - b.index);
  const byTitle = new Map<string, C411TopEntry>();
  let unresolved = 0;
  for (const { release } of ordered) {
    if (!release.identity) { unresolved += 1; continue; }
    const key = `${release.identity.mediaType}:${release.identity.tmdbId}`;
    const known = byTitle.get(key);
    if (known) known.releases += 1;
    else byTitle.set(key, { ...release.identity, rank: byTitle.size + 1, seeders: release.seeders, releases: 1 });
  }
  return { entries: [...byTitle.values()], unresolved };
}
