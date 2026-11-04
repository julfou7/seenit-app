import { extractPlexExternalIds, getStrongPlexSourceIdentity, unwrapPlexMediaItem } from './plexIdentity.ts';

/**
 * SEENIT-PLEX-011 — Une synchro delta ne relit et ne retraite toute la bibliothèque que si Plex apporte
 * quelque chose de neuf. La Watchlist est relue en entier à chaque delta (pour détecter ajouts et retraits) :
 * son empreinte, enregistrée seulement après une synchro entièrement validée, permet de reconnaître qu'elle
 * n'a pas changé. Sans historique nouveau ni état de bibliothèque, et avec chaque titre de la Watchlist déjà
 * suivi, le traitement complet ne changerait rien : la delta s'arrête alors après Plex.
 * #843 : « déjà suivi » se lit sur la bibliothèque confirmée par le serveur Firestore ; sans elle (`shows` null,
 * store encore issu du cache local), le traitement complet relit Firestore et décide.
 */
type LibraryShow = { tmdbId?: unknown; mediaType?: unknown };
type ResolutionCache = Record<string, { id?: unknown } | null | undefined>;

function watchlistItemIdentity(raw: unknown): string {
  const item = unwrapPlexMediaItem(raw);
  const strong = getStrongPlexSourceIdentity(item);
  if (strong) return strong;
  if (item?.ratingKey != null) return `rk:${String(item.ratingKey)}`;
  return item?.key != null ? `k:${String(item.key)}` : '';
}

function watchlistItemMediaType(item: { type?: unknown }): 'tv' | 'movie' {
  return item?.type === 'show' || item?.type === 'series' || item?.type === 'tv' ? 'tv' : 'movie';
}

export function plexWatchlistFingerprint(watchlist: readonly unknown[]): string {
  const identities = watchlist.map(watchlistItemIdentity).filter(Boolean).sort();
  // FNV-1a 32 bits : une empreinte courte suffit, le moindre écart renvoie vers le traitement complet.
  let hash = 0x811c9dc5;
  for (const char of identities.join('\n')) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `v1:${identities.length}:${hash.toString(16).padStart(8, '0')}`;
}

/** Chaque titre de la Watchlist correspond déjà à une fiche : le traitement complet n'en ajouterait aucune. */
export function isPlexWatchlistAlreadyTracked(
  watchlist: readonly unknown[],
  shows: readonly LibraryShow[],
  resolutionCache: ResolutionCache
): boolean {
  const library = new Set(shows.map(show => `${show.mediaType === 'movie' ? 'movie' : show.mediaType === 'tv' || !show.mediaType ? 'tv' : String(show.mediaType)}:${Number(show.tmdbId)}`));
  return watchlist.every(raw => {
    const item = unwrapPlexMediaItem(raw);
    const mediaType = watchlistItemMediaType(item);
    const source = getStrongPlexSourceIdentity(item);
    const tmdbId = Number(extractPlexExternalIds(item).tmdbId || (source ? resolutionCache[`${mediaType}:${source}`]?.id : null));
    return Number.isSafeInteger(tmdbId) && tmdbId > 0 && library.has(`${mediaType}:${tmdbId}`);
  });
}

export function isUnchangedPlexDelta(input: {
  delta: boolean;
  history: readonly unknown[] | null | undefined;
  libraryWatchStates: readonly unknown[] | null | undefined;
  watchlist: readonly unknown[] | null | undefined;
  watchlistComplete: boolean;
  collectionComplete: boolean;
  previousFingerprint: unknown;
  shows: readonly LibraryShow[] | null;
  resolutionCache: ResolutionCache;
}): boolean {
  if (!input.delta || !input.watchlistComplete || !input.collectionComplete || !Array.isArray(input.watchlist) || !input.shows) return false;
  if ((input.history?.length || 0) > 0 || (input.libraryWatchStates?.length || 0) > 0) return false;
  if (typeof input.previousFingerprint !== 'string' || plexWatchlistFingerprint(input.watchlist) !== input.previousFingerprint) return false;
  return isPlexWatchlistAlreadyTracked(input.watchlist, input.shows, input.resolutionCache);
}
