import { create } from 'zustand';
import { db, auth } from '../lib/firebase';
import { collection, query, getDocs, getDocsFromCache, getDocsFromServer, doc, writeBatch, onSnapshot, deleteDoc } from 'firebase/firestore';
import { type Show } from '../types';
import { handleFirestoreError, OperationType } from '../lib/firebaseErrors';
import { useSyncStore } from './syncStore';
import { appLogger } from './logStore';
import { getNextEpisodeNumber, checkIsUpToDate } from '../lib/utils';

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
  uploadAllToCloud: () => Promise<{ success: boolean; count: number; error?: string }>;
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
 * Envoie une liste de séries vers Firestore par lots (batches de 250 docs)
 */
export async function uploadShowsToFirestore(userId: string, shows: Show[]): Promise<{ success: boolean; count: number; error?: string }> {
  if (!shows || shows.length === 0) return { success: true, count: 0 };
  try {
    appLogger.info('sync', `[showsStore] Sauvegarde Cloud Firestore : envoi de ${shows.length} série(s)...`);
    const BATCH_SIZE = 250;
    let totalUploaded = 0;

    for (let i = 0; i < shows.length; i += BATCH_SIZE) {
      const chunk = shows.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(db);

      for (const show of chunk) {
        const showId = show.id || `${show.mediaType || 'tv'}_${show.tmdbId}`;
        const docRef = doc(db, 'users', userId, 'shows', String(showId));
        
        // Nettoyer les propriétés undefined pour Firestore
        const cleanData: any = {};
        Object.entries(show).forEach(([k, v]) => {
          if (v !== undefined) {
            cleanData[k] = v;
          }
        });
        cleanData.id = String(showId);
        cleanData.userId = userId;
        cleanData.updatedAt = cleanData.updatedAt || Date.now();

        batch.set(docRef, cleanData, { merge: true });
      }

      await batch.commit();
      totalUploaded += chunk.length;
    }

    appLogger.success('sync', `[showsStore] ✅ ${totalUploaded} série(s) synchronisée(s) vers le Cloud Firestore avec succès !`);
    return { success: true, count: totalUploaded };
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    appLogger.error('sync', `[showsStore] ❌ Erreur sauvegarde Cloud Firestore: ${errMsg}`, err);
    return { success: false, count: 0, error: errMsg };
  }
}

/**
 * Fusionne et déduplique intelligemment les séries (en combinant seenEpisodes et records)
 */
