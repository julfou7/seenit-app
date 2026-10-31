import { doc, setDoc } from 'firebase/firestore';
import { auth, db } from '../../lib/firebase';
import { useShowsStore } from '../../store/showsStore';
import { useToastStore } from '../../store/toastStore';
import type { Show } from '../../types';

/** Preserve the original document and its watch records when undoing a removal. */
export async function removeTrackedMedia(show: Show, deleteShow: (id: string) => Promise<void>) {
 const owner = auth.currentUser?.uid;
 if (!owner || (show.userId && show.userId !== owner)) return;
 await deleteShow(show.id);
 if (auth.currentUser?.uid !== owner) return;
 useToastStore.getState().showToast(`« ${show.title} » retiré d’À voir`, 'unfollow', show, async () => {
  if (auth.currentUser?.uid !== owner) return;
  await setDoc(doc(db, 'users', owner, 'shows', show.id), show);
  if (auth.currentUser?.uid === owner) useShowsStore.getState().addShowOptimistic(show);
 });
}
