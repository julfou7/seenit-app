import { useRef, useState } from 'react';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import type { Show } from '../../types';
import { requestNotificationPermission, auth, db } from '../../lib/firebase';
import { readUserScopedJson, removeUserScopedValue, writeUserScopedJson } from '../../lib/userIsolation';
import { useShowActions } from '../../hooks/useShows';
import { useToastStore } from '../../store/toastStore';
import { appLogger } from '../../store/logStore';

export interface ReminderEpisode { season_number: number; episode_number: number; name?: string | null; air_date?: string | null }

export const reminderStorageField = (showId: string, episode: ReminderEpisode) => `reminder_${showId}_S${episode.season_number}E${episode.episode_number}`;
export const reminderEpisodeString = (episode: ReminderEpisode) => `S${String(episode.season_number).padStart(2, '0')}E${String(episode.episode_number).padStart(2, '0')}`;

/** Rappel posé sur cet épisode (ou rappels de la série activés). */
export function readEpisodeReminder(show: Show | null | undefined, episode: ReminderEpisode): boolean {
  if (!show?.id) return false;
  if (show.notificationsEnabled) return true;
  return readUserScopedJson(auth.currentUser?.uid, reminderStorageField(show.id, episode), false);
}

/**
 * Cloche d'un épisode à venir, partagée par la carte À venir, les lignes de la fiche série et la fiche épisode
 * (retour terrain du 08/11 : pas de cloche sur un épisode à venir de la fiche). Même écriture qu'avant :
 * préférence de la série, document `users/{uid}/reminders/{showId}_SxxEyy` et repère local, avec retour
 * arrière de la préférence si l'écriture échoue ; rien n'est écrit sous un autre compte.
 */
export async function writeEpisodeReminder(options: { target: Show; ownerUid: string; nextState: boolean; episode: ReminderEpisode; updateShow: (id: string, updates: Partial<Show>) => Promise<unknown> }): Promise<boolean> {
  const { target, ownerUid, nextState, episode, updateShow } = options;
  const episodeString = reminderEpisodeString(episode);
  let fcmToken: string | null = null;
  if (nextState) {
    try { fcmToken = await requestNotificationPermission(); }
    catch (error) { appLogger.warn('system', 'Autorisation des notifications indisponible', error); }
  }
  if (auth.currentUser?.uid !== ownerUid) return false;
  const preferenceChanged = Boolean(target.notificationsEnabled) !== nextState;
  try {
    if (preferenceChanged) await updateShow(target.id, { notificationsEnabled: nextState });
    if (auth.currentUser?.uid !== ownerUid) return false;
    const reminderRef = doc(db, 'users', ownerUid, 'reminders', `${target.id}_${episodeString}`);
    if (nextState) await setDoc(reminderRef, {
      showId: target.id, showTitle: target.title, episodeString,
      seasonNumber: episode.season_number, episodeNumber: episode.episode_number,
      episodeTitle: episode.name || '', air_date: episode.air_date,
      fcmToken: fcmToken || '', createdAt: Date.now(),
    });
    else await deleteDoc(reminderRef);
  } catch (error) {
    if (preferenceChanged && auth.currentUser?.uid === ownerUid) {
      try { await updateShow(target.id, { notificationsEnabled: Boolean(target.notificationsEnabled) }); }
      catch (rollbackError) { appLogger.warn('system', 'Restauration du rappel impossible', rollbackError); }
    }
    throw error;
  }
  if (auth.currentUser?.uid !== ownerUid) return false;
  const field = reminderStorageField(target.id, episode);
  if (nextState) writeUserScopedJson(ownerUid, field, true);
  else removeUserScopedValue(ownerUid, field);
  return true;
}

/** Cloche d'un épisode à venir d'une série suivie : état affiché, attente et bascule (une seule à la fois). */
export function useEpisodeReminder(show: Show | null | undefined, episode: ReminderEpisode) {
  const { updateShow } = useShowActions();
  const [stored, setStored] = useState<boolean | null>(null);
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const flight = useRef(false);
  const current = stored ?? readEpisodeReminder(show, episode);
  const toggle = async () => {
    const ownerUid = auth.currentUser?.uid;
    if (flight.current || !ownerUid || !show?.id) return;
    flight.current = true;
    const nextState = !current;
    setOptimistic(nextState);
    setPending(true);
    try {
      if (await writeEpisodeReminder({ target: show, ownerUid, nextState, episode, updateShow })) setStored(nextState);
    } catch (error) {
      if (auth.currentUser?.uid === ownerUid) useToastStore.getState().showToast('Rappel impossible. Réessaie.', 'error');
      appLogger.warn('system', 'Activation du rappel impossible', error);
    } finally { flight.current = false; setPending(false); setOptimistic(null); }
  };
  return { reminder: optimistic ?? current, pending, toggle, available: Boolean(show?.id) };
}
