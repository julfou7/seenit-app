import { create } from 'zustand';
import { useDownloadConfigStore } from './downloadConfigStore';
import { executeGet, cleanUrl } from '../services/sonarrRadarr';
import { checkPlexAvailability, PlexMediaInfo } from '../features/plex/plexAvailability';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../lib/firebase';

export interface MediaPresenceData {
  loading: boolean;
  hasFile: boolean;
  radarrHasFile?: boolean;
  sonarrHasFile?: boolean;
  seasonsHasFile: Record<number, boolean>;
  episodesHasFile: Record<string, boolean>; // e.g., "S1E1": true
  plexInfo?: PlexMediaInfo;
  lastChecked: number;
}

interface MediaPresenceStore {
  presenceCache: Record<string, MediaPresenceData>;
  radarrMoviesCache: { data: any[]; timestamp: number; scopeKey: string } | null;
  sonarrSeriesCache: { data: any[]; timestamp: number; scopeKey: string } | null;

  getPresence: (tmdbId?: number | string, mediaType?: 'movie' | 'tv', title?: string) => MediaPresenceData | undefined;

  checkPresence: (params: {
    tmdbId?: number | string;
    tvdbId?: number | string;
    imdbId?: string;
    title?: string;
    originalTitle?: string;
    year?: number | string;
    mediaType: 'movie' | 'tv';
    forceRefresh?: boolean;
  }) => Promise<MediaPresenceData>;
}

let mediaPresenceEpoch = 0;

