import { create } from 'zustand';
import { db, auth } from '../lib/firebase';
import { collection, query, getDocs, getDocsFromCache, onSnapshot, type Unsubscribe } from 'firebase/firestore';
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
  forceResync: () => void;
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

let unsubscribeShowsListener: Unsubscribe | null = null;
let currentListeningUid: string | null = null;

/**
 * Fusionne et déduplique intelligemment les séries (en combinant seenEpisodes et records)
 */
function deduplicateAndMergeShows(rawShows: Show[]): Show[] {
  const deduplicatedMap = new Map<string, Show>();

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

  return Array.from(deduplicatedMap.values());
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
        (show.id === id || (show.tmdbId && updates.tmdbId && Number(show.tmdbId) === Number(updates.tmdbId))) ? { ...show, ...updates } : show
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
      const existingIdx = state.shows.findIndex(s => 
        s.id === show.id || 
        (s.tmdbId && show.tmdbId && Number(s.tmdbId) === Number(show.tmdbId) && s.mediaType === show.mediaType)
      );
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

  forceResync: () => {
    if (unsubscribeShowsListener) {
      try { unsubscribeShowsListener(); } catch (e) {}
      unsubscribeShowsListener = null;
    }
    currentListeningUid = null;
    get().fetchShows();
  },
  
  fetchShows: async () => {
    const user = auth.currentUser;
    if (!user) return;
    
    if (!get().initialized && get().shows.length === 0) {
      set({ loading: true });
    }
    
    if (unsubscribeShowsListener) {
      if (currentListeningUid === user.uid) {
        // Déjà en écoute sur le bon utilisateur
        return;
      } else {
        // L'utilisateur a changé, nettoyer l'ancien listener
        try { unsubscribeShowsListener(); } catch (e) {}
        unsubscribeShowsListener = null;
        currentListeningUid = null;
      }
    }
    
    try {
      const showsRef = collection(db, 'users', user.uid, 'shows');
      currentListeningUid = user.uid;
      
      unsubscribeShowsListener = onSnapshot(showsRef, (snapshot) => {
        const remoteShows: Show[] = [];
        snapshot.forEach((doc) => {
          remoteShows.push({ ...doc.data(), id: String(doc.id) } as Show);
        });
        const merged = deduplicateAndMergeShows(remoteShows);
        saveToLocalStorage(merged);
        set({ shows: merged, loading: false, initialized: true });
      }, (err: any) => {
        // En cas d'erreur sur l'écouteur, réinitialiser la référence pour autoriser une nouvelle tentative
        if (unsubscribeShowsListener) {
          try { unsubscribeShowsListener(); } catch (e) {}
          unsubscribeShowsListener = null;
        }
        currentListeningUid = null;

        const errStr = err?.message || String(err);
        const isQuotaError = 
          err?.code === 'resource-exhausted' || 
          errStr.toLowerCase().includes('quota exceeded') || 
          errStr.toLowerCase().includes('quota-exceeded') ||
          errStr.toLowerCase().includes('resource-exhausted') ||
          errStr.toLowerCase().includes('resource_exhausted');
  
        if (isQuotaError) {
          console.warn("[showsStore] Firestore quota exhausted on realtime listener.");
          useSyncStore.getState().setQuotaExceeded(true);
        } else {
          console.error('[showsStore] Realtime listener error:', err);
        }
        set({ loading: false });
      });
    } catch (err) {
      console.error('[showsStore] Failed to setup realtime listener:', err);
      if (unsubscribeShowsListener) {
        try { unsubscribeShowsListener(); } catch (e) {}
        unsubscribeShowsListener = null;
      }
      currentListeningUid = null;
      set({ loading: false });
    }
  }
}));

auth.onAuthStateChanged(user => {
  if (!user) {
    if (unsubscribeShowsListener) {
      try { unsubscribeShowsListener(); } catch (e) {}
      unsubscribeShowsListener = null;
    }
    currentListeningUid = null;
    useShowsStore.getState().setShows([]);
    useShowsStore.getState().setLoading(false);
    useShowsStore.getState().setInitialized(false);
  } else {
    useShowsStore.getState().fetchShows();
  }
});
