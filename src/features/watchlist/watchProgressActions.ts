import type { Show } from '../../types';
import type { SeriesCardEpisode } from './seriesCardPresentation';
import { removeWatchRecord } from './watchNext18c';
import { auth, db } from '../../lib/firebase';
import { doc, updateDoc, arrayUnion } from 'firebase/firestore';
import { useShowsStore } from '../../store/showsStore';
import { useToastStore } from '../../store/toastStore';

type UpdateTrackedShow = (id: string, updates: Partial<Show>) => Promise<void>;
export async function markMovieWatched(requested: Show, updateShow: UpdateTrackedShow) {
    const showToast = useToastStore.getState().showToast;
    const uid = auth.currentUser?.uid;
    if (!uid) return false;
    const show = useShowsStore.getState().shows.find(item => item.id === requested.id);
    if (!show || show.userId && show.userId !== uid || show.mediaType !== 'movie' || show.seenEpisodes?.includes('movie')) return false;
    const now = Date.now();
    const previous: Partial<Show> = { seenEpisodes: show.seenEpisodes || [], status: show.status,
      lastWatchedAt: show.lastWatchedAt || null, episodeRecords: show.episodeRecords || {}, updatedAt: now, isSynced: false };
    const movieRecord = { ...show.episodeRecords?.movie, watchedAt: now, watchedTimeKnown: true, episodeTitle: show.title };
    useShowsStore.getState().updateShowOptimistic(show.id, {
      seenEpisodes: [...(show.seenEpisodes || []), 'movie'], status: 'completed',
      episodeRecords: { ...show.episodeRecords, movie: movieRecord }, lastWatchedAt: now, updatedAt: now, isSynced: false,
    });
    try {
      const docRef = doc(db, 'users', uid, 'shows', show.id);
      await updateDoc(docRef, { seenEpisodes: arrayUnion('movie'), status: 'completed',
        lastWatchedAt: now, updatedAt: now, isSynced: false, 'episodeRecords.movie': movieRecord });
    } catch (error) {
      if (auth.currentUser?.uid === uid) {
        useShowsStore.getState().updateShowOptimistic(show.id, previous);
        showToast('Le film n’a pas pu être marqué vu.', 'error');
      }
      throw error;
    }
    if (auth.currentUser?.uid !== uid) return false;
    showToast(`« ${show.title} » marqué comme vu !`, 'success', show, async () => {
      if (auth.currentUser?.uid !== uid) return;
      await updateShow(show.id, { ...previous, updatedAt: Date.now() });
    });
    return true;
}

export async function markWatchRecordUnseen(requested: Show, episode: SeriesCardEpisode | null, updateShow: UpdateTrackedShow) {
    const showToast = useToastStore.getState().showToast;
    const uid = auth.currentUser?.uid;
    if (!uid) return false;
    const show = useShowsStore.getState().shows.find(item => item.id === requested.id);
    if (!show || show.userId && show.userId !== uid) return false;
    const mutation = removeWatchRecord(show, episode);
    if (!mutation) return false;
    await updateShow(show.id, mutation.updates);
    if (auth.currentUser?.uid !== uid) return false;
    showToast(`« ${show.title} » marqué comme non vu`, 'info', show, async () => {
      if (auth.currentUser?.uid !== uid) return;
      await updateShow(show.id, { ...mutation.rollback, updatedAt: Date.now() });
    });
    return true;
}
