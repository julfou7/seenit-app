import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { db, auth } from '../../lib/firebase';
import { collection, doc, writeBatch, getDocs, updateDoc, deleteField } from 'firebase/firestore';
import { tmdb } from '../shows/tmdb';
import { useShowsStore } from '../../store/showsStore';
import { useSyncStore } from '../../store/syncStore';
import { useToastStore } from '../../store/toastStore';
import { openExternalUrl } from '../../lib/utils';
import { appLogger } from '../../store/logStore';
import { getPlexClientId } from '../../services/plex';
import { Show } from '../../types';
import { CURRENT_APP_VERSION } from '../../store/updateStore';

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

export const extractExternalIdsFromPlex = (item: any) => {
  let tmdbId: number | null = null;
  let imdbId: string | null = null;
  let tvdbId: number | null = null;
  let plexGuid: string | null = null;

  if (!item) return { tmdbId, imdbId, tvdbId, plexGuid };

  const processGuidStr = (str: string) => {
    if (!str || typeof str !== 'string') return;
    const tmdbMatch = str.match(/themoviedb:\/\/(\d+)|tmdb:\/\/(\d+)|com\.plexapp\.agents\.themoviedb:\/\/(\d+)/i);
    if (tmdbMatch && !tmdbId) {
      tmdbId = Number(tmdbMatch[1] || tmdbMatch[2] || tmdbMatch[3]);
    }
    const imdbMatch = str.match(/imdb:\/\/(tt\d+)|com\.plexapp\.agents\.imdb:\/\/(tt\d+)/i);
    if (imdbMatch && !imdbId) {
      imdbId = (imdbMatch[1] || imdbMatch[2]).toLowerCase();
    }
    const tvdbMatch = str.match(/tvdb:\/\/(\d+)|com\.plexapp\.agents\.thetvdb:\/\/(\d+)/i);
    if (tvdbMatch && !tvdbId) {
      tvdbId = Number(tvdbMatch[1] || tvdbMatch[2]);
    }
    const plexMatch = str.match(/plex:\/\/(movie|show)\/([a-f0-9]+)/i);
    if (plexMatch && !plexGuid) {
      plexGuid = plexMatch[2];
    }
  };

  if (Array.isArray(item.Guid)) {
    for (const g of item.Guid) {
      if (typeof g?.id === 'string') {
        processGuidStr(g.id);
      }
    }
  }

  for (const field of [item.guid, item.grandparentGuid, item.parentGuid]) {
    if (typeof field === 'string') {
      processGuidStr(field);
    }
  }

  return { tmdbId, imdbId, tvdbId, plexGuid };
};

const extractTmdbIdFromPlex = (item: any): number | null => {
  return extractExternalIdsFromPlex(item).tmdbId;
};

