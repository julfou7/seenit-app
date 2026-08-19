import { Capacitor } from '@capacitor/core';
import { db, auth } from '../../lib/firebase';
import { collection, doc, writeBatch, getDocs } from 'firebase/firestore';
import { tmdb } from '../shows/tmdb';
import { useShowsStore } from '../../store/showsStore';
import { useSyncStore } from '../../store/syncStore';
import { useToastStore } from '../../store/toastStore';
import { appLogger } from '../../store/logStore';
import { getPlexClientId } from '../../services/plex';
import { Show } from '../../types';

export interface PlexSyncResult {
  success: boolean;
  syncedCount: number;
  moviesCount: number;
  episodesCount: number;
  syncedItems: Array<{ title: string; subtitle?: string; isWatchlist?: boolean; posterPath?: string | null; mediaType: 'tv' | 'movie'; show: Show }>;
  error?: string;
}

const normalizeTitle = (t?: string) => {
  if (!t) return '';
  return t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const extractTmdbIdFromPlex = (item: any): number | null => {
  if (!item) return null;
  if (Array.isArray(item.Guid)) {
    for (const g of item.Guid) {
      if (typeof g?.id === 'string') {
        const match = g.id.match(/^tmdb:\/\/(\d+)/i);
        if (match) return Number(match[1]);
      }
    }
  }
  for (const field of [item.guid, item.grandparentGuid, item.parentGuid]) {
    if (typeof field === 'string') {
      const match = field.match(/themoviedb:\/\/(\d+)|tmdb:\/\/(\d+)/i);
      if (match) return Number(match[1] || match[2]);
    }
  }
  return null;
};

// Persistent title -> TMDB resolution cache in localStorage
const getResolutionCache = (): Record<string, any> => {
  try {
    const raw = localStorage.getItem('plex_resolution_cache');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

const saveResolutionCache = (cache: Record<string, any>) => {
  try {
    // Keep max 500 entries to keep it light
    const keys = Object.keys(cache);
    if (keys.length > 500) {
      const trimmed = Object.fromEntries(keys.slice(-400).map(k => [k, cache[k]]));
      localStorage.setItem('plex_resolution_cache', JSON.stringify(trimmed));
    } else {
      localStorage.setItem('plex_resolution_cache', JSON.stringify(cache));
    }
  } catch {}
};

const findShowInLocalLibrary = (
  showsList: Array<Show & { normTitle: string; normOriginalTitle: string }>,
  normTitle: string,
  tmdbId: number | null,
  mediaType: 'tv' | 'movie'
): (Show & { normTitle: string; normOriginalTitle: string }) | undefined => {
  // 1. By exact TMDB ID
  if (tmdbId) {
    const byId = showsList.find(s => Number(s.tmdbId) === Number(tmdbId) && (mediaType === 'tv' ? (s.mediaType === 'tv' || !s.mediaType) : s.mediaType === 'movie'));
    if (byId) return byId;
  }

  // 2. By exact normalized title or original title
  const exact = showsList.find(s =>
    (mediaType === 'tv' ? (s.mediaType === 'tv' || !s.mediaType) : s.mediaType === 'movie') &&
    (s.normTitle === normTitle || (s.normOriginalTitle && s.normOriginalTitle === normTitle))
  );
  if (exact) return exact;

  // 3. By smart prefix or substring inclusion
  // e.g. "the handmaids tale la servante ecarlate" vs "the handmaids tale"
  if (normTitle && normTitle.length >= 4) {
    const fuzzy = showsList.find(s => {
      if (mediaType === 'tv' ? s.mediaType === 'movie' : (s.mediaType !== 'movie' && s.mediaType)) return false;
      const st = s.normTitle;
      const sot = s.normOriginalTitle;
      if (st) {
        if (st === normTitle || st.startsWith(normTitle) || normTitle.startsWith(st)) return true;
        if (normTitle.length >= 6 && (st.includes(normTitle) || (st.length >= 6 && normTitle.includes(st)))) return true;
      }
      if (sot) {
        if (sot === normTitle || sot.startsWith(normTitle) || normTitle.startsWith(sot)) return true;
        if (normTitle.length >= 6 && (sot.includes(normTitle) || (sot.length >= 6 && normTitle.includes(sot)))) return true;
      }
      return false;
    });
    if (fuzzy) return fuzzy;
  }

  return undefined;
};

const PLEX_BACKEND_ENDPOINTS = [
  'https://ais-pre-mooctibtw2amkshvkzlqij-700628279309.europe-west2.run.app/api/plex/history',
  'https://ais-dev-mooctibtw2amkshvkzlqij-700628279309.europe-west2.run.app/api/plex/history'
];

async function fetchPlexHistoryData(token: string, clientId: string, delta: boolean, since?: number) {
  const isNative = Capacitor.isNativePlatform();
  const urlsToTry = isNative 
    ? [...PLEX_BACKEND_ENDPOINTS, '/api/plex/history'] 
    : ['/api/plex/history', ...PLEX_BACKEND_ENDPOINTS];

  for (const url of urlsToTry) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, clientId, delta, since }),
        signal: AbortSignal.timeout(12000)
      });

      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        const data = await res.json();
        if (data && (Array.isArray(data.history) || Array.isArray(data.watchlist))) {
          return data;
        }
      }
    } catch (e) {
      console.warn(`[Plex Sync] Call to ${url} failed, trying next fallback...`, e);
    }
  }

  // Fallback: Fetch directly from official Plex Cloud APIs on native device
  return fetchPlexDirectlyFromClient(token, clientId);
}

