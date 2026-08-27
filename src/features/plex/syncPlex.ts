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

const extractExternalIdsFromPlex = (item: any): { tmdbId: number | null; imdbId: string | null; tvdbId: number | null } => {
  let tmdbId: number | null = null;
  let imdbId: string | null = null;
  let tvdbId: number | null = null;

  if (!item) return { tmdbId, imdbId, tvdbId };

  if (Array.isArray(item.Guid)) {
    for (const g of item.Guid) {
      if (typeof g?.id === 'string') {
        const tmdbMatch = g.id.match(/^tmdb:\/\/(\d+)/i) || g.id.match(/^themoviedb:\/\/(\d+)/i);
        if (tmdbMatch && !tmdbId) tmdbId = Number(tmdbMatch[1]);

        const imdbMatch = g.id.match(/^imdb:\/\/(tt\d+)/i);
        if (imdbMatch && !imdbId) imdbId = imdbMatch[1].toLowerCase();

        const tvdbMatch = g.id.match(/^tvdb:\/\/(\d+)/i);
        if (tvdbMatch && !tvdbId) tvdbId = Number(tvdbMatch[1]);
      }
    }
  }

  for (const field of [item.guid, item.grandparentGuid, item.parentGuid]) {
    if (typeof field === 'string') {
      const tmdbMatch = field.match(/themoviedb:\/\/(\d+)|tmdb:\/\/(\d+)|com\.plexapp\.agents\.themoviedb:\/\/(\d+)/i);
      if (tmdbMatch && !tmdbId) tmdbId = Number(tmdbMatch[1] || tmdbMatch[2] || tmdbMatch[3]);

      const imdbMatch = field.match(/imdb:\/\/(tt\d+)|com\.plexapp\.agents\.imdb:\/\/(tt\d+)/i);
      if (imdbMatch && !imdbId) imdbId = (imdbMatch[1] || imdbMatch[2]).toLowerCase();

      const tvdbMatch = field.match(/tvdb:\/\/(\d+)|thetvdb:\/\/(\d+)|com\.plexapp\.agents\.thetvdb:\/\/(\d+)/i);
      if (tvdbMatch && !tvdbId) tvdbId = Number(tvdbMatch[1] || tvdbMatch[2] || tvdbMatch[3]);
    }
  }

  return { tmdbId, imdbId, tvdbId };
};

const extractTmdbIdFromPlex = (item: any): number | null => {
  return extractExternalIdsFromPlex(item).tmdbId;
};

// Helper to sanitize show object for Firestore (strip undefined, internal norm fields)
function cleanShowForFirestore(show: any, userId: string): Record<string, any> {
  const clean: Record<string, any> = {};
  for (const [k, v] of Object.entries(show)) {
    if (v === undefined || k === 'normTitle' || k === 'normOriginalTitle') {
      continue;
    }
    clean[k] = v;
  }
  clean.userId = userId;
  clean.updatedAt = clean.updatedAt || Date.now();
  return clean;
}

