import { useRef, useState } from 'react';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import type { Show } from '../../types';
import { requestNotificationPermission, auth, db } from '../../lib/firebase';
import { readUserScopedJson, writeUserScopedJson } from '../../lib/userIsolation';
import { useShowActions } from '../../hooks/useShows';
import { useToastStore } from '../../store/toastStore';
import { appLogger } from '../../store/logStore';
import { Capacitor } from '@capacitor/core';
import { readEffectiveNotificationPreferences } from './notificationPreferences';

export interface ReminderEpisode { season_number: number; episode_number: number; name?: string | null; air_date?: string | null }

export const reminderStorageField = (showId: string, episode: ReminderEpisode) => `reminder_${showId}_S${episode.season_number}E${episode.episode_number}`;
export const reminderEpisodeString = (episode: ReminderEpisode) => `S${String(episode.season_number).padStart(2, '0')}E${String(episode.episode_number).padStart(2, '0')}`;

/**
 * Règle de la série, appliquée aux épisodes sans choix propre (même règle que useRemindersNotifier) :
 * - choix explicite de la série (`notificationsEnabled` vrai ou faux) ;
 * - sinon, une série suivie, ni archivée ni abandonnée, est prévenue par défaut quand la préférence « Sortie du
 *   jour » (épisodes) ou une préférence de sortie de film est active ;
 * - une série non suivie (fiche acteur) n'a aucun rappel tant qu'elle n'est pas ajoutée.
 */
export function seriesRemindersActive(show: Show | null | undefined, uid = auth.currentUser?.uid): boolean {
  if (!show?.id) return false;
  if (show.notificationsEnabled === true || readUserScopedJson(uid, `reminder_${show.id}`, false)) return true;
  if (show.notificationsEnabled === false || show.isArchived || show.status === 'dropped') return false;
  const prefs = readEffectiveNotificationPreferences(readUserScopedJson(uid, 'notifications', null), Capacitor.getPlatform());
  return show.mediaType === 'movie' ? prefs.movie_theater || prefs.movie_dvd_vod : prefs.release_today_tv;
}

/** Choix posé sur l'épisode lui-même : allumé (`true`), coupé (`false`) ou aucun (`null`). */
export function readEpisodeChoice(show: Show | null | undefined, episode: ReminderEpisode, uid = auth.currentUser?.uid): boolean | null {
  if (!show?.id) return null;
  const value = readUserScopedJson<unknown>(uid, reminderStorageField(show.id, episode), null);
  return typeof value === 'boolean' ? value : null;
}

/**
 * Rappel actif pour cet épisode. Retour terrain du 18/11 (« une cloche = cet épisode seul », remplace la décision du
 * 09/11 #910 « toute la série ») : le choix posé sur l'épisode l'emporte ; sans choix, la règle de la série s'applique
 * (choix explicite de la série, sinon « Sortie du jour » pour une série suivie).
 */
export function readEpisodeReminder(show: Show | null | undefined, episode: ReminderEpisode): boolean {
  if (!show?.id) return false;
  return readEpisodeChoice(show, episode) ?? seriesRemindersActive(show);
}

/**
 * Cloche d'un épisode à venir, partagée par la carte À venir, les lignes de la fiche série et la fiche épisode.
 * Retour terrain du 18/11 : elle n'agit que sur cet épisode. Allumer écrit le document `users/{uid}/reminders/
 * {showId}_SxxEyy` (envoyé par le serveur le jour de la sortie) ; couper le supprime ; dans les deux cas, le choix de
 * l'épisode est gardé localement (`true` ou `false`) pour l'emporter sur la règle de la série. Rien n'est écrit sous un
 * autre compte, et le choix local n'est posé qu'après l'écriture réussie.
 */
