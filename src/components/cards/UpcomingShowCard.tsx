import React, { useState, useEffect } from 'react';
import { Calendar, Bell } from 'lucide-react';
import { type Show } from '../../types';
import { requestNotificationPermission, auth, db, sendNativeNotification } from '../../lib/firebase';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { useToastStore } from '../../store/toastStore';
import { useShows } from '../../hooks/useShows';
import { cn, getTodayStr, getCalendarDaysDiff, formatAirDateSafe, getEpisodeRelativeAirDate } from '../../lib/utils';
import { tmdb } from '../../features/shows/tmdb';
import { getFormattedProviderLogo, extractOfficialStreamingProvider, PLEX_LOGO_SVG } from '../../utils/providerLogos';
import { checkPlexAvailability } from '../../features/plex/plexAvailability';
import { readUserScopedJson, removeUserScopedValue, writeUserScopedJson } from '../../lib/userIsolation';

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
}

export const UpcomingShowCard = React.memo(function UpcomingShowCard({ show, onShowClick, onEpisodeClick }: Props) {
  const ep = getUpcomingEpisodeInfo(show);
  if (!ep) return null;

  const storageField = `reminder_${show.id}_S${ep.season_number}E${ep.episode_number}`;
  const [isReminderSet, setIsReminderSet] = useState<boolean>(() => {
    if (show.notificationsEnabled) return true;
    return readUserScopedJson(auth.currentUser?.uid, storageField, false);
  });
  const [loadingReminder, setLoadingReminder] = useState(false);
  const { showToast } = useToastStore();
  const { updateShow } = useShows();

  const toggleReminder = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (loadingReminder) return;

    const nextState = !isReminderSet;
    const sNumStr = String(ep.season_number).padStart(2, '0');
    const eNumStr = String(ep.episode_number).padStart(2, '0');
    const episodeString = `S${sNumStr}E${eNumStr}`;
    const reminderId = `${show.id}_${episodeString}`;

    if (nextState) {
      setLoadingReminder(true);
      let fcmToken: string | null = null;
      try {
        fcmToken = await requestNotificationPermission();
      } catch (err) {
        console.warn("FCM / Notification token request warning:", err);
      }

      setIsReminderSet(true);
      writeUserScopedJson(auth.currentUser?.uid, storageField, true);

      if (show.id && !show.notificationsEnabled) { updateShow(show.id, { notificationsEnabled: true }); }
      showToast(`« ${show.title} » S${sNumStr}E${eNumStr} • Rappel activé`, 'reminder', show);

      try {
        const epStill = ep.still_path || show.nextEpisodeToAir?.still_path || show.nextEpisodeToWatch?.still_path;
        const posterUrl = show.posterPath
          ? (show.posterPath.startsWith('http') ? show.posterPath : `https://image.tmdb.org/t/p/w185${show.posterPath}`)
          : 'https://seenit.app/icon-192.png';
        const backdropUrl = epStill
          ? (epStill.startsWith('http') ? epStill : `https://image.tmdb.org/t/p/w780${epStill}`)
          : (show.backdropPath
              ? (show.backdropPath.startsWith('http') ? show.backdropPath : `https://image.tmdb.org/t/p/w780${show.backdropPath}`)
              : posterUrl);

        sendNativeNotification(`🔔 Rappel programmé : ${show.title}`, {
          body: `Rappel enregistré pour l'épisode S${sNumStr}E${eNumStr} (${ep.name || 'Prochainement'})`,
          icon: posterUrl,
          image: backdropUrl,
          data: {
            showId: show.id,
            tmdbId: show.tmdbId,
            mediaType: show.mediaType || 'tv',
            season: ep.season_number,
            episode: ep.episode_number
          }
        } as any);
      } catch (err) {
        console.warn("sendNativeNotification failed:", err);
      }

      try {
        const user = auth.currentUser;
        if (user) {
          const reminderRef = doc(db, 'users', user.uid, 'reminders', reminderId);
          await setDoc(reminderRef, {
            showId: show.id,
            showTitle: show.title,
            episodeString,
            seasonNumber: ep.season_number,
            episodeNumber: ep.episode_number,
            episodeTitle: ep.name || '',
            air_date: ep.air_date,
            fcmToken: fcmToken || '',
            createdAt: Date.now()
          });
        }
      } catch (err) {
        console.error("Error setting reminder in Firestore:", err);
      } finally {
        setLoadingReminder(false);
      }
    } else {
      setLoadingReminder(true);
      setIsReminderSet(false);
      removeUserScopedValue(auth.currentUser?.uid, storageField);

      if (show.id && show.notificationsEnabled) { updateShow(show.id, { notificationsEnabled: false }); }
      showToast(`« ${show.title} » S${sNumStr}E${eNumStr} • Rappel désactivé`, 'reminder', show);

      try {
        const user = auth.currentUser;
        if (user) {
          const reminderRef = doc(db, 'users', user.uid, 'reminders', reminderId);
          await deleteDoc(reminderRef);
        }
      } catch (err) {
        console.error("Error deleting reminder:", err);
      } finally {
        setLoadingReminder(false);
      }
    }
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

  const formattedShortDate = formatAirDateSafe(ep.air_date, 'short');
  const capitalizedShortDate = formattedShortDate ? (formattedShortDate.charAt(0).toUpperCase() + formattedShortDate.slice(1)) : '';
  const fullDateLabel = capitalizedShortDate ? `${relativeStr} • ${capitalizedShortDate}` : relativeStr;

  const sNum = (ep.season_number ?? 1).toString().padStart(2, '0');
  const eNum = (ep.episode_number ?? 1).toString().padStart(2, '0');
  const epTitle = ep.name && ep.name.trim() !== '' ? ep.name : `Épisode ${ep.episode_number}`;

  const poster = show.posterPath || show.backdropPath;
  const imgSrc = poster 
    ? (poster.startsWith('http') ? poster : `https://image.tmdb.org/t/p/w300${poster}`)
    : null;

  const [providerLogo, setProviderLogo] = useState<string | null>(null);
  const [providerName, setProviderName] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    if (show.tmdbId) {
      tmdb.getWatchProviders(show.tmdbId, show.mediaType === 'movie' ? 'movie' : 'tv').then(res => {
        if (!isMounted) return;
        let officialFound = false;
        if (res.ok && res.value?.results) {
          const stream = extractOfficialStreamingProvider(res.value.results);
          if (stream) {
            setProviderLogo(stream.logo_path);
            setProviderName(stream.provider_name);
            officialFound = true;
          }
        }

        if (!officialFound && !show.networks?.length) {
          checkPlexAvailability({
            tmdbId: show.tmdbId,
            title: show.title,
            originalTitle: (show as any).originalTitle || (show as any).original_title,
            year: show.firstAirDate?.slice(0, 4),
            mediaType: show.mediaType === 'movie' ? 'movie' : 'tv'
          }).then(plexInfo => {
            if (isMounted && plexInfo.available) {
              setProviderLogo(PLEX_LOGO_SVG);
              setProviderName(plexInfo.serverName ? `Plex (${plexInfo.serverName})` : 'Plex');
            }
          }).catch(() => {});
        }
      }).catch(() => {});
    }
    return () => { isMounted = false; };
  }, [show.mediaType, show.tmdbId, show.title]);

  const networkLogo = getFormattedProviderLogo(
    providerLogo || (show.networks && show.networks.length > 0 ? show.networks[0].logo_path : null),
    providerName || (show.networks && show.networks.length > 0 ? show.networks[0].name : (show as any).network || (show as any).platform)
  );

  return (
    <div 
      onClick={() => {
        if (show.mediaType === 'movie') {
          if (onShowClick && show.id) onShowClick(show.id, 'movie');
        } else {
          onEpisodeClick(show, ep.season_number, ep.episode_number);
        }
      }}
      className="w-full flex items-stretch justify-between gap-3 bg-zinc-900/60 hover:bg-zinc-900/80 rounded-2xl overflow-hidden relative isolate transition-all active:scale-[0.98] cursor-pointer group shadow-xl"
    >
      {/* OVERLAY PREMIUM : Bordure interne parfaite + Effet lumière */}
      <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/10 group-hover:ring-white/20 shadow-[inset_0_1px_1px_rgba(255,255,255,0.12)] transition-all z-20" />
      <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br from-white/[0.04] to-transparent opacity-0 group-hover:opacity-100 transition-opacity z-10" />

      {networkLogo && (
        <div className="absolute top-0 right-0 z-30 bg-white/95 backdrop-blur-md w-7 h-7 rounded-bl-xl flex items-center justify-center shrink-0 p-1 shadow-sm pointer-events-none">
          <img src={networkLogo} alt="" className="w-5 h-5 object-contain rounded-[3px]" />
        </div>
      )}

      {/* Poster */}
      <div className="w-[60px] sm:w-[70px] shrink-0 bg-zinc-950 rounded-l-2xl overflow-hidden flex items-center justify-center relative z-20">
        {imgSrc ? (
          <img loading="lazy" decoding="async" 
            src={imgSrc}
            alt={show.title}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-[10px] text-zinc-600 p-1 text-center font-bold">{show.title}</div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 py-3 px-0.5 flex flex-col justify-center relative z-20">
        <div className={cn("flex items-center gap-2 min-w-0", networkLogo ? "pr-10" : "pr-1")}>
          <button 
            className="text-[#E5A93D] font-extrabold text-xs sm:text-[13px] uppercase tracking-wider line-clamp-2 text-left hover:underline leading-tight"
            onClick={(e) => {
              e.stopPropagation();
              if (onShowClick && show.id) {
                onShowClick(show.id, show.mediaType);
              }
            }}
          >
            {show.title}
          </button>
        </div>
        {show.mediaType === 'movie' ? (
          <p className="text-indigo-400 font-medium text-xs line-clamp-1 leading-snug my-0.5">
            Sortie cinéma / streaming
          </p>
        ) : (
          <p className="text-white font-bold text-sm line-clamp-1 leading-snug my-0.5">
            S{sNum} | E{eNum} • {epTitle}
          </p>
        )}
        <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
          <div className="text-emerald-400 text-xs font-semibold flex items-center gap-1 truncate">
            <Calendar size={12} className="shrink-0" />
            <span className="truncate">{fullDateLabel}</span>
          </div>
        </div>
      </div>

      {/* Bell Reminder Button */}
      <div className={cn("pr-3.5 flex items-center justify-center shrink-0 relative z-20", networkLogo && "pt-3.5")}>
        <button 
          onClick={toggleReminder}
          className={cn(
            "w-9 h-9 rounded-full border flex items-center justify-center transition-all shrink-0",
            isReminderSet 
              ? "border-[#E5A93D] bg-[#E5A93D]/20 text-[#E5A93D] shadow-lg shadow-[#E5A93D]/20" 
              : "border-white/20 bg-white/5 hover:bg-white/10 hover:border-white/40 text-zinc-400 hover:text-white"
          )}
          title={isReminderSet ? "Rappel activé" : "Programmer un rappel"}
        >
          <Bell 
            size={18} 
            className={cn("transition-transform", isReminderSet && "fill-[#E5A93D]")} 
            strokeWidth={isReminderSet ? 2 : 1.75} 
          />
        </button>
      </div>
    </div>
  );
});