export const useMediaPresenceStore = create<MediaPresenceStore>((set, get) => ({
  presenceCache: {},
  radarrMoviesCache: null,
  sonarrSeriesCache: null,

  getPresence: (tmdbId, mediaType = 'movie', title) => {
    if (!tmdbId) return undefined;
    const config = useDownloadConfigStore.getState();
    const configScope = `${cleanUrl(config.radarrUrl)}|${cleanUrl(config.sonarrUrl)}`;
    const key = `${auth.currentUser?.uid || 'signed-out'}|${configScope}|${mediaType}:${tmdbId}`;
    return get().presenceCache[key];
  },

  checkPresence: async (params) => {
    const {
      tmdbId,
      tvdbId,
      imdbId,
      title = '',
      originalTitle,
      year,
      mediaType,
      forceRefresh = false
    } = params;

    const config = useDownloadConfigStore.getState();
    const requestEpoch = mediaPresenceEpoch;
    const requestUid = auth.currentUser?.uid || null;
    const configScope = `${cleanUrl(config.radarrUrl)}|${cleanUrl(config.sonarrUrl)}`;
    const canonicalId = tmdbId || tvdbId || imdbId || 'sans-identifiant';
    const cacheKey = `${requestUid || 'signed-out'}|${configScope}|${mediaType}:${canonicalId}`;
    const now = Date.now();
    const existing = get().presenceCache[cacheKey];

    if (canonicalId === 'sans-identifiant') {
      return {
        loading: false,
        hasFile: false,
        seasonsHasFile: {},
        episodesHasFile: {},
        lastChecked: now
      };
    }

    // Stratégie de Cache : 5 minutes pour un média trouvé / disponible, 30 secondes sinon
    if (!forceRefresh && existing) {
      const ttl = (existing.hasFile || existing.plexInfo?.available) ? 5 * 60 * 1000 : 30 * 1000;
      if (now - existing.lastChecked < ttl) {
        return existing;
      }
    }

    // Indiquer l'état de chargement si aucune donnée préalable
    if (!existing) {
      set((state) => ({
        presenceCache: {
          ...state.presenceCache,
          [cacheKey]: {
            loading: true,
            hasFile: false,
            seasonsHasFile: {},
            episodesHasFile: {},
            lastChecked: now
          }
        }
      }));
    }

    // 1. Vérification disponibilité Plex en parallèle
    const plexPromise = checkPlexAvailability({
      tmdbId,
      imdbId,
      title,
      originalTitle,
      year,
      mediaType,
      forceRefresh
    }).catch(() => ({ available: false, lastChecked: now } as PlexMediaInfo));

    let radarrHasFile = false;
    let sonarrHasFile = false;
    const seasonsHasFile: Record<number, boolean> = {};
    const episodesHasFile: Record<string, boolean> = {};

    // 2. Vérification Radarr pour les films
    if (mediaType === 'movie' && config.radarrUrl && config.radarrApiKey) {
      try {
        const radarrBase = cleanUrl(config.radarrUrl);
        const headers = { 'X-Api-Key': config.radarrApiKey, 'Accept': 'application/json' };

        const radarrScopeKey = `${requestUid}|${cleanUrl(config.radarrUrl)}|${config.radarrApiKey}`;
        let moviesList = get().radarrMoviesCache?.scopeKey === radarrScopeKey ? get().radarrMoviesCache?.data || [] : [];
        const isCacheValid = get().radarrMoviesCache?.scopeKey === radarrScopeKey
          && (now - get().radarrMoviesCache!.timestamp < 30 * 1000);

        if (forceRefresh || !isCacheValid || moviesList.length === 0) {
          moviesList = await executeGet(`${radarrBase}/api/v3/movie`, headers).catch(() => []);
          if (Array.isArray(moviesList) && requestEpoch === mediaPresenceEpoch && auth.currentUser?.uid === requestUid) {
            set({ radarrMoviesCache: { data: moviesList, timestamp: now, scopeKey: radarrScopeKey } });
          }
        }

        if (Array.isArray(moviesList)) {
          const match = moviesList.find((m: any) => {
            if (tmdbId && m.tmdbId && Number(m.tmdbId) === Number(tmdbId)) return true;
            if (imdbId && m.imdbId && String(m.imdbId).toLowerCase() === String(imdbId).toLowerCase()) return true;
            return false;
          });

          if (match) {
            radarrHasFile = !!match.hasFile;
          }
        }
      } catch (err) {
        console.warn('[MediaPresence] Erreur vérification Radarr:', err);
      }
    }

    // 3. Vérification Sonarr pour les séries / saisons / épisodes
    if (mediaType === 'tv' && config.sonarrUrl && config.sonarrApiKey) {
      try {
        const sonarrBase = cleanUrl(config.sonarrUrl);
        const headers = { 'X-Api-Key': config.sonarrApiKey, 'Accept': 'application/json' };

        const sonarrScopeKey = `${requestUid}|${cleanUrl(config.sonarrUrl)}|${config.sonarrApiKey}`;
        let seriesList = get().sonarrSeriesCache?.scopeKey === sonarrScopeKey ? get().sonarrSeriesCache?.data || [] : [];
        const isCacheValid = get().sonarrSeriesCache?.scopeKey === sonarrScopeKey
          && (now - get().sonarrSeriesCache!.timestamp < 30 * 1000);

        if (forceRefresh || !isCacheValid || seriesList.length === 0) {
          seriesList = await executeGet(`${sonarrBase}/api/v3/series`, headers).catch(() => []);
          if (Array.isArray(seriesList) && requestEpoch === mediaPresenceEpoch && auth.currentUser?.uid === requestUid) {
            set({ sonarrSeriesCache: { data: seriesList, timestamp: now, scopeKey: sonarrScopeKey } });
          }
        }

        if (Array.isArray(seriesList)) {
          const match = seriesList.find((s: any) => {
            if (tvdbId && s.tvdbId && Number(s.tvdbId) === Number(tvdbId)) return true;
            if (tmdbId && s.tmdbId && Number(s.tmdbId) === Number(tmdbId)) return true;
            if (imdbId && s.imdbId && String(s.imdbId).toLowerCase() === String(imdbId).toLowerCase()) return true;
            return false;
          });

          if (match && match.id) {
            // Récupérer la liste des épisodes pour cette série
            const episodes: any[] = await executeGet(`${sonarrBase}/api/v3/episode?seriesId=${match.id}`, headers).catch(() => []);
            if (Array.isArray(episodes) && episodes.length > 0) {
              const episodesBySeason: Record<number, any[]> = {};

              episodes.forEach((ep: any) => {
                const sNum = ep.seasonNumber;
                const eNum = ep.episodeNumber;
                const key = `S${sNum}E${eNum}`;
                episodesHasFile[key] = !!ep.hasFile;

                if (sNum > 0) {
                  if (!episodesBySeason[sNum]) episodesBySeason[sNum] = [];
                  episodesBySeason[sNum].push(ep);
                }
              });

              // Une saison est considérée comme complète si 100% des épisodes de la saison ont hasFile === true
              Object.entries(episodesBySeason).forEach(([sNumStr, epList]) => {
                const sNum = Number(sNumStr);
                if (epList.length > 0) {
                  seasonsHasFile[sNum] = epList.every((ep: any) => ep.hasFile === true);
                }
              });

              // La série est considérée comme complète si 100% des épisodes hors hors-série ont hasFile === true
              const allMainEps = episodes.filter((ep: any) => ep.seasonNumber > 0);
              if (allMainEps.length > 0) {
                sonarrHasFile = allMainEps.every((ep: any) => ep.hasFile === true);
              }
            }
          }
        }
      } catch (err) {
        console.warn('[MediaPresence] Erreur vérification Sonarr:', err);
      }
    }

    const plexInfo = await plexPromise;

    const finalData: MediaPresenceData = {
      loading: false,
      hasFile: radarrHasFile || sonarrHasFile || !!plexInfo.available,
      radarrHasFile,
      sonarrHasFile,
      seasonsHasFile,
      episodesHasFile,
      plexInfo,
      lastChecked: now
    };

    if (requestEpoch !== mediaPresenceEpoch || auth.currentUser?.uid !== requestUid) {
      return {
        loading: false,
        hasFile: false,
        seasonsHasFile: {},
        episodesHasFile: {},
        lastChecked: Date.now()
      };
    }

    set((state) => ({
      presenceCache: {
        ...state.presenceCache,
        [cacheKey]: finalData
      }
    }));

    return finalData;
  }
}));

if (typeof window !== 'undefined') {
  onAuthStateChanged(auth, () => {
    mediaPresenceEpoch += 1;
    useMediaPresenceStore.setState({
      presenceCache: {},
      radarrMoviesCache: null,
      sonarrSeriesCache: null
    });
  });
}
