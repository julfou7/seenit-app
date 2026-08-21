import { useCallback } from "react";
import { db, auth } from '../lib/firebase';
import { collection, query, doc, setDoc, updateDoc, deleteDoc, getDocs, where, arrayUnion } from 'firebase/firestore';
import { type Show } from '../types';
import { useShowsStore } from '../store/showsStore';
import { handleFirestoreError, OperationType } from '../lib/firebaseErrors';
import { useSyncStore } from '../store/syncStore';

export function useShows() {
  const shows = useShowsStore(state => state.shows);
  const loading = useShowsStore(state => state.loading);
  const addShowOptimistic = useShowsStore(state => state.addShowOptimistic);
  const updateShowOptimistic = useShowsStore(state => state.updateShowOptimistic);
  const removeShowOptimistic = useShowsStore(state => state.removeShowOptimistic);
  const fetchShows = useShowsStore(state => state.fetchShows);

  const addShow = useCallback(async (showData: Omit<Show, 'id' | 'userId'>) => {
    if (!auth.currentUser) throw new Error("Not authenticated");
    
    // Vérifier si un document avec le même tmdbId et mediaType existe déjà
    const currentShows = useShowsStore.getState().shows;
    const existingShow = currentShows.find(s => 
      s.tmdbId && showData.tmdbId && 
      Number(s.tmdbId) === Number(showData.tmdbId) && 
      (s.mediaType || 'tv') === (showData.mediaType || 'tv')
    );

    if (existingShow && existingShow.id) {
      // Mettre à jour le document existant plutôt que créer un doublon
      const cleanData: any = {};
      Object.entries(showData).forEach(([key, val]) => {
        cleanData[key] = val === undefined ? null : val;
      });
      updateShowOptimistic(existingShow.id, cleanData);
      const docRef = doc(db, 'users', auth.currentUser.uid, 'shows', existingShow.id);
      await updateDoc(docRef, cleanData);
      return existingShow.id;
    }

    const showsRef = collection(db, 'users', auth.currentUser.uid, 'shows');
    const docRef = doc(showsRef);
    
    const cleanData: any = {};
    Object.entries(showData).forEach(([key, val]) => {
      cleanData[key] = val === undefined ? null : val;
    });

    const newShow = { id: docRef.id, ...cleanData, userId: auth.currentUser.uid } as Show;
    addShowOptimistic(newShow);

    try {
      await setDoc(docRef, newShow);
      return docRef.id;
    } catch (err: any) {
      removeShowOptimistic(docRef.id);
      const errStr = err?.message || String(err);
      if (
        err?.code === 'resource-exhausted' || 
        errStr.toLowerCase().includes('quota exceeded') || 
        errStr.toLowerCase().includes('quota-exceeded') ||
        errStr.toLowerCase().includes('resource-exhausted') ||
        errStr.toLowerCase().includes('resource_exhausted')
      ) {
        useSyncStore.getState().setQuotaExceeded(true);
      }
      handleFirestoreError(err, OperationType.CREATE, `users/${auth.currentUser.uid}/shows`);
      throw err;
    }
  }, [addShowOptimistic, removeShowOptimistic, updateShowOptimistic]);

  const updateShow = useCallback(async (id: string, updates: Partial<Show>) => {
    if (!auth.currentUser) throw new Error("Not authenticated");
    
    // Perform optimistic update
    updateShowOptimistic(id, updates);
    
    const docRef = doc(db, 'users', auth.currentUser.uid, 'shows', id);
    
    const cleanUpdates: any = {};
    Object.entries(updates).forEach(([key, val]) => {
      if (val === undefined) {
        cleanUpdates[key] = null;
      } else if (key === 'seenEpisodes' && Array.isArray(val) && val.length > 0) {
        cleanUpdates['seenEpisodes'] = arrayUnion(...val);
      } else if (key === 'episodeRecords' && val && typeof val === 'object' && !Array.isArray(val)) {
        Object.entries(val).forEach(([epKey, recVal]) => {
          cleanUpdates[`episodeRecords.${epKey}`] = recVal === undefined ? null : recVal;
        });
      } else {
        cleanUpdates[key] = val;
      }
    });

    try {
      await updateDoc(docRef, cleanUpdates);
    } catch (err: any) {
      // Revert optimistic update by re-fetching shows
      fetchShows();
      const errStr = err?.message || String(err);
      if (
        err?.code === 'resource-exhausted' || 
        errStr.toLowerCase().includes('quota exceeded') || 
        errStr.toLowerCase().includes('quota-exceeded') ||
        errStr.toLowerCase().includes('resource-exhausted') ||
        errStr.toLowerCase().includes('resource_exhausted')
      ) {
        useSyncStore.getState().setQuotaExceeded(true);
      }
      handleFirestoreError(err, OperationType.UPDATE, `users/${auth.currentUser.uid}/shows/${id}`);
      throw err;
    }
  }, [updateShowOptimistic, fetchShows]);

  const deleteShow = useCallback(async (id: string) => {
    if (!auth.currentUser) throw new Error("Not authenticated");
    
    removeShowOptimistic(id);
    
    const docRef = doc(db, 'users', auth.currentUser.uid, 'shows', id);

    try {
      await deleteDoc(docRef);
    } catch (err: any) {
      // Revert optimistic update
      fetchShows();
      const errStr = err?.message || String(err);
      if (
        err?.code === 'resource-exhausted' || 
        errStr.toLowerCase().includes('quota exceeded') || 
        errStr.toLowerCase().includes('quota-exceeded') ||
        errStr.toLowerCase().includes('resource-exhausted') ||
        errStr.toLowerCase().includes('resource_exhausted')
      ) {
        useSyncStore.getState().setQuotaExceeded(true);
      }
      handleFirestoreError(err, OperationType.DELETE, `users/${auth.currentUser.uid}/shows/${id}`);
      throw err;
    }
  }, [removeShowOptimistic, fetchShows]);

  const getShowByTmdbId = useCallback(async (tmdbId: number): Promise<Show | null> => {
    if (!auth.currentUser) return null;
    const showsRef = collection(db, 'users', auth.currentUser.uid, 'shows');
    const q = query(showsRef, where('tmdbId', '==', tmdbId));
    try {
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        const doc = snapshot.docs[0];
        return { ...doc.data(), id: String(doc.id) } as Show;
      }
      return null;
    } catch (err: any) {
      const errStr = err?.message || String(err);
      if (
        err?.code === 'resource-exhausted' || 
        errStr.toLowerCase().includes('quota exceeded') || 
        errStr.toLowerCase().includes('quota-exceeded') ||
        errStr.toLowerCase().includes('resource-exhausted') ||
        errStr.toLowerCase().includes('resource_exhausted')
      ) {
        useSyncStore.getState().setQuotaExceeded(true);
      }
      handleFirestoreError(err, OperationType.LIST, `users/${auth.currentUser.uid}/shows`);
      return null;
    }
  }, []);

  return { shows, loading, addShow, updateShow, deleteShow, getShowByTmdbId };
}