async function fetchPlexDirectlyFromClient(token: string, clientId: string) {
  const rawWatchlistItems: any[] = [];
  const watchlistEndpoints = [
    'https://discover.provider.plex.tv/library/sections/watchlist/all?includeUserState=1',
    'https://metadata.provider.plex.tv/library/sections/watchlist/all?includeUserState=1'
  ];

  for (const endpoint of watchlistEndpoints) {
    try {
      const res = await fetch(endpoint, {
        headers: {
          'X-Plex-Token': token,
          'Accept': 'application/json',
          'X-Plex-Client-Identifier': clientId,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        signal: AbortSignal.timeout(8000)
      });
      if (res.ok) {
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = await res.json();
          const items = data?.MediaContainer?.Metadata || data?.Metadata || data?.items || [];
          if (Array.isArray(items) && items.length > 0) {
            rawWatchlistItems.push(...items);
            break;
          }
        }
      }
    } catch (err) {
      console.warn('[Plex Sync] Direct client fetch from Plex Cloud failed:', err);
    }
  }

  return {
    history: [],
    watchlist: rawWatchlistItems,
    visitedSources: ['Plex Cloud (Direct)']
  };
}

let activePlexSyncPromise: Promise<PlexSyncResult> | null = null;

export async function performPlexSync(options: { delta?: boolean; silent?: boolean; ignoreCooldown?: boolean } = {}): Promise<PlexSyncResult> {
  const { delta = true, silent = false, ignoreCooldown = false } = options;

  if (activePlexSyncPromise) {
    appLogger.info('plex', 'Une synchronisation Plex est déjà en cours, réutilisation de la requête existante...');
    return activePlexSyncPromise;
  }

  const syncExecution = async (): Promise<PlexSyncResult> => {
    const user = auth.currentUser;
    if (!user) {
      appLogger.warn('plex', 'Synchronisation annulée : utilisateur non connecté');
      return { success: false, syncedCount: 0, moviesCount: 0, episodesCount: 0, syncedItems: [], error: 'Utilisateur non connecté' };
    }

    const plexToken = localStorage.getItem('plex_auth_token') || localStorage.getItem('plex_token');
    const clientId = getPlexClientId();
    const lastSyncTimestampStr = localStorage.getItem('plex_last_sync_timestamp');
    const lastSyncTimestamp = lastSyncTimestampStr ? Number(lastSyncTimestampStr) : undefined;

    if (!plexToken) {
      if (!silent) {
        appLogger.info('plex', 'Aucun compte Plex associé');
      }
      return { success: false, syncedCount: 0, moviesCount: 0, episodesCount: 0, syncedItems: [], error: 'Aucun compte Plex associé' };
    }

    // Cooldown check (30 min) pour les synchronisations automatiques
    if (!ignoreCooldown && lastSyncTimestamp && !isNaN(lastSyncTimestamp)) {
      const elapsedMinutes = (Date.now() - lastSyncTimestamp) / (1000 * 60);
      if (elapsedMinutes < 30) {
        appLogger.info('plex', `Synchronisation automatique Plex ignorée : dernière synchronisation il y a ${Math.round(elapsedMinutes)} min (< 30 min)`);
        return { success: true, syncedCount: 0, moviesCount: 0, episodesCount: 0, syncedItems: [] };
      }
    }

    appLogger.info('plex', `Démarrage de la synchronisation Plex (${delta ? 'Mode Delta / Rapide' : 'Mode Complet'})...`);
    if (!silent) {
      useSyncStore.getState().setPlexSyncStatus({ 
        message: delta 
          ? 'Vérification rapide des visionnages récents...' 
          : 'Scan complet : Interrogation de vos serveurs Plex...' 
      });
    }

    const clearPlexSyncStatusDelayed = (message?: string, delayMs: number = 3000) => {
      if (message && !silent) {
        useSyncStore.getState().setPlexSyncStatus({ message });
      }
      setTimeout(() => {
        // Only clear if the status hasn't been changed by a new sync
        const currentStatus = useSyncStore.getState().plexSyncStatus;
        if (currentStatus && (!message || currentStatus.message === message)) {
          useSyncStore.getState().setPlexSyncStatus(null);
        }
      }, delayMs);
    };

    try {
      const plexData = await fetchPlexHistoryData(plexToken, clientId, delta, delta ? lastSyncTimestamp : undefined);
      const { history = [], watchlist = [], visitedSources = [] } = plexData || {};
      localStorage.setItem('plex_last_sync_timestamp', String(Date.now()));
      const hasHistory = Array.isArray(history) && history.length > 0;
      const hasWatchlist = Array.isArray(watchlist) && watchlist.length > 0;

      if (!hasHistory && !hasWatchlist) {
        const sourcesMsg = visitedSources && visitedSources.length > 0 ? ` (${visitedSources.join(', ')})` : '';
        appLogger.info('plex', `Plex vérifié : aucun nouveau média ni watchlist${sourcesMsg}`);
        localStorage.setItem('plex_last_sync_timestamp', String(Date.now()));
        clearPlexSyncStatusDelayed('Sync Plex terminée (à jour)', 3500);
        return { success: true, syncedCount: 0, moviesCount: 0, episodesCount: 0, syncedItems: [] };
      }

      const totalItemsCount = (history?.length || 0) + (watchlist?.length || 0);
      const sourcesSummary = visitedSources && visitedSources.length > 0 ? ` [Sources: ${visitedSources.join(', ')}]` : '';
      appLogger.info('plex', `${history?.length || 0} historique(s) + ${watchlist?.length || 0} watchlist(s) récupéré(s) depuis Plex${sourcesSummary}`, { sample: (history || []).slice(0, 5) });
      if (!silent) {
        useSyncStore.getState().setPlexSyncStatus({ 
          message: `Analyse Plex (${totalItemsCount} élément(s)...)` 
        });
      }

      // Load fresh shows from Firestore or current store
      const localShows = useShowsStore.getState().shows;
      const showsList: Array<Show & { normTitle: string; normOriginalTitle: string }> = localShows.map((s) => ({
        ...s,
        normTitle: normalizeTitle(s.title),
        normOriginalTitle: normalizeTitle(s.originalTitle || (s as any).original_name || (s as any).original_title)
      }));

      const resolutionCache = getResolutionCache();
      let cacheModified = false;

      let syncCount = 0;
      let moviesCount = 0;
      let episodesCount = 0;
      const syncedItems: PlexSyncResult['syncedItems'] = [];

      const batch = writeBatch(db);
      const mutatedShows: Record<string, Show> = {};

      const totalItems = history.length;
      let processedCount = 0;

      for (const item of history) {
        processedCount++;
        if (!silent && processedCount % 15 === 0 && processedCount < totalItems) {
          useSyncStore.getState().setPlexSyncStatus({
            message: `Analyse Plex (${processedCount}/${totalItems})...`
          });
        }

        const type = item.type;
        const rawViewed = item.viewedAt;
        const viewedTimestamp = rawViewed ? (Number(rawViewed) < 10000000000 ? Number(rawViewed) * 1000 : Number(rawViewed)) : Date.now();
        const guidTmdbId = extractTmdbIdFromPlex(item);

        if (type === 'episode') {
          const seasonNum = item.parentIndex;
          const episodeNum = item.index;
          const showTitle = item.grandparentTitle || item.title;
          if (!showTitle || seasonNum === undefined || episodeNum === undefined) continue;

          const epKey = `${seasonNum}x${episodeNum}`;
          const cleanShowTitle = showTitle.replace(/\(\d{4}\)/g, '').trim();
          const normPlexTitle = normalizeTitle(cleanShowTitle);
          const cacheKey = `tv:${normPlexTitle}`;

          // 1. Check in local library by TMDB ID, title, original title, or smart inclusion
          let matchedShow = findShowInLocalLibrary(showsList, normPlexTitle, guidTmdbId, 'tv');

          // Fast skip check: if already in library and episode is already seen, skip immediately
          if (matchedShow) {
            const currentMutated = mutatedShows[matchedShow.id] || matchedShow;
            if (currentMutated.seenEpisodes?.includes(epKey)) {
              continue; // Already processed & seen! Skip in 0ms without any TMDB request or UI message
            }
          }

          // 2. If not found locally, check resolution cache
          let tmdbData: any = null;
          if (!matchedShow && resolutionCache[cacheKey]) {
            tmdbData = resolutionCache[cacheKey];
            matchedShow = showsList.find(
              (s) => Number(s.tmdbId) === Number(tmdbData.id) && (s.mediaType === 'tv' || !s.mediaType)
            );
            if (matchedShow) {
              const currentMutated = mutatedShows[matchedShow.id] || matchedShow;
              if (currentMutated.seenEpisodes?.includes(epKey)) {
                continue; // Already in library via cached TMDB ID and already seen! Skip!
              }
            }
          }

          // 3. If still not resolved, query TMDB (only for genuinely unseen/unresolved titles)
          if (!matchedShow && !tmdbData) {
            let searchRes = await tmdb.searchMedia(cleanShowTitle, item.year ? String(item.year) : undefined, 'tv');
            if (!searchRes.ok || !searchRes.value) {
              searchRes = await tmdb.searchMedia(cleanShowTitle, undefined, 'tv');
            }
            if (searchRes.ok && searchRes.value) {
              tmdbData = searchRes.value;
              resolutionCache[cacheKey] = tmdbData;
              cacheModified = true;

              // Check if we already have this TMDB ID in our library
              matchedShow = showsList.find(
                (s) => Number(s.tmdbId) === Number(tmdbData.id) && (s.mediaType === 'tv' || !s.mediaType)
              );
              if (matchedShow) {
                const currentMutated = mutatedShows[matchedShow.id] || matchedShow;
                if (currentMutated.seenEpisodes?.includes(epKey)) {
                  continue; // Found via TMDB search and already seen! Skip!
                }
              }
            }
          }

          if (matchedShow) {
            const showId = matchedShow.id;
            if (!mutatedShows[showId]) {
              mutatedShows[showId] = { ...matchedShow };
            }
            const showData = mutatedShows[showId];
            const seenEpisodes = [...(showData.seenEpisodes || [])];

            // Check if already seen
            if (!seenEpisodes.includes(epKey)) {
              seenEpisodes.push(epKey);
              const episodeRecords = { ...(showData.episodeRecords || {}) };
              episodeRecords[epKey] = {
                watchedAt: viewedTimestamp,
                episodeTitle: item.title || null,
                ...(episodeRecords[epKey] || {})
              };

              showData.seenEpisodes = seenEpisodes;
              showData.episodeRecords = episodeRecords;
              showData.lastWatchedAt = viewedTimestamp;
              showData.updatedAt = Date.now();
              showData.status = showData.status === 'plan_to_watch' ? 'watching' : showData.status;

              syncCount++;
              episodesCount++;

              const sPad = String(seasonNum).padStart(2, '0');
              const ePad = String(episodeNum).padStart(2, '0');
              const subtitle = `S${sPad} | E${ePad}`;

              syncedItems.push({
                title: showData.title || showTitle,
                subtitle,
                posterPath: showData.posterPath,
                mediaType: 'tv',
                show: showData
              });

              appLogger.success('plex', `Épisode synchronisé : « ${showData.title} » ${subtitle} (${item.source || 'Plex'})`, {
                showId,
                epKey,
                source: item.source,
                viewedAt: new Date(viewedTimestamp).toLocaleString('fr-FR')
              });
            }
          } else if (tmdbData && tmdbData.id) {
            // Genuinely new show discovered from Plex!
            const newShowRef = doc(collection(db, `users/${user.uid}/shows`));
            const showId = newShowRef.id;

            const newShowData: Show = {
              id: showId,
              userId: user.uid,
              tmdbId: tmdbData.id,
              title: tmdbData.name || showTitle,
              originalTitle: tmdbData.original_name || showTitle,
              mediaType: 'tv',
              status: 'watching',
              createdAt: Date.now(),
              updatedAt: Date.now(),
              lastWatchedAt: viewedTimestamp,
              posterPath: tmdbData.poster_path
                ? tmdbData.poster_path.startsWith('http')
                  ? tmdbData.poster_path
                  : `https://image.tmdb.org/t/p/w500${tmdbData.poster_path}`
                : null,
              backdropPath: tmdbData.backdrop_path
                ? tmdbData.backdrop_path.startsWith('http')
                  ? tmdbData.backdrop_path
                  : `https://image.tmdb.org/t/p/w1280${tmdbData.backdrop_path}`
                : null,
              firstAirDate: tmdbData.first_air_date || '',
              networks: [],
              seenEpisodes: [epKey],
              episodeRecords: { [epKey]: { watchedAt: viewedTimestamp, episodeTitle: item.title || null } },
              isArchived: false
            };

            mutatedShows[showId] = newShowData;
            showsList.push({
              ...newShowData,
              normTitle: normalizeTitle(newShowData.title),
              normOriginalTitle: normalizeTitle(newShowData.originalTitle)
            });

            syncCount++;
            episodesCount++;

            const sPad = String(seasonNum).padStart(2, '0');
            const ePad = String(episodeNum).padStart(2, '0');
            const subtitle = `S${sPad} | E${ePad}`;

            syncedItems.push({
              title: newShowData.title,
              subtitle,
              posterPath: newShowData.posterPath,
              mediaType: 'tv',
              show: newShowData
            });

            appLogger.success('plex', `Nouvelle série ajoutée & épisode vu : « ${newShowData.title} » ${subtitle} (${item.source || 'Plex'})`, {
              showId,
              tmdbId: tmdbData.id,
              epKey
            });
          }
        } else if (type === 'movie') {
          const movieTitle = item.title;
          if (!movieTitle) continue;

          const cleanMovieTitle = movieTitle.replace(/\(\d{4}\)/g, '').trim();
          const normMovieTitle = normalizeTitle(cleanMovieTitle);
          const cacheKey = `movie:${normMovieTitle}`;

          // 1. Check in local library
          let matchedMovie = findShowInLocalLibrary(showsList, normMovieTitle, guidTmdbId, 'movie');

          // Fast skip check: if already in library and movie is already marked as seen, skip immediately
          if (matchedMovie) {
            const currentMutated = mutatedShows[matchedMovie.id] || matchedMovie;
            const isSeen = currentMutated.seenEpisodes?.includes('movie') ||
                           currentMutated.status === 'completed' ||
                           !!currentMutated.episodeRecords?.['movie']?.watchedAt;
            if (isSeen) {
              continue; // Already processed & seen! Skip in 0ms without any TMDB request or UI message
            }
          }

          // 2. If not found locally, check resolution cache
          let tmdbData: any = null;
          if (!matchedMovie && resolutionCache[cacheKey]) {
            tmdbData = resolutionCache[cacheKey];
            matchedMovie = showsList.find(
              (s) => Number(s.tmdbId) === Number(tmdbData.id) && s.mediaType === 'movie'
            );
            if (matchedMovie) {
              const currentMutated = mutatedShows[matchedMovie.id] || matchedMovie;
              const isSeen = currentMutated.seenEpisodes?.includes('movie') ||
                             currentMutated.status === 'completed' ||
                             !!currentMutated.episodeRecords?.['movie']?.watchedAt;
              if (isSeen) {
                continue; // Already in library via cached TMDB ID and already seen! Skip!
              }
            }
          }

          // 3. If still not resolved, query TMDB (only for genuinely unseen/unresolved titles)
          if (!matchedMovie && !tmdbData) {
            let searchRes = await tmdb.searchMedia(cleanMovieTitle, item.year ? String(item.year) : undefined, 'movie');
            if (!searchRes.ok || !searchRes.value) {
              searchRes = await tmdb.searchMedia(cleanMovieTitle, undefined, 'movie');
            }
            if (searchRes.ok && searchRes.value) {
              tmdbData = searchRes.value;
              resolutionCache[cacheKey] = tmdbData;
              cacheModified = true;

              // Check if we already have this TMDB ID in our library
              matchedMovie = showsList.find(
                (s) => Number(s.tmdbId) === Number(tmdbData.id) && s.mediaType === 'movie'
              );
              if (matchedMovie) {
                const currentMutated = mutatedShows[matchedMovie.id] || matchedMovie;
                const isSeen = currentMutated.seenEpisodes?.includes('movie') ||
                               currentMutated.status === 'completed' ||
                               !!currentMutated.episodeRecords?.['movie']?.watchedAt;
                if (isSeen) {
                  continue; // Found via TMDB search and already seen! Skip!
                }
              }
            }
          }

          if (matchedMovie) {
            const showId = matchedMovie.id;
            if (!mutatedShows[showId]) {
              mutatedShows[showId] = { ...matchedMovie };
            }
            const showData = mutatedShows[showId];
            const seenEpisodes = [...(showData.seenEpisodes || [])];

            // Check if already seen
            if (!seenEpisodes.includes('movie')) {
              seenEpisodes.push('movie');
              const episodeRecords = { ...(showData.episodeRecords || {}) };
              episodeRecords['movie'] = {
                watchedAt: viewedTimestamp,
                ...(episodeRecords['movie'] || {})
              };

              showData.seenEpisodes = seenEpisodes;
              showData.episodeRecords = episodeRecords;
              showData.lastWatchedAt = viewedTimestamp;
              showData.status = 'completed';
              showData.updatedAt = Date.now();

              syncCount++;
              moviesCount++;

              syncedItems.push({
                title: showData.title || movieTitle,
                subtitle: 'Film',
                posterPath: showData.posterPath,
                mediaType: 'movie',
                show: showData
              });

              appLogger.success('plex', `Film synchronisé : « ${showData.title} » (${item.source || 'Plex'})`, {
                showId,
                source: item.source,
                viewedAt: new Date(viewedTimestamp).toLocaleString('fr-FR')
              });
            }
          } else if (tmdbData && tmdbData.id) {
            // Genuinely new movie discovered from Plex!
            const newShowRef = doc(collection(db, `users/${user.uid}/shows`));
            const showId = newShowRef.id;

            const newShowData: Show = {
              id: showId,
              userId: user.uid,
              tmdbId: tmdbData.id,
              title: tmdbData.title || movieTitle,
              originalTitle: tmdbData.original_title || movieTitle,
              mediaType: 'movie',
              status: 'completed',
              createdAt: Date.now(),
              updatedAt: Date.now(),
              lastWatchedAt: viewedTimestamp,
              posterPath: tmdbData.poster_path
                ? tmdbData.poster_path.startsWith('http')
                  ? tmdbData.poster_path
                  : `https://image.tmdb.org/t/p/w500${tmdbData.poster_path}`
                : null,
              backdropPath: tmdbData.backdrop_path
                ? tmdbData.backdrop_path.startsWith('http')
                  ? tmdbData.backdrop_path
                  : `https://image.tmdb.org/t/p/w1280${tmdbData.backdrop_path}`
                : null,
              firstAirDate: tmdbData.release_date || '',
              networks: [],
              seenEpisodes: ['movie'],
              episodeRecords: { movie: { watchedAt: viewedTimestamp } },
              isArchived: false
            };

            mutatedShows[showId] = newShowData;
            showsList.push({
              ...newShowData,
              normTitle: normalizeTitle(newShowData.title),
              normOriginalTitle: normalizeTitle(newShowData.originalTitle)
            });

            syncCount++;
            moviesCount++;

            syncedItems.push({
              title: newShowData.title,
              subtitle: 'Film',
              posterPath: newShowData.posterPath,
              mediaType: 'movie',
              show: newShowData
            });

            appLogger.success('plex', `Nouveau film ajouté & marqué vu : « ${newShowData.title} » (${item.source || 'Plex'})`, {
              showId,
              tmdbId: tmdbData.id,
              source: item.source
            });
          }
        }
      }

      // Process Plex Watchlist items (auto-import to "À Voir" / "Ma Liste")
      if (hasWatchlist) {
        for (const wlItem of watchlist) {
          const mediaType: 'tv' | 'movie' = wlItem.type === 'show' ? 'tv' : 'movie';
          const rawTitle = wlItem.title || '';
          if (!rawTitle) continue;

          const cleanTitle = rawTitle.replace(/\(\d{4}\)/g, '').trim();
          const normTitle = normalizeTitle(cleanTitle);
          const guidTmdbId = extractTmdbIdFromPlex(wlItem);
          const cacheKey = `wl:${mediaType}:${normTitle}`;

          // 1. Check if already in user's local library
          let matchedShow = findShowInLocalLibrary(showsList, normTitle, guidTmdbId, mediaType);
          if (matchedShow) {
            continue;
          }

          // 2. Check resolution cache
          let tmdbData: any = null;
          if (resolutionCache[cacheKey]) {
            tmdbData = resolutionCache[cacheKey];
            matchedShow = showsList.find(
              (s) => Number(s.tmdbId) === Number(tmdbData.id) && (s.mediaType === mediaType || (mediaType === 'tv' && !s.mediaType))
            );
            if (matchedShow) continue;
          }

          // 3. Search TMDB if not in resolution cache
          if (!tmdbData) {
            let searchRes = await tmdb.searchMedia(cleanTitle, wlItem.year ? String(wlItem.year) : undefined, mediaType);
            if (!searchRes.ok || !searchRes.value) {
              searchRes = await tmdb.searchMedia(cleanTitle, undefined, mediaType);
            }
            if (searchRes.ok && searchRes.value) {
              tmdbData = searchRes.value;
              resolutionCache[cacheKey] = tmdbData;
              cacheModified = true;

              matchedShow = showsList.find(
                (s) => Number(s.tmdbId) === Number(tmdbData.id) && (s.mediaType === mediaType || (mediaType === 'tv' && !s.mediaType))
              );
              if (matchedShow) continue;
            }
          }

          // 4. Create new show in 'plan_to_watch' status ("À Voir" / "Ma Liste")
          if (tmdbData && tmdbData.id) {
            const newShowRef = doc(collection(db, `users/${user.uid}/shows`));
            const showId = newShowRef.id;

            const newShowData: Show = {
              id: showId,
              userId: user.uid,
              tmdbId: tmdbData.id,
              title: tmdbData.title || tmdbData.name || cleanTitle,
              originalTitle: tmdbData.original_title || tmdbData.original_name || cleanTitle,
              mediaType,
              status: 'plan_to_watch',
              createdAt: Date.now(),
              updatedAt: Date.now(),
              posterPath: tmdbData.poster_path
                ? tmdbData.poster_path.startsWith('http')
                  ? tmdbData.poster_path
                  : `https://image.tmdb.org/t/p/w500${tmdbData.poster_path}`
                : null,
              backdropPath: tmdbData.backdrop_path
                ? tmdbData.backdrop_path.startsWith('http')
                  ? tmdbData.backdrop_path
                  : `https://image.tmdb.org/t/p/w1280${tmdbData.backdrop_path}`
                : null,
              firstAirDate: tmdbData.first_air_date || tmdbData.release_date || '',
              networks: [],
              seenEpisodes: [],
              episodeRecords: {},
              isArchived: false
            };

            mutatedShows[showId] = newShowData;
            showsList.push({
              ...newShowData,
              normTitle: normalizeTitle(newShowData.title),
              normOriginalTitle: normalizeTitle(newShowData.originalTitle)
            });

            syncCount++;
            if (mediaType === 'movie') moviesCount++;

            syncedItems.push({
              title: newShowData.title,
              subtitle: mediaType === 'movie' ? 'Film' : 'Série',
              isWatchlist: true,
              posterPath: newShowData.posterPath,
              mediaType,
              show: newShowData
            });

            appLogger.success('plex', `Watchlist Plex : « ${newShowData.title} » ajouté aux médias À Voir`, {
              showId,
              tmdbId: tmdbData.id
            });
          }
        }
      }

      if (cacheModified) {
        saveResolutionCache(resolutionCache);
      }

      if (syncCount > 0) {
        // Save all mutated and new shows to Firestore
        for (const [id, data] of Object.entries(mutatedShows)) {
          const ref = doc(db, `users/${user.uid}/shows`, id);
          batch.set(ref, data, { merge: true });
        }

        await batch.commit();
        appLogger.success('plex', `Batch Firestore validé avec succès (${syncCount} élément(s) mis à jour)`);
        localStorage.setItem('plex_last_sync_timestamp', String(Date.now()));

        // Optimistically update the store
        const currentShows = useShowsStore.getState().shows;
        const mergedShows = [...currentShows];
        Object.keys(mutatedShows).forEach((showId) => {
          const mut = mutatedShows[showId];
          const idx = mergedShows.findIndex((s) => s.id === showId);
          if (idx >= 0) {
            mergedShows[idx] = { ...mergedShows[idx], ...mut };
          } else {
            mergedShows.push({ ...mut, id: showId });
          }
        });
        useShowsStore.getState().setShows(mergedShows);

        // Queue sequential toasts for each synced item (5s each)
        syncedItems.forEach((item) => {
          const actionText = item.isWatchlist
            ? 'Watchlist Plex • Ajouté à voir'
            : 'Vu sur Plex • Synchronisé';

          useToastStore.getState().showToast(
            {
              title: item.title,
              subtitle: item.subtitle,
              action: actionText,
              posterPath: item.posterPath
            },
            'success',
            item.show,
            undefined,
            5000
          );
        });

        clearPlexSyncStatusDelayed(`Synchro terminée (${syncCount} nouveau(x))`, 3500);
      } else {
        appLogger.info('plex', 'Synchronisation terminée : 0 nouveau média (votre bibliothèque est déjà à jour)');
        clearPlexSyncStatusDelayed('Sync Plex terminée (à jour)', 3500);
      }

      return {
        success: true,
        syncedCount: syncCount,
        moviesCount,
        episodesCount,
        syncedItems
      };
    } catch (err: any) {
      const errorMsg = err?.message || String(err);
      appLogger.error('plex', 'Exception lors de la synchronisation Plex', { error: errorMsg });
      clearPlexSyncStatusDelayed(`Erreur Plex : ${errorMsg}`, 4000);
      if (!silent) {
        useToastStore.getState().showToast(`Erreur de synchronisation Plex : ${errorMsg}`, 'error');
      }
      return { success: false, syncedCount: 0, moviesCount: 0, episodesCount: 0, syncedItems: [], error: errorMsg };
    }
  };

  activePlexSyncPromise = syncExecution().finally(() => {
    activePlexSyncPromise = null;
  });

  return activePlexSyncPromise;
}

