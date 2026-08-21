import { create } from 'zustand';
import { db, auth } from '../lib/firebase';
import { collection, query, getDocs, getDocsFromCache, getDocsFromServer } from 'firebase/firestore';
import { type Show } from '../types';
import { handleFirestoreError, OperationType } from '../lib/firebaseErrors';
import { useSyncStore } from './syncStore';

interface ShowsState {
  shows: Show[];
  loading: boolean;
  initialized: boolean;
  setShows: (shows: Show[]) => void;
  setLoading: (loading: boolean) => void;
  setInitialized: (initialized: boolean) => void;
  updateShowOptimistic: (id: string, updates: Partial<Show>) => void;
  removeShowOptimistic: (id: string) => void;
  addShowOptimistic: (show: Show) => void;
  fetchShows: () => Promise<void>;
}

const getInitialCache = (): { shows: Show[]; loading: boolean } => {
  try {
    const stored = localStorage.getItem('cached_shows_v1');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return { shows: parsed, loading: false };
      }
    }
  } catch (e) {
    console.warn('Failed to parse cached_shows_v1 from localStorage', e);
  }
  return { shows: [], loading: true };
};

const initialCache = getInitialCache();

const saveToLocalStorage = (shows: Show[]) => {
  try {
    localStorage.setItem('cached_shows_v1', JSON.stringify(shows));
  } catch (e) {}
};

/**
 * Fusionne et déduplique intelligemment les séries (en combinant seenEpisodes et records)
 */
function deduplicateAndMergeShows(rawShows: Show[], currentLocalShows: Show[] = []): Show[] {
  const deduplicatedMap = new Map<string, Show>();

  // 1. D'abord charger tous les rawShows depuis Firestore
  for (const show of rawShows) {
    const tmdbIdNum = Number(show.tmdbId);
    const mType = show.mediaType || 'tv';
    
    if (!tmdbIdNum || isNaN(tmdbIdNum)) {
      deduplicatedMap.set(`${mType}_${show.id || Math.random()}`, show);
      continue;
    }

    const key = `${mType}_${tmdbIdNum}`;
    const existing = deduplicatedMap.get(key);

    if (!existing) {
      deduplicatedMap.set(key, { ...show });
    } else {
      // Fusionner les épisodes vus des deux instances
      const mergedSeen = Array.from(new Set([
        ...(existing.seenEpisodes || []),
        ...(show.seenEpisodes || [])
      ]));

      const mergedRecords = {
        ...(existing.episodeRecords || {}),
        ...(show.episodeRecords || {})
      };

      const mostRecentTime = Math.max(existing.updatedAt || 0, show.updatedAt || 0);
      const chosenDoc = (show.updatedAt || 0) >= (existing.updatedAt || 0) ? show : existing;

      deduplicatedMap.set(key, {
        ...chosenDoc,
        seenEpisodes: mergedSeen,
        episodeRecords: mergedRecords,
        updatedAt: mostRecentTime || Date.now()
      });
    }
  }

  // 2. Fusionner avec les séries locales actuelles pour garantir qu'aucun épisode vu localement ne disparaisse
  for (const localShow of currentLocalShows) {
    const tmdbIdNum = Number(localShow.tmdbId);
    const mType = localShow.mediaType || 'tv';
    if (!tmdbIdNum || isNaN(tmdbIdNum)) continue;

    const key = `${mType}_${tmdbIdNum}`;
    const remoteShow = deduplicatedMap.get(key);

    if (remoteShow) {
      const mergedSeen = Array.from(new Set([
        ...(remoteShow.seenEpisodes || []),
        ...(localShow.seenEpisodes || [])
      ]));

      const mergedRecords = {
        ...(remoteShow.episodeRecords || {}),
        ...(localShow.episodeRecords || {})
      };

      deduplicatedMap.set(key, {
        ...remoteShow,
        seenEpisodes: mergedSeen,
        episodeRecords: mergedRecords,
        lastWatchedAt: Math.max(remoteShow.lastWatchedAt || 0, localShow.lastWatchedAt || 0)
      });
    }
  }

  // 3. Vérifier que nextEpisodeToWatch ne pointe pas vers un épisode DÉJÀ VU
  const finalShows: Show[] = [];
  for (const show of deduplicatedMap.values()) {
    const seen = show.seenEpisodes || [];
    let nextEp = show.nextEpisodeToWatch;

    if (nextEp && seen.includes(`${nextEp.season_number}x${nextEp.episode_number}`)) {
      let maxS = 1;
      let maxE = 0;
      seen.forEach(epKey => {
        const [s, e] = epKey.split('x').map(Number);
        if (!isNaN(s) && !isNaN(e)) {
          if (s > maxS || (s === maxS && e > maxE)) {
            maxS = s;
            maxE = e;
          }
        }
      });
      nextEp = {
        ...nextEp,
        season_number: maxS,
        episode_number: maxE + 1
      };
    }

    finalShows.push({
      ...show,
      nextEpisodeToWatch: nextEp
    });
  }

  return finalShows;
}