function deduplicateAndMergeShows(rawShows: Show[], currentLocalShows: Show[] = []): { mergedShows: Show[]; duplicateDocIds: string[] } {
  const deduplicatedMap = new Map<string, Show>();
  const duplicateDocIds: string[] = [];

  // Fonction utilitaire pour conserver la version la plus récente (règle le bug du "non vu")
  const mergeBasedOnTime = (older: Show, newer: Show): Show => {
    return {
      ...newer,
      // On prend strictement les données du plus récent (qui peut avoir des suppressions d'épisodes)
      seenEpisodes: newer.seenEpisodes,
      episodeRecords: newer.episodeRecords,
      lastWatchedAt: Math.max(newer.lastWatchedAt || 0, older.lastWatchedAt || 0),
      updatedAt: newer.updatedAt || Date.now()
    };
  };

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
      const isExistingNewer = (existing.updatedAt || 0) > (show.updatedAt || 0);
      const olderId = isExistingNewer ? show.id : existing.id;
      if (olderId && show.id !== existing.id) {
        duplicateDocIds.push(olderId);
      }
      deduplicatedMap.set(key, isExistingNewer ? mergeBasedOnTime(show, existing) : mergeBasedOnTime(existing, show));
    }
  }

  // 2. Fusionner avec les séries locales actuelles (seulement si le local est strictement plus récent, ex: hors ligne)
  for (const localShow of currentLocalShows) {
    const tmdbIdNum = Number(localShow.tmdbId);
    const mType = localShow.mediaType || 'tv';
    if (!tmdbIdNum || isNaN(tmdbIdNum) || tmdbIdNum === 114108) continue; // Purge Cinderella 1899

    const key = `${mType}_${tmdbIdNum}`;
    const remoteShow = deduplicatedMap.get(key);

    if (remoteShow) {
      const isLocalNewer = (localShow.updatedAt || 0) > (remoteShow.updatedAt || 0);
      if (isLocalNewer) {
        deduplicatedMap.set(key, mergeBasedOnTime(remoteShow, localShow));
      }
    } else if (rawShows.length === 0) {
      // Si Firestore est complètement vide au premier démarrage, on préserve l'élément local
      deduplicatedMap.set(key, { ...localShow });
    } else {
      // Si Firestore contient déjà des données mais que cet élément n'y est pas,
      // on ne le conserve que s'il s'agit d'un ajout local très récent (< 10 min) pour éviter de ressusciter un élément supprimé ailleurs
      const isVeryRecentLocal = localShow.createdAt && (Date.now() - localShow.createdAt < 10 * 60 * 1000);
      if (isVeryRecentLocal) {
        deduplicatedMap.set(key, { ...localShow });
      }
    }
  }

  // 3. Vérifier que nextEpisodeToWatch ne pointe pas vers un épisode DÉJÀ VU
  const finalShows: Show[] = [];
  for (const show of deduplicatedMap.values()) {
    const seen = show.seenEpisodes || [];
    let nextEp = show.nextEpisodeToWatch;

    if (nextEp && seen.includes(`${nextEp.season_number}x${nextEp.episode_number}`)) {
      if (show.seasonsCache && Array.isArray(show.seasonsCache) && show.seasonsCache.length > 0) {
        const foundNext = getNextEpisodeNumber(show.seasonsCache, seen);
        if (foundNext) {
          nextEp = {
            ...nextEp,
            season_number: foundNext.season,
            episode_number: foundNext.episode,
            air_date: foundNext.episodeData?.air_date || null,
            name: foundNext.episodeData?.name || null,
            still_path: foundNext.episodeData?.still_path || null
          };
        } else {
          nextEp = null;
        }
      } else {
        const total = show.totalAiredEpisodes || show.totalEpisodes || 0;
        if (total > 0 && seen.length >= total) {
          nextEp = null;
        } else if (checkIsUpToDate(show)) {
          nextEp = null;
        } else {
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
      }
    }

    finalShows.push({
      ...show,
      nextEpisodeToWatch: nextEp
    });
  }

  return { mergedShows: finalShows, duplicateDocIds };
}

let unsubscribeRealtimeListener: (() => void) | null = null;