async function resolveTmdbDataForPlexItem(
  item: any,
  mediaType: 'tv' | 'movie',
  plexToken?: string
): Promise<any | null> {
  const rawTitle = item.title || item.grandparentTitle || item.parentTitle || 'Titre inconnu';
  const guidStr = item.guid || item.grandparentGuid || item.parentGuid || '';
  const origTitle = item.originalTitle || '';
  const year = item.year || item.originallyAvailableAt?.substring(0, 4) || '';

  appLogger.info(
    'plex',
    `[Plex Resolve] 🔍 Résolution TMDB pour "${rawTitle}" (${mediaType}) | guid="${guidStr}" | origTitle="${origTitle}" | year=${year} | ratingKey=${item.ratingKey || item.key || ''}`
  );

  const { tmdbId, imdbId, tvdbId, plexGuid } = extractExternalIdsFromPlex(item);
  appLogger.info(
    'plex',
    `[Plex Resolve] IDs extraits pour "${rawTitle}": tmdbId=${tmdbId || 'aucun'}, imdbId=${imdbId || 'aucun'}, tvdbId=${tvdbId || 'aucun'}, plexGuid=${plexGuid || 'aucun'}`
  );

  // 1. Direct TMDB ID
  if (tmdbId) {
    appLogger.info('plex', `[Plex Resolve] Tentative TMDB ID direct (${tmdbId})...`);
    const detailsRes = await tmdb.getMediaDetails(tmdbId, mediaType);
    if (detailsRes.ok && detailsRes.value) {
      appLogger.info('plex', `[Plex Resolve] ✅ TMDB ID direct (${tmdbId}) trouvé: "${detailsRes.value.title || detailsRes.value.name}"`);
      return detailsRes.value;
    } else {
      const errorMsg = !detailsRes.ok ? String((detailsRes as any).error?.message || (detailsRes as any).error) : 'Données non reçues';
      appLogger.warn('plex', `[Plex Resolve] ⚠️ Échec TMDB ID direct (${tmdbId}): ${errorMsg}`);
    }
  }

  // 2. IMDb ID
  if (imdbId) {
    appLogger.info('plex', `[Plex Resolve] Tentative IMDb ID (${imdbId})...`);
    const findRes = await tmdb.findByExternalId(imdbId, 'imdb_id', mediaType);
    if (findRes.ok && findRes.value) {
      appLogger.info('plex', `[Plex Resolve] ✅ IMDb ID (${imdbId}) résolu -> TMDB ID ${findRes.value.id} ("${findRes.value.title || findRes.value.name}")`);
      return findRes.value;
    } else {
      const errorMsg = !findRes.ok ? String((findRes as any).error?.message || (findRes as any).error) : 'Données non reçues';
      appLogger.warn('plex', `[Plex Resolve] ⚠️ Échec IMDb ID (${imdbId}): ${errorMsg}`);
    }
  }

  // 3. TVDb ID
  if (tvdbId) {
    appLogger.info('plex', `[Plex Resolve] Tentative TVDb ID (${tvdbId})...`);
    const findRes = await tmdb.findByExternalId(String(tvdbId), 'tvdb_id', mediaType);
    if (findRes.ok && findRes.value) {
      appLogger.info('plex', `[Plex Resolve] ✅ TVDb ID (${tvdbId}) résolu -> TMDB ID ${findRes.value.id} ("${findRes.value.title || findRes.value.name}")`);
      return findRes.value;
    } else {
      const errorMsg = !findRes.ok ? String((findRes as any).error?.message || (findRes as any).error) : 'Données non reçues';
      appLogger.warn('plex', `[Plex Resolve] ⚠️ Échec TVDb ID (${tvdbId}): ${errorMsg}`);
    }
  }

  // 4. Plex Discover metadata API lookup for plex:// GUIDs
  const pKey = plexGuid || (typeof item.guid === 'string' && item.guid.startsWith('plex://') ? item.guid.replace(/^plex:\/\/(movie|show)\//, '') : null) || item.ratingKey || item.key;
  if (pKey && plexToken) {
    try {
      const cleanKey = String(pKey).replace('/library/metadata/', '');
      const plexMetaUrl = `https://discover.provider.plex.tv/library/metadata/${cleanKey}?X-Plex-Token=${plexToken}`;
      appLogger.info('plex', `[Plex Resolve] Appel API Plex Discover: ${plexMetaUrl}`);
      const res = await fetch(plexMetaUrl, { headers: { 'Accept': 'application/json' } });
      if (res.ok) {
        const data = await res.json();
        const metaItem = data?.MediaContainer?.Metadata?.[0];
        if (metaItem) {
          appLogger.info('plex', `[Plex Resolve] Discover API pour "${cleanKey}": guid="${metaItem.guid}", Guids=${JSON.stringify(metaItem.Guid || [])}`);
          const fetchedIds = extractExternalIdsFromPlex(metaItem);
          if (fetchedIds.tmdbId) {
            const detailsRes = await tmdb.getMediaDetails(fetchedIds.tmdbId, mediaType);
            if (detailsRes.ok && detailsRes.value) {
              appLogger.info('plex', `[Plex Resolve] ✅ Discover Plex -> TMDB ID ${fetchedIds.tmdbId}`);
              return detailsRes.value;
            }
          }
          if (fetchedIds.imdbId) {
            const findRes = await tmdb.findByExternalId(fetchedIds.imdbId, 'imdb_id', mediaType);
            if (findRes.ok && findRes.value) {
              appLogger.info('plex', `[Plex Resolve] ✅ Discover Plex -> IMDb (${fetchedIds.imdbId}) -> TMDB ID ${findRes.value.id}`);
              return findRes.value;
            }
          }
          if (fetchedIds.tvdbId) {
            const findRes = await tmdb.findByExternalId(String(fetchedIds.tvdbId), 'tvdb_id', mediaType);
            if (findRes.ok && findRes.value) {
              appLogger.info('plex', `[Plex Resolve] ✅ Discover Plex -> TVDb (${fetchedIds.tvdbId}) -> TMDB ID ${findRes.value.id}`);
              return findRes.value;
            }
          }
        } else {
          appLogger.warn('plex', `[Plex Resolve] Discover Plex Metadata vide pour la clé ${cleanKey}`);
        }
      } else {
        appLogger.warn('plex', `[Plex Resolve] API Plex Discover HTTP code ${res.status}`);
      }
    } catch (err: any) {
      appLogger.warn('plex', `[Plex Resolve] Exception API Plex Discover: ${err?.message || err}`);
    }
  }

  // 5. Fallback TMDB search by title & year
  const titlesToTry: string[] = [];
  if (rawTitle) {
    const cleanTitle = rawTitle.replace(/\(\d{4}\)/g, '').trim();
    if (cleanTitle) titlesToTry.push(cleanTitle);
    if (cleanTitle.includes(':')) {
      const mainPart = cleanTitle.split(':')[0].trim();
      if (mainPart && !titlesToTry.includes(mainPart)) titlesToTry.push(mainPart);
    }
    if (cleanTitle.includes(' - ')) {
      const mainPart = cleanTitle.split(' - ')[0].trim();
      if (mainPart && !titlesToTry.includes(mainPart)) titlesToTry.push(mainPart);
    }
  }
  if (origTitle && typeof origTitle === 'string') {
    const cleanOrig = origTitle.replace(/\(\d{4}\)/g, '').trim();
    if (cleanOrig && !titlesToTry.includes(cleanOrig)) titlesToTry.push(cleanOrig);
  }

  for (const tQuery of titlesToTry) {
    appLogger.info('plex', `[Plex Resolve] Recherche fallback TMDB pour "${tQuery}" (année: ${year || 'aucune'})...`);
    if (year) {
      const searchRes = await tmdb.searchMedia(tQuery, String(year), mediaType);
      if (searchRes.ok && searchRes.value) {
        appLogger.info('plex', `[Plex Resolve] ✅ TMDB Fallback Search ("${tQuery}", ${year}) -> TMDB ID ${searchRes.value.id}`);
        return searchRes.value;
      } else {
        const errorMsg = !searchRes.ok ? String((searchRes as any).error?.message || (searchRes as any).error) : '0 résultat';
        appLogger.warn('plex', `[Plex Resolve] Fallback Search ("${tQuery}", ${year}): ${errorMsg}`);
      }
    }
    const searchNoYearRes = await tmdb.searchMedia(tQuery, undefined, mediaType);
    if (searchNoYearRes.ok && searchNoYearRes.value) {
      appLogger.info('plex', `[Plex Resolve] ✅ TMDB Fallback Search ("${tQuery}", sans année) -> TMDB ID ${searchNoYearRes.value.id}`);
      return searchNoYearRes.value;
    } else {
      const errorMsg = !searchNoYearRes.ok ? String((searchNoYearRes as any).error?.message || (searchNoYearRes as any).error) : '0 résultat';
      appLogger.warn('plex', `[Plex Resolve] Fallback Search ("${tQuery}", sans année): ${errorMsg}`);
    }
  }

  appLogger.error('plex', `[Plex Resolve] ❌ ÉCHEC FINAL pour "${rawTitle}" (${mediaType}). PayLoad brute: ${JSON.stringify({ title: item.title, grandparentTitle: item.grandparentTitle, originalTitle: item.originalTitle, guid: item.guid, Guid: item.Guid, year: item.year, ratingKey: item.ratingKey })}`);
  return null;
}

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
    const keys = Object.keys(cache);
    if (keys.length > 500) {
      const trimmed = Object.fromEntries(keys.slice(-400).map(k => [k, cache[k]]));
      localStorage.setItem('plex_resolution_cache', JSON.stringify(trimmed));
    } else {
      localStorage.setItem('plex_resolution_cache', JSON.stringify(cache));
    }
  } catch {}
};