export const useShowsStore = create<ShowsState>((set, get) => ({
  shows: initialCache.shows,
  loading: initialCache.loading,
  initialized: initialCache.shows.length > 0,
  setShows: (shows) => {
    saveToLocalStorage(shows);
    set({ shows });
  },
  setLoading: (loading) => set({ loading }),
  setInitialized: (initialized) => set({ initialized }),
  
  updateShowOptimistic: (id, updates) => {
    set(state => {
      const updatedShows = state.shows.map(show => 
        show.id === id ? { ...show, ...updates } : show
      );
      saveToLocalStorage(updatedShows);
      return { shows: updatedShows };
    });
  },
  
  removeShowOptimistic: (id) => {
    set(state => {
      const updatedShows = state.shows.filter(show => show.id !== id);
      saveToLocalStorage(updatedShows);
      return { shows: updatedShows };
    });
  },
  
  addShowOptimistic: (show) => {
    set(state => {
      const existingIdx = state.shows.findIndex(s => s.id === show.id || (s.tmdbId && show.tmdbId && s.tmdbId === show.tmdbId && s.mediaType === show.mediaType));
      let updatedShows: Show[];
      if (existingIdx >= 0) {
        updatedShows = state.shows.map((s, idx) => idx === existingIdx ? { ...s, ...show } : s);
      } else {
        updatedShows = [...state.shows, show];
      }
      saveToLocalStorage(updatedShows);
      return { shows: updatedShows };
    });
  },
  
  fetchShows: async () => {
    const user = auth.currentUser;
    if (!user) return;
    
    if (!get().initialized && get().shows.length === 0) {
      set({ loading: true });
    }
    
    try {
      const showsRef = collection(db, 'users', user.uid, 'shows');
      const q = query(showsRef);

      // 1. Tenter de lire depuis le cache local Firestore pour un affichage instantané
      try {
        const cachedSnapshot = await getDocsFromCache(q);
        if (!cachedSnapshot.empty) {
          const cachedShows: Show[] = [];
          cachedSnapshot.forEach((doc) => {
            cachedShows.push({ ...doc.data(), id: String(doc.id) } as Show);
          });
          const merged = deduplicateAndMergeShows(cachedShows, get().shows);
          saveToLocalStorage(merged);
          set({ shows: merged, loading: false, initialized: true });
        }
      } catch (cacheErr) {
        // Le cache peut être vide
      }

      // 2. Fetch depuis le réseau (FORCÉ DEPUIS LE SERVEUR pour casser le cache PWA)
      let snapshot;
      try {
        snapshot = await getDocsFromServer(q);
      } catch (e) {
        snapshot = await getDocs(q);
      }
      
      const rawLoadedShows: Show[] = [];
      snapshot.forEach((doc) => {
        rawLoadedShows.push({ ...doc.data(), id: String(doc.id) } as Show);
      });

      const loadedShows = deduplicateAndMergeShows(rawLoadedShows, get().shows);

      saveToLocalStorage(loadedShows);
      set({ shows: loadedShows, loading: false, initialized: true });
    } catch (err: any) {
      const errStr = err?.message || String(err);
      const isQuotaError = 
        err?.code === 'resource-exhausted' || 
        errStr.toLowerCase().includes('quota exceeded') || 
        errStr.toLowerCase().includes('quota-exceeded') ||
        errStr.toLowerCase().includes('resource-exhausted') ||
        errStr.toLowerCase().includes('resource_exhausted');

      if (isQuotaError) {
        console.warn("[showsStore] Firestore quota exhausted on fetch.");
        useSyncStore.getState().setQuotaExceeded(true);
      } else {
        handleFirestoreError(err, OperationType.GET, `users/${user.uid}/shows`);
      }
      set({ loading: false });
    }
  }
}));

auth.onAuthStateChanged(user => {
  if (user) {
    useShowsStore.getState().fetchShows();
  } else {
    useShowsStore.getState().setShows([]);
    useShowsStore.getState().setLoading(false);
    useShowsStore.getState().setInitialized(false);
  }
});