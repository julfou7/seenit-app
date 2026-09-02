import { extractPlexExternalIds } from './plexIdentity.ts';

export interface PlexSyncPayloadLike {
  history?: any[];
  watchlist?: any[];
  stats?: Record<string, any>;
  totalFound?: number;
  [key: string]: any;
}

function normalizeMediaType(item: any): 'movie' | 'tv' | 'episode' | 'unknown' {
  const type = String(item?.type || item?.mediaType || '').trim().toLowerCase();
  if (type === 'movie' || type === 'film' || type === 'video') return 'movie';
  if (type === 'show' || type === 'series' || type === 'tv') return 'tv';
  if (type === 'episode') return 'episode';
  return 'unknown';
}

/**
 * Construit uniquement des identités techniques vérifiables. Le titre, l'année et
 * les clés locales PMS ne servent jamais à rapprocher un historique d'une watchlist.
 */
export function getExactPlexMediaIdentityKeys(item: any): string[] {
  if (!item || typeof item !== 'object') return [];

  const mediaType = normalizeMediaType(item);
  const keys = new Set<string>();
  const sourceIdentity = typeof item.sourceIdentity === 'string' ? item.sourceIdentity.trim() : '';
  if (sourceIdentity) keys.add(`source:${sourceIdentity}`);

  const ids = extractPlexExternalIds(item);
  if (ids.tmdbId) keys.add(`${mediaType}:tmdb:${ids.tmdbId}`);
  if (ids.imdbId) keys.add(`${mediaType}:imdb:${ids.imdbId}`);
  if (ids.tvdbId) keys.add(`${mediaType}:tvdb:${ids.tvdbId}`);
  if (ids.plexGuid) keys.add(`${mediaType}:plex:${ids.plexGuid}`);

  return [...keys];
}

function sharesExactIdentity(item: any, identities: Set<string>): boolean {
  return getExactPlexMediaIdentityKeys(item).some(identity => identities.has(identity));
}

/**
 * Le endpoint Plex Cloud `activities` peut contenir des événements utilisateur qui
 * ne constituent pas un visionnage. Une activité Cloud portant exactement la même
 * identité technique qu'un film de la watchlist est donc ambiguë : sans source de
 * visionnage plus forte, SeenIt privilégie l'état non vu.
 *
 * Les sources autoritatives (`account-history`, `pms-history`, `library-watched`)
 * ne sont jamais supprimées : un média peut légitimement être vu ET en watchlist.
 */
export function sanitizePlexSyncWatchEvidence<T extends PlexSyncPayloadLike>(payload: T): T {
  if (!payload || typeof payload !== 'object') return payload;

  const history = Array.isArray(payload.history) ? payload.history : [];
  const watchlist = Array.isArray(payload.watchlist) ? payload.watchlist : [];
  if (history.length === 0 || watchlist.length === 0) return payload;

  const watchlistMovieIdentities = new Set<string>();
  for (const item of watchlist) {
    if (normalizeMediaType(item) !== 'movie') continue;
    for (const identity of getExactPlexMediaIdentityKeys(item)) {
      watchlistMovieIdentities.add(identity);
    }
  }
  if (watchlistMovieIdentities.size === 0) return payload;

  const filteredHistory = history.filter(item => {
    if (normalizeMediaType(item) !== 'movie') return true;
    if (String(item?.sourceKind || '').trim().toLowerCase() !== 'cloud') return true;
    return !sharesExactIdentity(item, watchlistMovieIdentities);
  });

  const suppressedCount = history.length - filteredHistory.length;
  if (suppressedCount === 0) return payload;

  const nextStats = payload.stats && typeof payload.stats === 'object'
    ? {
        ...payload.stats,
        normalizedHistoryItems: filteredHistory.length,
        suppressedAmbiguousWatchlistHistory:
          Number(payload.stats.suppressedAmbiguousWatchlistHistory || 0) + suppressedCount
      }
    : payload.stats;

  return {
    ...payload,
    history: filteredHistory,
    ...(nextStats ? { stats: nextStats } : {}),
    totalFound: filteredHistory.length + watchlist.length
  } as T;
}