export async function writeEpisodeReminder(options: { target: Show; ownerUid: string; nextState: boolean; episode: ReminderEpisode; updateShow?: (id: string, updates: Partial<Show>) => Promise<unknown> }): Promise<boolean> {
  const { target, ownerUid, nextState, episode, updateShow } = options;
  const episodeString = reminderEpisodeString(episode);
  let fcmToken: string | null = null;
  if (nextState) {
    try { fcmToken = await requestNotificationPermission(); }
    catch (error) { appLogger.warn('system', 'Autorisation des notifications indisponible', error); }
  }
  if (auth.currentUser?.uid !== ownerUid) return false;
  // Un film n'a pas d'épisode : son rappel reste le réglage du film (`notificationsEnabled`), restauré si l'écriture échoue.
  const filmChanged = target.mediaType === 'movie' && Boolean(updateShow) && target.notificationsEnabled !== nextState;
  const reminderRef = doc(db, 'users', ownerUid, 'reminders', `${target.id}_${episodeString}`);
  try {
    if (filmChanged) await updateShow!(target.id, { notificationsEnabled: nextState });
    if (auth.currentUser?.uid !== ownerUid) return false;
    if (nextState) await setDoc(reminderRef, {
      showId: target.id, showTitle: target.title, episodeString,
      seasonNumber: episode.season_number, episodeNumber: episode.episode_number,
      episodeTitle: episode.name || '', air_date: episode.air_date,
      fcmToken: fcmToken || '', createdAt: Date.now(),
    });
    else await deleteDoc(reminderRef);
  } catch (error) {
    if (filmChanged && auth.currentUser?.uid === ownerUid) {
      try { await updateShow!(target.id, { notificationsEnabled: target.notificationsEnabled }); }
      catch (rollbackError) { appLogger.warn('system', 'Restauration du rappel impossible', rollbackError); }
    }
    throw error;
  }
  if (auth.currentUser?.uid !== ownerUid) return false;
  writeUserScopedJson(ownerUid, reminderStorageField(target.id, episode), nextState);
  return true;
}
/** Écriture réussie de cette cloche, valable seulement pour la fiche sur laquelle elle a été faite. */
export interface StoredReminder { value: boolean; basis: Show | null | undefined }

/**
 * État affiché d'une cloche. Revue Codex (#917) : la préférence `notificationsEnabled` est partagée par toutes
 * les cloches de la série ; dès qu'une nouvelle fiche arrive (écriture relue, autre épisode basculé), l'état lu
 * sur la fiche reprend la main au lieu du dernier clic local, qui ne couvre que l'attente de cette relecture.
 */
export function displayedEpisodeReminder(stored: StoredReminder | null, show: Show | null | undefined, episode: ReminderEpisode): boolean {
  return stored && stored.basis === show ? stored.value : readEpisodeReminder(show, episode);
}

/** Cloche d'un épisode à venir d'une série suivie : état affiché, attente et bascule (une seule à la fois). */
export function useEpisodeReminder(show: Show | null | undefined, episode: ReminderEpisode) {
  const { updateShow } = useShowActions();
  const [stored, setStored] = useState<StoredReminder | null>(null);
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const flight = useRef(false);
  const current = displayedEpisodeReminder(stored, show, episode);
  const toggle = async () => {
    const ownerUid = auth.currentUser?.uid;
    if (flight.current || !ownerUid || !show?.id) return;
    flight.current = true;
    const nextState = !current;
    const basis = show;
    setOptimistic(nextState);
    setPending(true);
    try {
      if (await writeEpisodeReminder({ target: show, ownerUid, nextState, episode, updateShow })) setStored({ value: nextState, basis });
    } catch (error) {
      if (auth.currentUser?.uid === ownerUid) useToastStore.getState().showToast('Rappel impossible. Réessaie.', 'error');
      appLogger.warn('system', 'Activation du rappel impossible', error);
    } finally { flight.current = false; setPending(false); setOptimistic(null); }
  };
  return { reminder: optimistic ?? current, pending, toggle, available: Boolean(show?.id) };
}
