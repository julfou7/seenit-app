import { buildC411TopParams, c411TmdbIdentity, parseC411TopRelease, rankC411TopMedia, C411_TOP_DETAIL_LOOKUPS, C411_TOP_MAX_PAGES, C411_TOP_RELEASE_LIMIT, type C411TmdbIdentity, type C411TopEntry, type C411TopRelease, type C411TopScope } from './c411Top.ts';
/** Transport C411 côté serveur. Une réponse invalide ou un échec n'est jamais un catalogue vide. */
export async function fetchC411Torrents(options: { apiKey: string; query: string; searchParams: URLSearchParams; signal: () => AbortSignal; fetcher?: typeof fetch }): Promise<unknown[]> {
  const request = options.fetcher || fetch;
  const urls = [...new Set([
    `https://c411.org/api/torrents?${options.searchParams}`,
    `https://c411.org/api/torrents?${new URLSearchParams({ name: options.query, category: '1', page: '1', perPage: '100', viewMode: 'flat' })}`,
    `https://c411.org/api/torrents?${new URLSearchParams({ name: options.query })}`
  ])];
  let validEmpty = false;
  for (const [index, url] of urls.entries()) {
    const response = await request(url, { headers: { Authorization: `Bearer ${options.apiKey}`, Accept: 'application/json', 'User-Agent': 'SeenIt-App', Referer: 'https://c411.org/torrents' }, signal: options.signal() });
    // Une première erreur peut venir de la sous-catégorie ; le repli doit ensuite réussir réellement.
    if (!response.ok) {
      if (index === 0 && ![401, 403, 429].includes(response.status)) continue;
      throw new Error(`C411 indisponible (${response.status}).`);
    }
    const payload: unknown = await response.json();
    const data = payload && typeof payload === 'object' && 'data' in payload ? payload.data : null;
    if (!Array.isArray(data)) throw new Error('Réponse C411 invalide.');
    if (data.length) return data;
    validEmpty = true;
  }
  if (!validEmpty) throw new Error('Recherche C411 indisponible.');
  return [];
}


export type C411TopErrorCode = 'C411_AUTH_REJECTED' | 'C411_RATE_LIMITED' | 'C411_UNAVAILABLE' | 'C411_INVALID_RESPONSE';
export class C411TopError extends Error {
  readonly code: C411TopErrorCode;
  readonly retryAfter: string | null;
  constructor(code: C411TopErrorCode, message: string, retryAfter: string | null = null) {
    super(message);
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

const topRecord = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const IDENTITY_CACHE_LIMIT = 5_000;

/**
 * SEENIT-C411-004 (#900) — Top C411 côté serveur : catalogue vidéo trié par seeders (au plus 4 pages, 100 releases),
 * puis, pour les 30 premières releases sans identité dans la liste, leur détail (une identité de release ne change
 * pas : cache par BTIH). Une panne ou une réponse invalide n'est jamais un classement vide ; une clé refusée
 * arrête tout. Les releases d'un même titre (type + TMDB exact) sont regroupées.
 */
export async function fetchC411TopMedia(options: { apiKey: string; scope: C411TopScope; signal: () => AbortSignal; fetcher?: typeof fetch; identityCache?: Map<string, C411TmdbIdentity | null> }): Promise<{ entries: C411TopEntry[]; unresolved: number; scanned: number }> {
  const request = options.fetcher || fetch;
  const get = async (url: string): Promise<unknown> => {
    const response = await request(url, { headers: { Authorization: `Bearer ${options.apiKey}`, Accept: 'application/json', 'User-Agent': 'SeenIt-App', Referer: 'https://c411.org/torrents' }, signal: options.signal(), redirect: 'error' });
    if (response.status === 401 || response.status === 403) throw new C411TopError('C411_AUTH_REJECTED', 'Clé C411 refusée.');
    if (response.status === 429) throw new C411TopError('C411_RATE_LIMITED', 'C411 limite les requêtes : réessaie dans un instant.', response.headers.get('retry-after'));
    if (!response.ok) throw new C411TopError('C411_UNAVAILABLE', `C411 indisponible (${response.status}).`);
    return response.json();
  };
  const releases: C411TopRelease[] = [];
  const seen = new Set<string>();
  let pageSize = 0;
  for (let page = 1; page <= C411_TOP_MAX_PAGES && releases.length < C411_TOP_RELEASE_LIMIT; page++) {
    const payload = topRecord(await get(`https://c411.org/api/torrents?${buildC411TopParams(options.scope, page)}`));
    const data = payload?.data;
    if (!Array.isArray(data)) throw new C411TopError('C411_INVALID_RESPONSE', 'Réponse C411 invalide.');
    for (const item of data) {
      const release = parseC411TopRelease(item);
      if (release && !seen.has(release.key)) { seen.add(release.key); releases.push(release); }
    }
    const meta = topRecord(payload?.meta);
    if (page === 1) pageSize = Number(meta?.perPage ?? meta?.per_page) || data.length;
    const totalPages = Number(meta?.totalPages ?? meta?.last_page ?? meta?.lastPage);
    if (!data.length || data.length < pageSize || (Number.isFinite(totalPages) && totalPages > 0 && page >= totalPages)) break;
  }
  const top = releases.slice(0, C411_TOP_RELEASE_LIMIT);
  const cache = options.identityCache;
  const missing = top.filter(release => !release.identity && release.infoHash).slice(0, C411_TOP_DETAIL_LOOKUPS);
  const toFetch: C411TopRelease[] = [];
  for (const release of missing) {
    if (cache?.has(release.infoHash!)) release.identity = cache.get(release.infoHash!) ?? null;
    else toFetch.push(release);
  }
  for (let index = 0; index < toFetch.length; index += 4) {
    await Promise.all(toFetch.slice(index, index + 4).map(async release => {
      try {
        const detail = await get(`https://c411.org/api/torrents/${release.infoHash}`);
        release.identity = c411TmdbIdentity(topRecord(detail)?.data ?? detail);
        if (cache) {
          if (cache.size >= IDENTITY_CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
          cache.set(release.infoHash!, release.identity);
        }
      } catch (error: unknown) {
        // Une clé refusée arrête tout ; une autre panne laisse seulement cette release sans fiche.
        if (error instanceof C411TopError && error.code === 'C411_AUTH_REJECTED') throw error;
      }
    }));
  }
  return { ...rankC411TopMedia(top), scanned: top.length };
}
