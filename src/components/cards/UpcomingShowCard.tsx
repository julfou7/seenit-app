import React, { useEffect, useRef, useState } from 'react';
import { Calendar, Bell } from 'lucide-react';
import { type Show } from '../../types';
import { requestNotificationPermission, auth, db, sendNativeNotification } from '../../lib/firebase';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { useToastStore } from '../../store/toastStore';
import { useShows } from '../../hooks/useShows';
import { cn, getTodayStr, getCalendarDaysDiff, getEpisodeRelativeAirDate } from '../../lib/utils';
import { getFormattedProviderLogo } from '../../utils/providerLogos';
import { usePassiveWatchProvider } from '../../hooks/usePassiveWatchProvider';
import { readUserScopedJson, removeUserScopedValue, writeUserScopedJson } from '../../lib/userIsolation';
import { SeriesEpisodeCard, type SeriesCardAction } from './SeriesEpisodeCard';
import { buildMovieCollectionProgress, type CollectionPart } from '../../features/watchlist/movieCollectionProgress';
import { loadMovieCollection } from '../../features/watchlist/movieCollectionLoader';
import { appLogger } from '../../store/logStore';

export interface UpcomingEpisodeInfo {
  season_number: number;
  episode_number: number;
  name?: string;
  air_date: string; // "YYYY-MM-DD"
  still_path?: string | null;
}

export function getUpcomingEpisodeInfo(s: Show): UpcomingEpisodeInfo | null {
  if (!s || s.isArchived || s.status === 'dropped') {
    return null;
  }

  const todayStr = getTodayStr();

  // If it's a movie with a future release date
  if (s.mediaType === 'movie') {
    if (s.firstAirDate && s.firstAirDate >= todayStr) {
      const diffDays = getCalendarDaysDiff(s.firstAirDate);
      // Masquer les films prévus à plus d'un an (> 365 jours) pour éviter d'encombrer l'onglet "À Venir"
      if (diffDays > 365) {
        return null;
      }
      return {
        season_number: 1,
        episode_number: 1,
        name: 'Film',
        air_date: s.firstAirDate,
      };
    }
    return null;
  }

  const candidates: UpcomingEpisodeInfo[] = [];

  // Check nextEpisodeToAir
  if (s.nextEpisodeToAir?.air_date) {
    if (s.nextEpisodeToAir.air_date >= todayStr) {
      const diffDays = getCalendarDaysDiff(s.nextEpisodeToAir.air_date);
      if (diffDays <= 365) {
        candidates.push({
          season_number: s.nextEpisodeToAir.season_number,
          episode_number: s.nextEpisodeToAir.episode_number,
          name: s.nextEpisodeToAir.name,
          air_date: s.nextEpisodeToAir.air_date,
          still_path: s.nextEpisodeToAir.still_path,
        });
      }
    }
  }

  // Check nextEpisodeToWatch
  if (s.nextEpisodeToWatch?.air_date) {
    if (s.nextEpisodeToWatch.air_date >= todayStr) {
      const diffDays = getCalendarDaysDiff(s.nextEpisodeToWatch.air_date);
      if (diffDays <= 365) {
        candidates.push({
          season_number: s.nextEpisodeToWatch.season_number,
          episode_number: s.nextEpisodeToWatch.episode_number,
          name: s.nextEpisodeToWatch.name,
          air_date: s.nextEpisodeToWatch.air_date,
          still_path: s.nextEpisodeToWatch.still_path,
        });
      }
    }
  }

  if (candidates.length === 0) return null;

  // Pick the candidate with the earliest air_date >= todayStr
  candidates.sort((a, b) => new Date(a.air_date + 'T00:00:00').getTime() - new Date(b.air_date + 'T00:00:00').getTime());
  return candidates[0];
}

interface Props {
  key?: React.Key;
  show: Show;
  onShowClick?: (id: string, mediaType?: 'tv' | 'movie') => void;
  onEpisodeClick: (show: Show, seasonNumber: number, episodeNumber: number) => void;
  actions?: SeriesCardAction[];
  compact?: boolean;
  ensureTracked?: () => Promise<Show>;
}

export const UpcomingShowCard = React.memo(function UpcomingShowCard({ show, onShowClick, onEpisodeClick, actions, compact, ensureTracked }: Props) {
  const ep = compact && show.firstAirDate ? { season_number: 1, episode_number: 1, air_date: show.firstAirDate, name: 'Épisode 1' } : getUpcomingEpisodeInfo(show);
  if (!ep) return null;
  return <UpcomingShowCardContent key={`${show.mediaType}:${show.tmdbId}:${ep.season_number}x${ep.episode_number}`} show={show} ep={ep} onShowClick={onShowClick} onEpisodeClick={onEpisodeClick} actions={actions} compact={compact} ensureTracked={ensureTracked} />;
});

