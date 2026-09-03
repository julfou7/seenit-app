import { extractPlexExternalIds, getPlexMetadataLookupKey } from './plexIdentity.ts';

export interface PlexSyncPayloadLike {
  history?: any[];
  watchlist?: any[];
  libraryWatchStates?: any[];
  integrity?: Record<string, any>;
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

function asCount(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
}

function safeDiagnosticValue(value: unknown, maxLength = 120): string {
  const normalized = String(value ?? '')
    .replace(/https?:\/\/\S+/gi, '[URL masquée]')
    .replace(/(?:x-plex-token|authorization|bearer|token)\s*[:=]\s*\S+/gi, '[secret masqué]')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
  return normalized.slice(0, maxLength);
}

function shortServerId(value: unknown): string {
  const id = safeDiagnosticValue(value, 64);
  if (!id) return 'inconnu';
  return id.length <= 12 ? id : `${id.slice(0, 8)}…${id.slice(-4)}`;
}

function describeTechnicalIdentity(item: any): string {
  const ids = extractPlexExternalIds(item);
  if (ids.tmdbId) return `tmdb:${ids.tmdbId}`;
  if (ids.imdbId) return `imdb:${ids.imdbId}`;
  if (ids.tvdbId) return `tvdb:${ids.tvdbId}`;
  if (ids.plexGuid) return `plex:${safeDiagnosticValue(ids.plexGuid, 80)}`;
  if (typeof item?.sourceIdentity === 'string' && item.sourceIdentity.trim()) {
    return safeDiagnosticValue(item.sourceIdentity, 100);
  }
  return 'non résolue';
}

function describeCurrentDeltaWatchedItem(item: any): string | null {
  if (String(item?.sourceKind || '').trim().toLowerCase() !== 'library-watched') return null;
  const mediaType = normalizeMediaType(item);
  const ratingKey = safeDiagnosticValue(getPlexMetadataLookupKey(item) || item?.ratingKey || 'absent', 80);
  const serverId = shortServerId(item?.serverId || item?.serverIdentifier);
  const identity = describeTechnicalIdentity(item);
  const episodeSuffix = mediaType === 'episode'
    ? ` S${Number(item?.parentIndex)}E${Number(item?.index)}`
    : '';
  return `${mediaType}${episodeSuffix} • serveur=${serverId} • ratingKey=${ratingKey} • identité=${identity}`;
}

/**
 * Produit le diagnostic visible du DELTA exclusivement à partir des métadonnées déjà
 * renvoyées au client. Aucun jeton, URL de serveur ni UID complet n'est inclus.
 */
export function buildPlexDeltaDiagnosticLines(payload: PlexSyncPayloadLike): string[] {
  const stats = payload?.stats && typeof payload.stats === 'object' ? payload.stats : null;
  if (!stats || !Object.prototype.hasOwnProperty.call(stats, 'deltaWatchedSnapshotItems')) return [];

  const previous = asCount(stats.deltaPreviousLocatorItems);
  const previousCanonical = asCount(stats.deltaPreviousCanonicalLocatorItems);
  const current = asCount(stats.deltaCurrentLocatorItems);
  const currentCanonical = asCount(stats.deltaCurrentCanonicalLocatorItems);
  const scanned = asCount(stats.deltaWatchedSnapshotServers);
  const skipped = asCount(stats.deltaWatchedSnapshotSkippedServers);
  const incomplete = asCount(stats.deltaWatchedSnapshotIncompleteServers);
  const unresolved = asCount(stats.deltaUnresolvedWatchedItems);
  const candidates = asCount(stats.deltaMissingUnwatchCandidates);
  const blocked = asCount(stats.deltaBlockedUnwatchCandidates);
  const rechecked = asCount(stats.deltaRecheckedUnwatchCandidates);
  const explicitUnwatch = asCount(stats.deltaExplicitUnwatchItems);
  const rawGap = Math.max(0, previous - current);
  const snapshotComplete = payload?.integrity?.deltaWatchedSnapshotComplete === true;

  const lines = [
    `Résumé • précédent=${previous} locator(s) (${previousCanonical} TMDB) • courant=${current} locator(s) (${currentCanonical} TMDB) • écart brut=${rawGap}`,
    `Serveurs • scannés=${scanned} • ignorés=${skipped} • incomplets=${incomplete} • snapshot complet=${snapshotComplete ? 'oui' : 'non'}`,
    `Chaîne non vu • non résolus vus=${unresolved} • candidats backend=${candidates} • bloqués=${blocked} • recheckés=${rechecked} • watched=false produits=${explicitUnwatch}`
  ];

  if (!snapshotComplete) {
    lines.push('GARDE DESTRUCTIVE • FERMÉE côté complétude : au moins un serveur est ignoré ou incomplet ; le backend actuel peut bloquer tous les non vus DELTA.');
  } else {
    lines.push('GARDE DESTRUCTIVE • snapshot complet ; le chemin de recheck est autorisable côté complétude.');
  }

  if (rawGap > 0 && candidates === 0) {
    lines.push(`ALERTE • ${rawGap} disparition(s) brute(s) entre baseline et snapshot courant, mais 0 candidat backend : vérifier le verrou global/baseline avant le recheck exact.`);
  } else if (candidates > 0 && rechecked === 0) {
    lines.push(`ALERTE • ${candidates} candidat(s) détecté(s), mais aucun recheck exact exécuté.`);
  } else if (rechecked > 0 && explicitUnwatch === 0) {
    lines.push(`ALERTE • ${rechecked} recheck(s) exact(s) exécuté(s), mais aucun watched=false produit : état PMS encore vu ou preuve indéterminée.`);
  }

  const currentWatched = (Array.isArray(payload.history) ? payload.history : [])
    .map(describeCurrentDeltaWatchedItem)
    .filter((line): line is string => Boolean(line));
  lines.push(`Snapshot courant détaillé • ${currentWatched.length} élément(s) library-watched`);
  currentWatched.slice(0, 100).forEach((line, index) => {
    lines.push(`CURRENT ${index + 1}/${currentWatched.length} • ${line}`);
  });
  if (currentWatched.length > 100) {
    lines.push(`CURRENT • ${currentWatched.length - 100} élément(s) supplémentaires non affichés pour borner le journal.`);
  }

  const falseStates = (Array.isArray(payload.libraryWatchStates) ? payload.libraryWatchStates : [])
    .filter(state => state?.watched === false);
  lines.push(`États non vu reçus • ${falseStates.length}`);
  falseStates.slice(0, 50).forEach((state, index) => {
    const mediaType = normalizeMediaType(state);
    const episodeSuffix = mediaType === 'episode'
      ? ` S${Number(state?.seasonNumber)}E${Number(state?.episodeNumber)}`
      : '';
    lines.push(
      `WATCHED_FALSE ${index + 1}/${falseStates.length} • ${mediaType}${episodeSuffix} • ` +
      `tmdb=${safeDiagnosticValue(state?.tmdbId || 'absent', 30)} • serveur=${shortServerId(state?.serverId)}`
    );
  });

  return lines.slice(0, 180);
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
  let nextPayload: T = payload;

  if (history.length > 0 && watchlist.length > 0) {
    const watchlistMovieIdentities = new Set<string>();
    for (const item of watchlist) {
      if (normalizeMediaType(item) !== 'movie') continue;
      for (const identity of getExactPlexMediaIdentityKeys(item)) {
        watchlistMovieIdentities.add(identity);
      }
    }

    if (watchlistMovieIdentities.size > 0) {
      const filteredHistory = history.filter(item => {
        if (normalizeMediaType(item) !== 'movie') return true;
        if (String(item?.sourceKind || '').trim().toLowerCase() !== 'cloud') return true;
        return !sharesExactIdentity(item, watchlistMovieIdentities);
      });

      const suppressedCount = history.length - filteredHistory.length;
      if (suppressedCount > 0) {
        const nextStats = payload.stats && typeof payload.stats === 'object'
          ? {
              ...payload.stats,
              normalizedHistoryItems: filteredHistory.length,
              suppressedAmbiguousWatchlistHistory:
                Number(payload.stats.suppressedAmbiguousWatchlistHistory || 0) + suppressedCount
            }
          : payload.stats;

        nextPayload = {
          ...payload,
          history: filteredHistory,
          ...(nextStats ? { stats: nextStats } : {}),
          totalFound: filteredHistory.length + watchlist.length
        } as T;
      }
    }
  }

  const deltaDiagnostics = buildPlexDeltaDiagnosticLines(nextPayload);
  if (deltaDiagnostics.length === 0) return nextPayload;
  return {
    ...nextPayload,
    deltaDiagnostics
  } as T;
}