export function setupRealtimeShowsListener(userId: string) {
  if (unsubscribeRealtimeListener) {
    unsubscribeRealtimeListener();
    unsubscribeRealtimeListener = null;
  }
  try {
    const showsRef = collection(db, 'users', userId, 'shows');
    unsubscribeRealtimeListener = onSnapshot(showsRef, (snapshot) => {
      const remoteShows: Show[] = [];
      snapshot.forEach((docSnap) => {
        remoteShows.push({ ...docSnap.data(), id: String(docSnap.id) } as Show);
      });
      const currentLocal = useShowsStore.getState().shows;
      const { mergedShows } = deduplicateAndMergeShows(remoteShows, currentLocal);
      saveToLocalStorage(mergedShows);
      useShowsStore.setState({ shows: mergedShows, loading: false, initialized: true });
    }, (err) => {
      console.warn('[showsStore] Realtime listener error:', err);
    });
  } catch (err) {
    console.warn('[showsStore] Failed to setup realtime listener:', err);
  }
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
    if (!user) {
      appLogger.warn('auth', '[showsStore] fetchShows ignoré car aucun utilisateur n\'est connecté');
      return;
    }
    
    appLogger.info('sync', `[showsStore] Début de fetchShows pour l'utilisateur UID: ${user.uid}`);
    
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
          const { mergedShows } = deduplicateAndMergeShows(cachedShows, get().shows);
          saveToLocalStorage(mergedShows);
          set({ shows: mergedShows, loading: false, initialized: true });
        }
      } catch (cacheErr: any) {
        // Cache optionnel
      }

      // 2. Fetch depuis le réseau (FORCÉ DEPUIS LE SERVEUR pour casser le cache PWA)
      let snapshot;
      try {
        snapshot = await getDocsFromServer(q);
      } catch (e: any) {
        snapshot = await getDocs(q);
      }
      
      const rawLoadedShows: Show[] = [];
      snapshot.forEach((doc) => {
        rawLoadedShows.push({ ...doc.data(), id: String(doc.id) } as Show);
      });

      const localShowsBeforeMerge = get().shows;
      const { mergedShows, duplicateDocIds } = deduplicateAndMergeShows(rawLoadedShows, localShowsBeforeMerge);

      if (rawLoadedShows.length !== mergedShows.length) {
        appLogger.info('sync', `[showsStore] ${rawLoadedShows.length} documents Firestore reçus -> ${mergedShows.length} médias uniques en mémoire (${rawLoadedShows.length - mergedShows.length} doublons dédupliqués).`);
      } else {
        appLogger.info('sync', `[showsStore] Chargement terminé : ${mergedShows.length} médias parfaitement synchronisés.`);
      }

      // Nettoyage en arrière-plan des doublons obsolètes dans Firestore
      if (duplicateDocIds.length > 0) {
        appLogger.info('sync', `[showsStore] Nettoyage en arrière-plan de ${duplicateDocIds.length} document(s) doublon(s) dans Firestore...`);
        try {
          const delBatch = writeBatch(db);
          for (const dupId of duplicateDocIds) {
            delBatch.delete(doc(db, 'users', user.uid, 'shows', dupId));
          }
          await delBatch.commit();
        } catch (delErr) {
          console.warn('[showsStore] Non-critical error cleaning duplicates:', delErr);
        }
      }

      saveToLocalStorage(mergedShows);
      set({ shows: mergedShows, loading: false, initialized: true });

      // Si le cache local contient des séries qui ne sont pas sur le Cloud (ex: créées/importées sur la PWA),
      // on les synchronise automatiquement vers Firestore pour que l'APK mobile et tous les appareils y accèdent !
      if (mergedShows.length > rawLoadedShows.length) {
        const missingOnCloud = mergedShows.filter(localS => 
          !rawLoadedShows.some(remoteS => 
            remoteS.id === localS.id || 
            (remoteS.tmdbId && localS.tmdbId && Number(remoteS.tmdbId) === Number(localS.tmdbId) && (remoteS.mediaType || 'tv') === (localS.mediaType || 'tv'))
          )
        );
        if (missingOnCloud.length > 0) {
          appLogger.info('sync', `[showsStore] Détection de ${missingOnCloud.length} série(s) locale(s) à téléverser vers Firestore...`);
          uploadShowsToFirestore(user.uid, missingOnCloud);
        }
      }
    } catch (err: any) {
      const errStr = err?.message || String(err);
      appLogger.error('sync', `[showsStore] Erreur fatale lors de fetchShows : ${errStr}`, err);
      
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
  },

  uploadAllToCloud: async () => {
    const user = auth.currentUser;
    if (!user) {
      return { success: false, count: 0, error: 'Utilisateur non connecté' };
    }
    const currentShows = get().shows;
    if (currentShows.length === 0) {
      return { success: true, count: 0 };
    }
    return await uploadShowsToFirestore(user.uid, currentShows);
  }
}));

auth.onAuthStateChanged(user => {
  if (user) {
    localStorage.removeItem('explicit_logout');
    const prevUid = localStorage.getItem('last_active_uid');
    if (prevUid && prevUid !== user.uid) {
      // Un utilisateur différent s'est connecté, on vide le cache précédent pour sécurité
      useShowsStore.getState().setShows([]);
      useShowsStore.getState().setInitialized(false);
    }
    localStorage.setItem('last_active_uid', user.uid);
    useShowsStore.getState().fetchShows();
    setupRealtimeShowsListener(user.uid);
  } else {
    if (unsubscribeRealtimeListener) {
      unsubscribeRealtimeListener();
      unsubscribeRealtimeListener = null;
    }
    const explicitLogout = localStorage.getItem('explicit_logout') === 'true';
    if (explicitLogout) {
      useShowsStore.getState().setShows([]);
      useShowsStore.getState().setInitialized(false);
      localStorage.removeItem('last_active_uid');
      localStorage.removeItem('explicit_logout');
    }
    useShowsStore.getState().setLoading(false);
  }
});