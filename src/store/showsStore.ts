import { create } from 'zustand';
import { db, auth } from '../lib/firebase';
import { collection, query, getDocs, getDocsFromCache } from 'firebase/firestore';
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
      const updatedShows = [...state.shows, show];
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
          saveToLocalStorage(cachedShows);
          set({ shows: cachedShows, loading: false, initialized: true });
        }
      } catch (cacheErr) {
        // Le cache peut être vide ou indisponible, on ignore silencieusement
      }

      // 2. Fetch depuis le réseau pour mettre à jour
      const snapshot = await getDocs(q);
      
      const rawLoadedShows: Show[] = [];
      snapshot.forEach((doc) => {
        rawLoadedShows.push({ ...doc.data(), id: String(doc.id) } as Show);
      });

      // Deduplicate by mediaType + tmdbId (keep the one with most seenEpisodes, then latest updatedAt)
      const deduplicatedMap = new Map<string, Show>();
      for (const show of rawLoadedShows) {
        const tmdbIdNum = Number(show.tmdbId);
        const mType = show.mediaType || 'tv';
        if (!tmdbIdNum || isNaN(tmdbIdNum)) {
          deduplicatedMap.set(`${mType}_${show.id || Math.random()}`, show); // fallback for shows without tmdbId
          continue;
        }
        const key = `${mType}_${tmdbIdNum}`;
        const existing = deduplicatedMap.get(key);
        if (!existing) {
          deduplicatedMap.set(key, show);
        } else {
          const existingCount = existing.seenEpisodes?.length || 0;
          const newCount = show.seenEpisodes?.length || 0;
          if (newCount > existingCount) {
            deduplicatedMap.set(key, show);
          } else if (newCount === existingCount) {
            const existingTime = existing.updatedAt || 0;
            const newTime = show.updatedAt || 0;
            if (newTime > existingTime) {
              deduplicatedMap.set(key, show);
            }
          }
        }
      }
      const loadedShows = Array.from(deduplicatedMap.values());

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