// Persistent title -> TMDB resolution cache in localStorage
const getResolutionCache = (): Record<string, any> => {
  try {
    const raw = localStorage.getItem('plex_resolution_cache');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    // Automatic cleanup of legacy incorrect Cinderella (1899) cache mappings
    Object.keys(parsed).forEach(k => {
      if (parsed[k]?.id === 114108 || (k.includes('cinderella') && parsed[k]?.id !== 150689) || (k.includes('cendrillon') && parsed[k]?.id !== 150689)) {
        delete parsed[k];
      }
    });
    return parsed;
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
  mediaType: 'tv' | 'movie',
  targetYear?: number | string
): (Show & { normTitle: string; normOriginalTitle: string }) | undefined => {
  // 1. By exact TMDB ID (always 100% authoritative)
  if (tmdbId) {
    const byId = showsList.find(
      s => Number(s.tmdbId) === Number(tmdbId) && (mediaType === 'tv' ? (s.mediaType === 'tv' || !s.mediaType) : s.mediaType === 'movie')
    );
    if (byId) return byId;
  }

  const numericTargetYear = targetYear ? Number(targetYear) : undefined;
  const isYearCompatible = (show: Show): boolean => {
    if (!numericTargetYear || isNaN(numericTargetYear)) return true;
    const showDate = show.firstAirDate || (show as any).releaseDate || (show as any).release_date;
    if (!showDate) return true;
    const showYear = parseInt(String(showDate).slice(0, 4), 10);
    if (isNaN(showYear)) return true;
    return Math.abs(showYear - numericTargetYear) <= 1;
  };

  // 2. Exact normalized title or original title with compatible year
  const exact = showsList.find(
    s =>
      (mediaType === 'tv' ? (s.mediaType === 'tv' || !s.mediaType) : s.mediaType === 'movie') &&
      (s.normTitle === normTitle || (s.normOriginalTitle && s.normOriginalTitle === normTitle)) &&
      isYearCompatible(s)
  );
  if (exact) return exact;

  // 3. Smart prefix or substring inclusion with compatible year
  // e.g. "the handmaids tale la servante ecarlate" vs "the handmaids tale"
  if (normTitle && normTitle.length >= 4) {
    const fuzzy = showsList.find(s => {
      if (mediaType === 'tv' ? s.mediaType === 'movie' : (s.mediaType !== 'movie' && s.mediaType)) return false;
      if (!isYearCompatible(s)) return false;
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

  appLogger.info('plex', `Début requête Plex (${isNative ? 'APK Natif' : 'PWA Web'}, Mode: ${delta ? 'Rapide' : 'Complet'})`);

  for (const url of urlsToTry) {
    // Skip relative path on native platform as it resolves to localhost
    if (isNative && url === '/api/plex/history') continue;

    try {
      appLogger.info('plex', `Interrogation endpoint Backend : ${url}`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, clientId, delta, since }),
        signal: AbortSignal.timeout(18000)
      });

      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        const data = await res.json();
        if (data && (Array.isArray(data.history) || Array.isArray(data.watchlist))) {
          const histLen = Array.isArray(data.history) ? data.history.length : 0;
          const watchLen = Array.isArray(data.watchlist) ? data.watchlist.length : 0;
          appLogger.success('plex', `Données Plex reçues de ${url} : ${histLen} visionnage(s), ${watchLen} watchlist`);
          return data;
        }
      } else {
        appLogger.warn('plex', `Endpoint ${url} a répondu avec statut ${res.status}`);
      }
    } catch (e: any) {
      appLogger.warn('plex', `Échec connexion endpoint ${url} : ${e?.message || e}`);
      console.warn(`[Plex Sync] Call to ${url} failed, trying next fallback...`, e);
    }
  }

  appLogger.warn('plex', 'Tous les backends ont échoué ou ont expiré. Tentative d\'accès direct aux API Plex Cloud...');
  // Fallback: Fetch directly from official Plex Cloud APIs on native device / fallback
  return fetchPlexDirectlyFromClient(token, clientId);
}

async function fetchPlexDirectlyFromClient(token: string, clientId: string) {
  const rawWatchlistItems: any[] = [];
  const rawHistoryItems: any[] = [];

  const extractItems = (data: any): any[] => {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.activities)) return data.activities;
    if (data.MediaContainer && Array.isArray(data.MediaContainer.Metadata)) return data.MediaContainer.Metadata;
    if (Array.isArray(data.Metadata)) return data.Metadata;
    if (Array.isArray(data.items)) return data.items;
    return [];
  };

  // 1. Fetch Watchlist
  const watchlistEndpoints = [
    'https://discover.provider.plex.tv/library/sections/watchlist/all?includeUserState=1',
    'https://metadata.provider.plex.tv/library/sections/watchlist/all?includeUserState=1'
  ];

  for (const endpoint of watchlistEndpoints) {
    try {
      appLogger.info('plex', `Lecture Watchlist Plex Cloud direct (${endpoint.split('/')[2]})...`);
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
          const items = extractItems(data);
          if (items.length > 0) {
            rawWatchlistItems.push(...items);
            appLogger.success('plex', `Plex Cloud Watchlist direct : ${items.length} éléments récupérés`);
            break;
          }
        }
      }
    } catch (err: any) {
      appLogger.warn('plex', `Échec lecture Watchlist Plex Cloud direct: ${err?.message || err}`);
      console.warn('[Plex Sync] Direct client watchlist fetch failed:', err);
    }
  }

  // 2. Fetch Watched Activity & History directly from Plex Cloud
  const historyEndpoints = [
    'https://discover.provider.plex.tv/activities?includeUserState=1&limit=100',
    'https://metadata.provider.plex.tv/library/metadata/userState?state=watched&limit=100'
  ];

  for (const endpoint of historyEndpoints) {
    try {
      appLogger.info('plex', `Lecture Historique Plex Cloud direct (${endpoint.split('/')[2]})...`);
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
          const items = extractItems(data);
          if (items.length > 0) {
            for (const it of items) {
              rawHistoryItems.push({ raw: it, source: 'Plex Cloud Direct' });
            }
            appLogger.success('plex', `Plex Cloud Historique direct : ${items.length} éléments vus trouvés`);
          }
        }
      }
    } catch (err: any) {
      appLogger.warn('plex', `Échec lecture Historique Plex Cloud direct: ${err?.message || err}`);
      console.warn('[Plex Sync] Direct client history fetch failed:', err);
    }
  }

  return {
    history: rawHistoryItems,
    watchlist: rawWatchlistItems,
    visitedSources: ['Plex Cloud Direct']
  };
}