const buildPlexResolutionCacheKey = (
  mediaType: 'tv' | 'movie',
  tmdbId?: number | null
): string | null => {
  if (tmdbId) {
    return `${mediaType}:tmdb:${Number(tmdbId)}`;
  }
  return null;
};

const findShowInLocalLibrary = (
  showsList: Array<Show & {
    normTitle: string;
    normOriginalTitle: string;
  }>,
  tmdbId: number | null,
  mediaType: 'tv' | 'movie'
): (Show & {
  normTitle: string;
  normOriginalTitle: string;
}) | undefined => {
  if (!tmdbId) return undefined;

  const isCorrectMediaType = (show: Show): boolean => {
    if (mediaType === 'tv') {
      return show.mediaType === 'tv' || !show.mediaType;
    }
    return show.mediaType === 'movie';
  };

  return showsList.find(
    s => isCorrectMediaType(s) && Number(s.tmdbId) === Number(tmdbId)
  );
};

const PLEX_BACKEND_ENDPOINTS = [
  'https://seenit.ai.studio/api/plex/history',
  'https://ais-pre-mooctibtw2amkshvkzlqij-700628279309.europe-west2.run.app/api/plex/history',
  'https://ais-dev-mooctibtw2amkshvkzlqij-700628279309.europe-west2.run.app/api/plex/history'
];