function UpcomingShowCardContent({ show, ep, onShowClick, onEpisodeClick, actions, compact, ensureTracked }: Props & { ep: UpcomingEpisodeInfo }) {
  const storageField = `reminder_${show.id}_S${ep.season_number}E${ep.episode_number}`;
  const [isReminderSet, setIsReminderSet] = useState<boolean>(() => {
    if (show.notificationsEnabled) return true;
    return readUserScopedJson(auth.currentUser?.uid, storageField, false);
  });
  const [loadingReminder, setLoadingReminder] = useState(false);
  const reminderFlight = useRef(false);
  const [optimisticReminder, setOptimisticReminder] = useState<boolean | null>(null);
  const displayedReminder = optimisticReminder ?? isReminderSet;
  const { showToast } = useToastStore();
  const { updateShow, shows } = useShows();
  const [visible, setVisible] = useState(false);
  const [collection, setCollection] = useState<CollectionPart[]>([]);
  useEffect(() => {
    if (!visible || compact || show.mediaType !== 'movie') return;
    let current = true;
    void loadMovieCollection(show.tmdbId).then(parts => { if (current) setCollection(parts); }).catch(() => {});
    return () => { current = false; };
  }, [show.tmdbId, show.mediaType, visible, compact]);

  const performReminder = async (target: Show, ownerUid: string, nextState: boolean) => {
    const targetStorageField = `reminder_${target.id}_S${ep.season_number}E${ep.episode_number}`;
    const sNumStr = String(ep.season_number).padStart(2, '0');
    const eNumStr = String(ep.episode_number).padStart(2, '0');
    const episodeString = `S${sNumStr}E${eNumStr}`;
    let fcmToken: string | null = null;
    if (nextState) {
      try { fcmToken = await requestNotificationPermission(); }
      catch (error) { appLogger.warn('system', 'Autorisation des notifications indisponible', error); }
    }
    if (auth.currentUser?.uid !== ownerUid) return;
    const preferenceChanged = Boolean(target.notificationsEnabled) !== nextState;
    try {
      if (preferenceChanged) await updateShow(target.id, { notificationsEnabled: nextState });
      if (auth.currentUser?.uid !== ownerUid) return;
      const reminderRef = doc(db, 'users', ownerUid, 'reminders', `${target.id}_${episodeString}`);
      if (nextState) await setDoc(reminderRef, {
        showId: target.id, showTitle: target.title, episodeString,
        seasonNumber: ep.season_number, episodeNumber: ep.episode_number,
        episodeTitle: ep.name || '', air_date: ep.air_date,
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
    if (auth.currentUser?.uid !== ownerUid) return;
    setIsReminderSet(nextState);
    if (nextState) writeUserScopedJson(ownerUid, targetStorageField, true);
    else removeUserScopedValue(ownerUid, targetStorageField);
    showToast(`« ${target.title} » S${sNumStr}E${eNumStr} • Rappel ${nextState ? 'activé' : 'désactivé'}`, 'reminder', target);
    if (nextState) {
      const posterUrl = target.posterPath ? target.posterPath.startsWith('http') ? target.posterPath : `https://image.tmdb.org/t/p/w185${target.posterPath}` : 'https://seenit.app/icon-192.png';
      const still = ep.still_path || target.nextEpisodeToAir?.still_path || target.nextEpisodeToWatch?.still_path || target.backdropPath;
      try {
        void sendNativeNotification(`🔔 Rappel programmé : ${target.title}`, {
          body: `Rappel enregistré pour l'épisode ${episodeString} (${ep.name || 'Prochainement'})`,
          icon: posterUrl, image: still ? still.startsWith('http') ? still : `https://image.tmdb.org/t/p/w780${still}` : posterUrl,
          data: { showId: target.id, tmdbId: target.tmdbId, mediaType: target.mediaType || 'tv', season: ep.season_number, episode: ep.episode_number },
        }).catch(error => appLogger.warn('system', 'Notification locale de rappel indisponible', error));
      } catch (error) { appLogger.warn('system', 'Notification locale de rappel indisponible', error); }
    }
  };
  const toggleReminder = async (event: React.MouseEvent) => {
    event.stopPropagation();
    const ownerUid = auth.currentUser?.uid;
    if (reminderFlight.current || !ownerUid) return;
    reminderFlight.current = true;
    const nextState = !isReminderSet;
    setOptimisticReminder(nextState);
    setLoadingReminder(true);
    try {
      const tracked = ensureTracked ? await ensureTracked() : show;
      if (!tracked.id || auth.currentUser?.uid !== ownerUid) return;
      await performReminder(tracked, ownerUid, nextState);
    } catch (error) {
      if (auth.currentUser?.uid === ownerUid) showToast('Rappel impossible. Réessaie.', 'error');
      appLogger.warn('system', 'Activation du rappel impossible', error);
    } finally { reminderFlight.current = false; setLoadingReminder(false); setOptimisticReminder(null); }
  };

  const diffDays = getCalendarDaysDiff(ep.air_date);

  let relativeStr = '';
  if (diffDays === 0) {
    relativeStr = "Aujourd'hui";
  } else if (diffDays === 1) {
    relativeStr = 'Demain';
  } else if (diffDays > 1) {
    relativeStr = `Dans ${diffDays} jours`;
  } else if (diffDays === -1) {
    relativeStr = 'Hier';
  } else {
    relativeStr = `Il y a ${Math.abs(diffDays)} jours`;
  }

  const formattedShortDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(new Date(`${ep.air_date}T12:00:00`));
  const capitalizedShortDate = formattedShortDate ? (formattedShortDate.charAt(0).toUpperCase() + formattedShortDate.slice(1)) : '';
  const fullDateLabel = capitalizedShortDate ? `${relativeStr} • ${capitalizedShortDate}` : relativeStr;

  const sNum = (ep.season_number ?? 1).toString().padStart(2, '0');
  const eNum = (ep.episode_number ?? 1).toString().padStart(2, '0');
  const epTitle = ep.name && ep.name.trim() !== '' ? ep.name : `Épisode ${ep.episode_number}`;

  const poster = show.posterPath || show.backdropPath;
  const imgSrc = poster
    ? (poster.startsWith('http') ? poster : `https://image.tmdb.org/t/p/w300${poster}`)
    : null;

  const { cardRef, providerLogo, providerName } = usePassiveWatchProvider({
    tmdbId: show.tmdbId,
    mediaType: show.mediaType === 'movie' ? 'movie' : 'tv',
    title: show.title,
    originalTitle: show.originalTitle,
    year: show.firstAirDate?.slice(0, 4),
    retainInLibraryCache: !compact,
    onEnrich: show.mediaType === 'movie' && !compact ? () => setVisible(true) : undefined,
  });

  const networkLogo = getFormattedProviderLogo(providerLogo, providerName);

  const movie = show.mediaType === 'movie';
  const collectionProgress = movie ? buildMovieCollectionProgress(collection, show.tmdbId, shows, getTodayStr()) : undefined;
  if (compact) return <div ref={cardRef} className="actor-upcoming">
    <button type="button" className="actor-upcoming__media" onClick={() => onShowClick?.(show.id, show.mediaType)}>
      {imgSrc && <img src={imgSrc} alt="" loading="lazy" />}<span><strong>{show.title}</strong><small>{providerName?.startsWith('Plex') ? 'Plex' : providerName || (movie ? 'Au cinéma' : 'Série')} · {capitalizedShortDate}{networkLogo && <img src={networkLogo} alt={providerName || 'Diffuseur'} />}</small></span>
    </button>
    <button type="button" className={`actor-upcoming__reminder${displayedReminder ? ' is-set' : ''}`} aria-label={`${displayedReminder ? 'Désactiver' : 'Activer'} le rappel pour ${show.title}`} aria-pressed={displayedReminder} aria-busy={loadingReminder || undefined} disabled={loadingReminder} onClick={toggleReminder}>{diffDays === 0 ? 'auj.' : diffDays > 0 ? `J−${diffDays}` : 'Sorti'}<Bell size={12} fill={displayedReminder ? 'currentColor' : 'none'} /></button>
  </div>;
  return <div ref={cardRef} className="series-8f-host">
    <SeriesEpisodeCard show={{ ...show, backdropPath: ep.still_path || show.backdropPath }} episode={movie ? null : ep}
      context={{ kind: 'upcoming', days: diffDays, reminder: displayedReminder, pending: loadingReminder, onToggleReminder: toggleReminder }}
      detail={movie ? undefined : capitalizedShortDate}
      presentation={movie ? { code: 'Film · salle', subtitle: capitalizedShortDate, progress: collectionProgress || { label: 'Sortie', description: 'Date de sortie du film', continuous: false, totalUnknown: false, unknownTail: false, knownEpisodes: 0, availableUnseen: 0, segments: [] } } : undefined}
      providerLogo={networkLogo} providerName={providerName}
      onOpen={() => { if (!movie) onEpisodeClick(show, ep.season_number, ep.episode_number); else onShowClick?.(show.id, 'movie'); }}
      onOpenEpisode={movie ? undefined : () => onEpisodeClick(show, ep.season_number, ep.episode_number)} actions={actions} />
  </div>;
}