let activePlexSyncPromise: Promise<PlexSyncResult> | null = null;

export async function performPlexSync(options: { delta?: boolean; silent?: boolean; ignoreCooldown?: boolean } = {}): Promise<PlexSyncResult> {
  const { delta = true, silent = false, ignoreCooldown = false } = options;

  if (activePlexSyncPromise) {
    // // appLogger.info('plex', 'Une synchronisation Plex est déjà en cours, réutilisation de la requête existante...');
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
        // // appLogger.info('plex', 'Aucun compte Plex associé');
      }
      return { success: false, syncedCount: 0, moviesCount: 0, episodesCount: 0, syncedItems: [], error: 'Aucun compte Plex associé' };
    }

    // Cooldown check (30 min) pour les synchronisations automatiques
    if (!ignoreCooldown && lastSyncTimestamp && !isNaN(lastSyncTimestamp)) {
      const elapsedMinutes = (Date.now() - lastSyncTimestamp) / (1000 * 60);
      if (elapsedMinutes < 30) {
        // // appLogger.info('plex', `Synchronisation automatique Plex ignorée : dernière synchronisation il y a ${Math.round(elapsedMinutes)} min (< 30 min)`);
        return { success: true, syncedCount: 0, moviesCount: 0, episodesCount: 0, syncedItems: [] };
      }
    }

    // // appLogger.info('plex', `Démarrage de la synchronisation Plex (${delta ? 'Mode Delta / Rapide' : 'Mode Complet'})...`);
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
        // // appLogger.info('plex', `Plex vérifié : aucun nouveau média ni watchlist${sourcesMsg}`);
        localStorage.setItem('plex_last_sync_timestamp', String(Date.now()));
        clearPlexSyncStatusDelayed('Sync Plex terminée (à jour)', 3500);
        return { success: true, syncedCount: 0, moviesCount: 0, episodesCount: 0, syncedItems: [] };
      }

      const totalItemsCount = (history?.length || 0) + (watchlist?.length || 0);
      const sourcesSummary = visitedSources && visitedSources.length > 0 ? ` [Sources: ${visitedSources.join(', ')}]` : '';
      // // appLogger.info('plex', `${history?.length || 0} historique(s) + ${watchlist?.length || 0} watchlist(s) récupéré(s) depuis Plex${sourcesSummary}`, { sample: (history || []).slice(0, 5) });
      if (!silent) {
        useSyncStore.getState().setPlexSyncStatus({ 
          message: `Analyse Plex (${totalItemsCount} élément(s)...)` 
        });
      }

      // Load fresh shows from Firestore or current store
      const localShows = useShowsStore.getState().shows;
      const showsList: Array<Show & { normTitle: string; normOriginalTitle: string }> = localShows
        .filter(s => Number(s.tmdbId) !== 114108) // Filter out obsolete Cinderella 1899
        .map((s) => ({
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

      const deleteDocIds: string[] = [];
      // Purge bad 1899 Cinderella from Firestore if present
      for (const s of localShows) {
        if (Number(s.tmdbId) === 114108 && s.id) {
          deleteDocIds.push(s.id);
        }
      }

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
        const { tmdbId: guidTmdbId, imdbId, tvdbId } = extractExternalIdsFromPlex(item);

        let itemYear = item.year ? Number(item.year) : undefined;
        if (!itemYear) {
          const matchYear = (item.title || item.grandparentTitle || '').match(/\((\d{4})\)/);
          if (matchYear) itemYear = Number(matchYear[1]);
        }

        if (type === 'episode') {
          const seasonNum = item.parentIndex;
          const episodeNum = item.index;
          const showTitle = item.grandparentTitle || item.title;
          if (!showTitle || seasonNum === undefined || episodeNum === undefined) continue;

          const epKey = `${seasonNum}x${episodeNum}`;
          const cleanShowTitle = showTitle.replace(/\(\d{4}\)/g, '').trim();
          const normPlexTitle = normalizeTitle(cleanShowTitle);
          const cacheKey = itemYear ? `tv:${normPlexTitle}:${itemYear}` : `tv:${normPlexTitle}`;

          // 1. Check in local library by TMDB ID, title, original title, or smart inclusion (with year check)
          let matchedShow = findShowInLocalLibrary(showsList, normPlexTitle, guidTmdbId, 'tv', itemYear);

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

          // 3. If still not resolved, query external IDs or TMDB
          if (!matchedShow && !tmdbData) {
            if (guidTmdbId) {
              const detailsRes = await tmdb.getMediaDetails(guidTmdbId, 'tv');
              if (detailsRes.ok && detailsRes.value) {
                tmdbData = detailsRes.value;
              }
            } else if (imdbId) {
              const findRes = await tmdb.findByExternalId(imdbId, 'imdb_id', 'tv');
              if (findRes.ok && findRes.value) {
                tmdbData = findRes.value;
              }
            } else if (tvdbId) {
              const findRes = await tmdb.findByExternalId(String(tvdbId), 'tvdb_id', 'tv');
              if (findRes.ok && findRes.value) {
                tmdbData = findRes.value;
              }
            }

            if (!tmdbData) {
              let searchRes = await tmdb.searchMedia(cleanShowTitle, itemYear ? String(itemYear) : undefined, 'tv');
              if (!searchRes.ok || !searchRes.value) {
                searchRes = await tmdb.searchMedia(cleanShowTitle, undefined, 'tv');
              }
              if (searchRes.ok && searchRes.value) {
                tmdbData = searchRes.value;
              }
            }

            if (tmdbData) {
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
          }
        } else if (type === 'movie') {
          const movieTitle = item.title;
          if (!movieTitle) continue;

          const cleanMovieTitle = movieTitle.replace(/\(\d{4}\)/g, '').trim();
          const normMovieTitle = normalizeTitle(cleanMovieTitle);
          const cacheKey = itemYear ? `movie:${normMovieTitle}:${itemYear}` : `movie:${normMovieTitle}`;

          // 1. Check in local library (with year verification)
          let matchedMovie = findShowInLocalLibrary(showsList, normMovieTitle, guidTmdbId, 'movie', itemYear);

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

          // 3. If still not resolved, query external IDs or TMDB
          if (!matchedMovie && !tmdbData) {
            if (guidTmdbId) {
              const detailsRes = await tmdb.getMediaDetails(guidTmdbId, 'movie');
              if (detailsRes.ok && detailsRes.value) {
                tmdbData = detailsRes.value;
              }
            } else if (imdbId) {
              const findRes = await tmdb.findByExternalId(imdbId, 'imdb_id', 'movie');
              if (findRes.ok && findRes.value) {
                tmdbData = findRes.value;
              }
            } else if (tvdbId) {
              const findRes = await tmdb.findByExternalId(String(tvdbId), 'tvdb_id', 'movie');
              if (findRes.ok && findRes.value) {
                tmdbData = findRes.value;
              }
            }

            if (!tmdbData) {
              let searchRes = await tmdb.searchMedia(cleanMovieTitle, itemYear ? String(itemYear) : undefined, 'movie');
              if (!searchRes.ok || !searchRes.value) {
                searchRes = await tmdb.searchMedia(cleanMovieTitle, undefined, 'movie');
              }
              if (searchRes.ok && searchRes.value) {
                tmdbData = searchRes.value;
              }
            }

            if (tmdbData) {
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

          // Auto-cleanup false-positive Cinderella 1899 (TMDB 114108) if Cinderella 2015 is being processed
          const targetTmdbId = matchedMovie?.tmdbId || tmdbData?.id;
          if (targetTmdbId === 150689) {
            const bad1899 = showsList.find(s => Number(s.tmdbId) === 114108);
            if (bad1899 && bad1899.id) {
              deleteDocIds.push(bad1899.id);
              const idx = showsList.findIndex(s => s.id === bad1899.id);
              if (idx >= 0) showsList.splice(idx, 1);
              delete mutatedShows[bad1899.id];
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
          }
        }
      }

      // Process Plex Watchlist items (auto-import to "À Voir" / "Ma Liste")
      if (hasWatchlist) {
        for (const wlItem of watchlist) {
          const mediaType: 'tv' | 'movie' = wlItem.type === 'show' ? 'tv' : 'movie';
          const rawTitle = wlItem.title || '';
          if (!rawTitle) continue;

          let wlYear = wlItem.year ? Number(wlItem.year) : undefined;
          if (!wlYear) {
            const matchYear = rawTitle.match(/\((\d{4})\)/);
            if (matchYear) wlYear = Number(matchYear[1]);
          }

          const cleanTitle = rawTitle.replace(/\(\d{4}\)/g, '').trim();
          const normTitle = normalizeTitle(cleanTitle);
          const { tmdbId: guidTmdbId, imdbId, tvdbId } = extractExternalIdsFromPlex(wlItem);
          const cacheKey = wlYear ? `wl:${mediaType}:${normTitle}:${wlYear}` : `wl:${mediaType}:${normTitle}`;

          // 1. Check if already in user's local library
          let matchedShow = findShowInLocalLibrary(showsList, normTitle, guidTmdbId, mediaType, wlYear);
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

          // 3. Search external IDs or TMDB if not in resolution cache
          if (!tmdbData) {
            if (guidTmdbId) {
              const detailsRes = await tmdb.getMediaDetails(guidTmdbId, mediaType);
              if (detailsRes.ok && detailsRes.value) {
                tmdbData = detailsRes.value;
              }
            } else if (imdbId) {
              const findRes = await tmdb.findByExternalId(imdbId, 'imdb_id', mediaType);
              if (findRes.ok && findRes.value) {
                tmdbData = findRes.value;
              }
            } else if (tvdbId) {
              const findRes = await tmdb.findByExternalId(String(tvdbId), 'tvdb_id', mediaType);
              if (findRes.ok && findRes.value) {
                tmdbData = findRes.value;
              }
            }

            if (!tmdbData) {
              let searchRes = await tmdb.searchMedia(cleanTitle, wlYear ? String(wlYear) : undefined, mediaType);
              if (!searchRes.ok || !searchRes.value) {
                searchRes = await tmdb.searchMedia(cleanTitle, undefined, mediaType);
              }
              if (searchRes.ok && searchRes.value) {
                tmdbData = searchRes.value;
              }
            }

            if (tmdbData) {
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
          }
        }
      }

      if (cacheModified) {
        saveResolutionCache(resolutionCache);
      }

      // 1. Execute deletions if any bad entries were flagged
      if (deleteDocIds.length > 0) {
        try {
          const delBatch = writeBatch(db);
          for (const delId of deleteDocIds) {
            delBatch.delete(doc(db, `users/${user.uid}/shows`, delId));
          }
          await delBatch.commit();
        } catch (delErr) {
          console.warn('[Plex Sync] Warning deleting bad items:', delErr);
        }
      }

      if (syncCount > 0 || Object.keys(mutatedShows).length > 0) {
        // 2. Save all mutated and new shows to Firestore in safe chunks of 250
        const showEntries = Object.entries(mutatedShows);
        const BATCH_SIZE = 250;
        for (let i = 0; i < showEntries.length; i += BATCH_SIZE) {
          const chunk = showEntries.slice(i, i + BATCH_SIZE);
          const chunkBatch = writeBatch(db);
          for (const [id, data] of chunk) {
            const ref = doc(db, `users/${user.uid}/shows`, id);
            const cleanData = cleanShowForFirestore(data, user.uid);
            chunkBatch.set(ref, cleanData, { merge: true });
          }
          await chunkBatch.commit();
        }

        // appLogger.success('plex', `Batch Firestore validé avec succès (${syncCount} élément(s) mis à jour)`);
        localStorage.setItem('plex_last_sync_timestamp', String(Date.now()));

        // 3. Optimistically update the store
        const currentShows = useShowsStore.getState().shows;
        const mergedShows = currentShows.filter(s => Number(s.tmdbId) !== 114108 && !deleteDocIds.includes(s.id));
        Object.keys(mutatedShows).forEach((showId) => {
          const mut = cleanShowForFirestore(mutatedShows[showId], user.uid) as Show;
          const idx = mergedShows.findIndex((s) => s.id === showId || (s.tmdbId && mut.tmdbId && Number(s.tmdbId) === Number(mut.tmdbId) && s.mediaType === mut.mediaType));
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
        // Clean local store of bad entries if any were deleted
        if (deleteDocIds.length > 0) {
          const currentShows = useShowsStore.getState().shows.filter(s => Number(s.tmdbId) !== 114108 && !deleteDocIds.includes(s.id));
          useShowsStore.getState().setShows(currentShows);
        }
        // // appLogger.info('plex', 'Synchronisation terminée : 0 nouveau média (votre bibliothèque est déjà à jour)');
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