const PLEX_RESOLVE_ENDPOINTS = [
  'https://seenit.ai.studio/api/plex/resolve-slug',
  'https://ais-pre-mooctibtw2amkshvkzlqij-700628279309.europe-west2.run.app/api/plex/resolve-slug',
  'https://ais-dev-mooctibtw2amkshvkzlqij-700628279309.europe-west2.run.app/api/plex/resolve-slug'
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
      let isOk = false;
      let status = 0;
      let data: any = null;

      if (isNative) {
        const nativeRes = await CapacitorHttp.post({
          url,
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          data: { token, clientId, delta, since },
          connectTimeout: 20000,
          readTimeout: 20000
        });
        status = nativeRes.status;
        isOk = status >= 200 && status < 300;
        if (isOk) {
          data = typeof nativeRes.data === 'string' ? JSON.parse(nativeRes.data) : nativeRes.data;
        }
      } else {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20000);
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ token, clientId, delta, since }),
          signal: controller.signal
        });
        clearTimeout(timer);
        status = res.status;
        isOk = res.ok;
        const contentType = res.headers.get('content-type') || '';
        if (isOk && contentType.includes('application/json')) {
          data = await res.json();
        }
      }

      if (isOk && data && (Array.isArray(data.history) || Array.isArray(data.watchlist))) {
        const histLen = Array.isArray(data.history) ? data.history.length : 0;
        const watchLen = Array.isArray(data.watchlist) ? data.watchlist.length : 0;
        appLogger.success('plex', `Données Plex reçues de ${url} : ${histLen} visionnage(s), ${watchLen} watchlist`);
        return data;
      } else {
        appLogger.warn('plex', `Endpoint ${url} a répondu avec statut ${status}`);
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

  const isNative = Capacitor.isNativePlatform();

  // 1. Fetch Watchlist
  const watchlistEndpoints = [
    'https://discover.provider.plex.tv/library/sections/watchlist/all?includeUserState=1',
    'https://metadata.provider.plex.tv/library/sections/watchlist/all?includeUserState=1'
  ];

  for (const endpoint of watchlistEndpoints) {
    try {
      appLogger.info('plex', `Lecture Watchlist Plex Cloud direct (${endpoint.split('/')[2]})...`);
      let data: any = null;
      let isOk = false;

      if (isNative) {
        const nativeRes = await CapacitorHttp.get({
          url: endpoint,
          headers: {
            'X-Plex-Token': token,
            'Accept': 'application/json',
            'X-Plex-Client-Identifier': clientId,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          connectTimeout: 10000,
          readTimeout: 10000
        });
        isOk = nativeRes.status >= 200 && nativeRes.status < 300;
        if (isOk) {
          data = typeof nativeRes.data === 'string' ? JSON.parse(nativeRes.data) : nativeRes.data;
        }
      } else {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);
        const res = await fetch(endpoint, {
          headers: {
            'X-Plex-Token': token,
            'Accept': 'application/json',
            'X-Plex-Client-Identifier': clientId,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          signal: controller.signal
        });
        clearTimeout(timer);
        isOk = res.ok;
        if (isOk && (res.headers.get('content-type') || '').includes('application/json')) {
          data = await res.json();
        }
      }

      if (isOk && data) {
        const items = extractItems(data);
        if (items.length > 0) {
          rawWatchlistItems.push(...items);
          appLogger.success('plex', `Plex Cloud Watchlist direct : ${items.length} éléments récupérés`);
          break;
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
      let data: any = null;
      let isOk = false;

      if (isNative) {
        const nativeRes = await CapacitorHttp.get({
          url: endpoint,
          headers: {
            'X-Plex-Token': token,
            'Accept': 'application/json',
            'X-Plex-Client-Identifier': clientId,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          connectTimeout: 10000,
          readTimeout: 10000
        });
        isOk = nativeRes.status >= 200 && nativeRes.status < 300;
        if (isOk) {
          data = typeof nativeRes.data === 'string' ? JSON.parse(nativeRes.data) : nativeRes.data;
        }
      } else {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);
        const res = await fetch(endpoint, {
          headers: {
            'X-Plex-Token': token,
            'Accept': 'application/json',
            'X-Plex-Client-Identifier': clientId,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          signal: controller.signal
        });
        clearTimeout(timer);
        isOk = res.ok;
        if (isOk && (res.headers.get('content-type') || '').includes('application/json')) {
          data = await res.json();
        }
      }

      if (isOk && data) {
        const items = extractItems(data);
        if (items.length > 0) {
          for (const it of items) {
            rawHistoryItems.push({ raw: it, source: 'Plex Cloud Direct' });
          }
          appLogger.success('plex', `Plex Cloud Historique direct : ${items.length} éléments vus trouvés`);
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
        const guidTmdbId = extractTmdbIdFromPlex(item);

        if (type === 'episode') {
          const seasonNum = item.parentIndex;
          const episodeNum = item.index;
          const showTitle = item.grandparentTitle || item.title;
          if (!showTitle || seasonNum === undefined || episodeNum === undefined) continue;

          const epKey = `${seasonNum}x${episodeNum}`;
          const cleanShowTitle = showTitle.replace(/\(\d{4}\)/g, '').trim();
          const cacheKey = buildPlexResolutionCacheKey('tv', guidTmdbId);

          // 1. Check in local library by TMDB ID
          let matchedShow = findShowInLocalLibrary(showsList, guidTmdbId, 'tv');

          // Fast skip check: if already in library and episode is already seen, skip immediately
          if (matchedShow) {
            const currentMutated = mutatedShows[matchedShow.id] || matchedShow;
            if (currentMutated.seenEpisodes?.includes(epKey)) {
              continue; // Already processed & seen! Skip in 0ms without any TMDB request or UI message
            }
          }

          // 2. If not found locally, check resolution cache
          let tmdbData: any = null;
          if (!matchedShow && cacheKey && resolutionCache[cacheKey]) {
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

          // 3. If still not resolved, query TMDB via helper (handles TMDB GUID, IMDb ID, TVDb ID, Plex Discover metadata, and fallback search)
          if (!matchedShow && !tmdbData) {
            tmdbData = await resolveTmdbDataForPlexItem(item, 'tv', plexToken);

            if (!tmdbData) {
              appLogger.info('plex', `[Plex Sync] Fiche "${cleanShowTitle}" ignorée (impossible de résoudre l'ID TMDB).`);
              continue;
            }

            if (tmdbData && cacheKey) {
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
          const cacheKey = buildPlexResolutionCacheKey('movie', guidTmdbId);

          // 1. Check in local library by TMDB ID
          let matchedMovie = findShowInLocalLibrary(showsList, guidTmdbId, 'movie');

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
          if (!matchedMovie && cacheKey && resolutionCache[cacheKey]) {
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

          // 3. If still not resolved, query TMDB via helper
          if (!matchedMovie && !tmdbData) {
            tmdbData = await resolveTmdbDataForPlexItem(item, 'movie', plexToken);

            if (!tmdbData) {
              appLogger.info('plex', `[Plex Sync] Fiche film "${cleanMovieTitle}" ignorée (impossible de résoudre l'ID TMDB).`);
              continue;
            }

            if (tmdbData && cacheKey) {
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

          const cleanTitle = rawTitle.replace(/\(\d{4}\)/g, '').trim();
          const guidTmdbId = extractTmdbIdFromPlex(wlItem);
          const cacheKey = buildPlexResolutionCacheKey(mediaType, guidTmdbId);

          // 1. Check if already in user's local library by TMDB ID
          let matchedShow = findShowInLocalLibrary(showsList, guidTmdbId, mediaType);
          if (matchedShow) {
            continue;
          }

          // 2. Check resolution cache
          let tmdbData: any = null;
          if (cacheKey && resolutionCache[cacheKey]) {
            tmdbData = resolutionCache[cacheKey];
            matchedShow = showsList.find(
              (s) => Number(s.tmdbId) === Number(tmdbData.id) && (s.mediaType === mediaType || (mediaType === 'tv' && !s.mediaType))
            );
            if (matchedShow) continue;
          }

          // 3. Resolve TMDB data for Watchlist item
          if (!tmdbData) {
            tmdbData = await resolveTmdbDataForPlexItem(wlItem, mediaType, plexToken);

            if (!tmdbData) {
              appLogger.info('plex', `[Plex Sync] Item Watchlist "${cleanTitle}" ignoré (impossible de résoudre l'ID TMDB).`);
              continue;
            }

            if (tmdbData && cacheKey) {
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

/**
 * Génère et stocke un X-Plex-Client-Identifier (UUIDv4) persistant dans le LocalStorage
 */
export function getPlexClientIdentifier(): string {
  try {
    let clientId = localStorage.getItem('plex_client_identifier');
    const isUuid = clientId && /^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientId);
    if (!clientId || !isUuid) {
      clientId = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            const v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
          });
      localStorage.setItem('plex_client_identifier', clientId);
    }
    return clientId;
  } catch (e) {
    return '10000000-1000-4000-8000-100000000000';
  }
}

/**
 * Génère les en-têtes HTTP authentifiés officiels requis pour toutes les requêtes vers l'API Plex
 */
export function getPlexHeaders(): Record<string, string> {
  const token = localStorage.getItem('plex_auth_token') || localStorage.getItem('plex_token') || '';
  const headers: Record<string, string> = {
    'X-Plex-Product': 'SeenIt',
    'X-Plex-Version': CURRENT_APP_VERSION || '1.4.0',
    'X-Plex-Client-Identifier': getPlexClientIdentifier(),
    'Accept': 'application/json'
  };
  if (token) {
    headers['X-Plex-Token'] = token;
  }
  return headers;
}

/**
 * Résout la fiche Plex d'un média par ID TMDB officiel via matches Plex (sans redirection accueil si échec)
 */
export const openPlexWatchUrl = async (show: any) => {
  const tmdbId = show?.tmdbId;
  const title = show?.title || show?.name || '';
  const originalTitle = show?.originalTitle || show?.original_title || show?.original_name || '';
  const year = show?.year || (show?.releaseDate ? show.releaseDate.substring(0, 4) : undefined) || (show?.firstAirDate ? show.firstAirDate.substring(0, 4) : undefined);
  const type = (show?.mediaType === 'tv' || show?.mediaType === 'show' || show?.type === 'show') ? 'show' : 'movie';
  const showId = show?.id;
  const userId = auth.currentUser?.uid;

  if (!tmdbId) {
    appLogger.warn('plex', `[Plex Official] Aucun identifiant TMDB disponible pour "${title || 'Média'}". Résolution annulée.`);
    return;
  }

  const expectedResolvedFrom = `tmdb:${tmdbId}`;
  
  if (
    show?.plexSlug &&
    show?.plexResolvedFrom === expectedResolvedFrom
  ) {
    appLogger.info('plex', `[Plex Official] Slug BDD validé : "${show.plexSlug}" (${show.plexResolvedFrom}) -> https://watch.plex.tv/${type}/${show.plexSlug}`);
    openExternalUrl(`https://watch.plex.tv/${type}/${show.plexSlug}`);
    return;
  }

  appLogger.info('plex', `[Plex Official] Résolution du slug pour "${title || 'N/A'}" (TMDB: ${tmdbId}, ${type})...`);

  const isNative = Capacitor.isNativePlatform();
  const plexType = type === 'show' ? 2 : 1;
  const plexHeaders = getPlexHeaders();

  let resolvedSlug: string | null = null;
  let resolvedGuid: string | null = null;
  let resolvedFrom: string | null = null;

  // 1. TENTATIVE DIRECTE OFFICIELLE PLEX (TMDB guid)
  try {
    const matchesUrl = `https://metadata.provider.plex.tv/library/metadata/matches?guid=${encodeURIComponent(`tmdb://${tmdbId}`)}&type=${plexType}`;
    let data: any = null;

    if (isNative) {
      const nativeRes = await CapacitorHttp.get({
        url: matchesUrl,
        headers: plexHeaders,
        connectTimeout: 5000,
        readTimeout: 5000
      });
      if (nativeRes.status >= 200 && nativeRes.status < 300) {
        data = typeof nativeRes.data === 'string' ? JSON.parse(nativeRes.data) : nativeRes.data;
      }
    } else {
      const response = await fetch(matchesUrl, {
        headers: plexHeaders,
        signal: AbortSignal.timeout(5000)
      });
      if (response.ok) {
        data = await response.json();
      }
    }

    const results = data?.MediaContainer?.Metadata || data?.MediaContainer?.SearchResult;
    const match = Array.isArray(results) && results.length > 0 ? results[0] : null;

    if (match && match.slug) {
      resolvedSlug = match.slug;
      resolvedGuid = match.guid || null;
      resolvedFrom = expectedResolvedFrom;
      appLogger.info('plex', `[Plex Official] ✅ Slug résolu en direct Plex : "${resolvedSlug}" (TMDB: ${tmdbId})`);
    }
  } catch (err: any) {
    // En cas d'erreur réseau directe, tenter le backend
  }

  // 2. FALLBACK VIA BACKEND SI NÉCESSAIRE
  if (!resolvedSlug) {
    const RESOLVE_ENDPOINTS = isNative
      ? [
          'https://ais-pre-mooctibtw2amkshvkzlqij-700628279309.europe-west2.run.app/api/plex/resolve-slug',
          'https://ais-dev-mooctibtw2amkshvkzlqij-700628279309.europe-west2.run.app/api/plex/resolve-slug'
        ]
      : [
          '/api/plex/resolve-slug',
          'https://ais-pre-mooctibtw2amkshvkzlqij-700628279309.europe-west2.run.app/api/plex/resolve-slug',
          'https://ais-dev-mooctibtw2amkshvkzlqij-700628279309.europe-west2.run.app/api/plex/resolve-slug'
        ];

    const clientId = getPlexClientIdentifier();
    const queryParams = new URLSearchParams();
    queryParams.set('tmdbId', String(tmdbId));
    if (title) queryParams.set('title', title);
    if (originalTitle) queryParams.set('originalTitle', originalTitle);
    if (year) queryParams.set('year', String(year));
    queryParams.set('type', type);
    if (clientId) queryParams.set('clientId', clientId);

    for (const ep of RESOLVE_ENDPOINTS) {
      try {
        let data: any = null;
        const fullUrl = `${ep}?${queryParams.toString()}`;

        if (isNative) {
          const nativeRes = await CapacitorHttp.get({
            url: fullUrl,
            headers: plexHeaders,
            connectTimeout: 8000,
            readTimeout: 8000
          });
          if (nativeRes.status >= 200 && nativeRes.status < 300) {
            data = typeof nativeRes.data === 'string' ? JSON.parse(nativeRes.data) : nativeRes.data;
          }
        } else {
          const response = await fetch(fullUrl, {
            headers: plexHeaders
          });
          if (response.ok) {
            data = await response.json();
          }
        }

        if (
          data?.slug &&
          data?.resolvedFrom &&
          data.resolvedFrom === expectedResolvedFrom
        ) {
          resolvedSlug = data.slug;
          resolvedGuid = data.plexGuid || data.guid || null;
          resolvedFrom = data.resolvedFrom;
          break;
        }
      } catch (error) {
        // Ignorer l'erreur et essayer le suivant
      }
    }
  }

  if (resolvedSlug) {
    appLogger.info('plex', `[Plex Official] ✅ Slug résolu : "${resolvedSlug}". Sauvegarde en BDD et ouverture.`);
    // 3. Save to DB so we don't have to fetch again
    if (showId && userId) {
      try {
        const showRef = doc(db, `users/${userId}/shows`, showId);
        const updatePayload: Record<string, any> = {
          plexSlug: resolvedSlug,
          plexResolvedFrom: resolvedFrom || expectedResolvedFrom || null
        };
        if (resolvedGuid) {
          updatePayload.plexGuid = resolvedGuid;
        }
        await updateDoc(showRef, updatePayload);
        
        // Optimistically update the store
        const storeShows = useShowsStore.getState().shows;
        const idx = storeShows.findIndex(s => s.id === showId);
        if (idx >= 0) {
          const updated = [...storeShows];
          updated[idx] = { 
            ...updated[idx], 
            plexSlug: resolvedSlug,
            plexResolvedFrom: resolvedFrom || expectedResolvedFrom,
            ...(resolvedGuid ? { plexGuid: resolvedGuid } : {})
          };
          useShowsStore.getState().setShows(updated);
        }
      } catch (err) {
        console.warn('Failed to save plexSlug to DB', err);
      }
    }
    openExternalUrl(`https://watch.plex.tv/${type}/${resolvedSlug}`);
    return;
  }

  // 4. En cas d'échec de résolution du slug : NE PAS rediriger vers l'accueil watch.plex.tv !
  appLogger.error('plex', `[Plex Official] ❌ Impossible de résoudre la fiche Plex pour "${title || 'Média'}" (TMDB: ${tmdbId || 'N/A'}). Redirection annulée pour éviter l'accueil.`);
};

/**
 * Purge tous les slugs Plex en cache / en BDD pour éliminer les faux slugs passés
 */
export const purgeAllPlexSlugsInDb = async (): Promise<number> => {
  const userId = auth.currentUser?.uid;
  if (!userId) return 0;

  try {
    appLogger.info('plex', `[Plex Purge] Début de la purge des anciens slugs Plex...`);
    const showsSnapshot = await getDocs(collection(db, `users/${userId}/shows`));
    const batch = writeBatch(db);
    let count = 0;

    showsSnapshot.forEach((d) => {
      const data = d.data();
      if (data && (data.plexSlug || data.plexGuid || data.plexResolvedFrom)) {
        batch.update(d.ref, { 
          plexSlug: deleteField(),
          plexGuid: deleteField(),
          plexResolvedFrom: deleteField()
        });
        count++;
      }
    });

    if (count > 0) {
      await batch.commit();
      appLogger.info('plex', `[Plex Purge] ✅ ${count} fiches Plex purgées avec succès en BDD Firestore.`);
    } else {
      appLogger.info('plex', `[Plex Purge] Aucun slug Plex à purger en BDD.`);
    }

    // Mise à jour de l'état local Zustand
    const currentShows = useShowsStore.getState().shows;
    const cleanedShows = currentShows.map(s => {
      if (s.plexSlug || (s as any).plexGuid || (s as any).plexResolvedFrom) {
        const copy = { ...s };
        delete copy.plexSlug;
        delete (copy as any).plexGuid;
        delete (copy as any).plexResolvedFrom;
        return copy;
      }
      return s;
    });
    useShowsStore.getState().setShows(cleanedShows);

    return count;
  } catch (err: any) {
    appLogger.error('plex', `[Plex Purge] Erreur lors de la purge des slugs Plex: ${err?.message || err}`);
    return 0;
  }
};

// Auto-purge unique pour nettoyer les anciens slugs corrompus des versions précédentes
if (typeof window !== 'undefined') {
  const PURGE_KEY = 'seenit_plex_slugs_purged_v1.4.17';
  auth.onAuthStateChanged((user) => {
    if (user?.uid && localStorage.getItem(PURGE_KEY) !== 'true') {
      purgeAllPlexSlugsInDb().then(() => {
        localStorage.setItem(PURGE_KEY, 'true');
      }).catch(() => {});
    }
  });
}

