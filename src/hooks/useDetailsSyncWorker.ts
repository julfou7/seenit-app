import { useEffect, useRef } from 'react';
import { db, auth } from '../lib/firebase';
import { doc, updateDoc, getDoc, getDocs, collection, addDoc } from 'firebase/firestore';
import { tmdb } from '../features/shows/tmdb';
import { getNextEpisodeNumber, computeAutoArchiveStatus, getTodayStr } from '../lib/utils';
import { useSyncStore } from '../store/syncStore';
import { useShowsStore } from '../store/showsStore';
import { performPlexSync } from '../features/plex/syncPlex';

export async function performDetailsSync(forceAll = false): Promise<{ success: boolean; syncedCount: number; error?: string }> {
  const setSyncStatus = useSyncStore.getState().setSyncStatus;
  const setQuotaExceeded = useSyncStore.getState().setQuotaExceeded;

  if (forceAll) {
    useSyncStore.getState().resetQuotaError();
  }

  const isQuotaExceeded = useSyncStore.getState().isQuotaExceeded;
  if (isQuotaExceeded) {
    setSyncStatus(null);
    return { success: false, syncedCount: 0, error: 'Quota Firestore dépassé' };
  }

  const user = auth.currentUser;
  if (!user) {
    setSyncStatus(null);
    return { success: false, syncedCount: 0, error: 'Utilisateur non connecté' };
  }

  const userUid = user.uid;
  let changesMade = false;
  let syncedCount = 0;

  try {
    // Fetch shows ONCE for sync purposes instead of depending on the live store
    const showsSnap = await getDocs(collection(db, 'users', userUid, 'shows'));
    if (showsSnap.empty) {
      setSyncStatus(null);
      return { success: true, syncedCount: 0 };
    }

    const shows = showsSnap.docs.map(doc => ({ ...doc.data(), id: String(doc.id) } as any));

    // 0. MASS UPDATE PASS: Auto-archive or unarchive existing TV shows
    for (const s of shows) {
      if (s.mediaType !== 'tv') continue;
      const computedArchived = computeAutoArchiveStatus(s);
      if (s.isArchived !== computedArchived) {
        console.log(`[SyncWorker] Mass updating archive status for "${s.title}": isArchived = ${computedArchived}`);
        try {
          await updateDoc(doc(db, 'users', userUid, 'shows', String(s.id)), {
            isArchived: computedArchived,
            updatedAt: Date.now()
          });
          s.isArchived = computedArchived;
          changesMade = true;
        } catch (err) {
          console.error(`[SyncWorker] Error mass updating ${s.title}:`, err);
        }
      }
    }

    const tvShowsToSync = shows.filter(s => {
      if (s.mediaType !== 'tv') return false;

      // Ne pas resynchroniser les séries abandonnées
      if (s.status === 'dropped') return false;

      if (forceAll) {
        // En synchronisation forcée (ex: pull-to-refresh), on prend toutes les séries TV
        return true;
      }

      // En mode automatique, pas les séries archivées, terminées ou avec statut finalisé
      if (s.isArchived || s.seriesEnded || s.tmdbStatus === 'Ended' || s.tmdbStatus === 'Canceled' || s.status === 'completed') {
        return false;
      }

      const now = Date.now();

      // RÈGLE D'OR DU AIR_DATE : vérification stricte avant tout appel API
      const airDates = [
        s.nextEpisodeToWatch?.air_date,
        s.nextEpisodeToAir?.air_date
      ].filter(Boolean);

      if (airDates.length > 0) {
        // Si TOUTES les dates de diffusion connues pour le prochain épisode sont dans le futur (air_date > now) :
        // ANNULER L'APPEL API, on sait déjà qu'il n'y a rien de nouveau.
        const hasFutureReleaseOnly = airDates.every(airDateStr => {
          const airMs = new Date(airDateStr).getTime();
          return !isNaN(airMs) && airMs > now;
        });

        if (hasFutureReleaseOnly) {
          return false;
        }

        // Si la date de diffusion est passée ou correspond à aujourd'hui (air_date <= now) :
        // On AUTORISE l'appel API uniquement si on n'a pas encore resynchronisé depuis cette date de diffusion.
        const hasAiredNotSynced = airDates.some(airDateStr => {
          const airMs = new Date(airDateStr).getTime();
          return !isNaN(airMs) && airMs <= now && (!s.lastSyncedAt || s.lastSyncedAt < airMs);
        });

        if (hasAiredNotSynced) {
          return true;
        }

        // Déjà resynchronisé après la diffusion de l'épisode, inutile d'appeler l'API
        return false;
      }

      // Si pas de date de prochain épisode (série en pause / TBA) ou pas encore initialement synchro
      // On fait un check de sécurité tous les 7 jours maximum
      const lastSyncDate = s.lastSyncedAt || 0;
      const daysSinceLastSync = (now - lastSyncDate) / (1000 * 3600 * 24);

      if (!s.isSynced || daysSinceLastSync >= 7) {
        return true;
      }

      return false;
    });

    if (tvShowsToSync.length === 0) {
      setSyncStatus(null);
      if (changesMade) {
        useShowsStore.getState().fetchShows();
      }
      return { success: true, syncedCount: 0 };
    }

    const totalTvShows = tvShowsToSync.length;

    for (let i = 0; i < tvShowsToSync.length; i++) {
      const showToSync = tvShowsToSync[i];
      const showId = showToSync.id;

      const currentQuotaExceeded = useSyncStore.getState().isQuotaExceeded;
      if (currentQuotaExceeded) {
         setSyncStatus(null);
         break;
      }

      setSyncStatus({
        current: showToSync.title,
        total: totalTvShows,
        pending: tvShowsToSync.length - i
      });

      const tmdbIdNum = Number(showToSync.tmdbId || showToSync.tmdb_id);
      console.log(`[SyncWorker] Starting sync for TV show: ${showToSync.title} (ID: ${showId}, TMDB: ${tmdbIdNum})`);

      if (!tmdbIdNum || isNaN(tmdbIdNum)) {
        console.warn(`[SyncWorker] Missing valid tmdbId for ${showToSync.title}`);
        continue;
      }

      try {
        // 1. Fetch main TV show details from TMDB
        const detailsRes = await tmdb.getMediaDetails(tmdbIdNum, showToSync.mediaType || 'tv');
        if (!detailsRes.ok) {
          const errMsg = 'error' in detailsRes ? (typeof detailsRes.error === 'object' && detailsRes.error !== null && 'message' in detailsRes.error ? (detailsRes.error as any).message : String(detailsRes.error)) : 'Unknown error';
          console.warn(`[SyncWorker] Could not fetch details for ${showToSync.title}: ${errMsg}`);
          continue;
        }

        const details = detailsRes.value;
        const seasons = (details.seasons || []).filter((s: any) => s.season_number > 0);

        // 2. Fetch details for each season to populate the episodes list
        const seasonsCache: any[] = [];
        for (const season of seasons) {
          await new Promise(resolve => setTimeout(resolve, 200));
          const seasonDetailsRes = await tmdb.getSeasonDetails(tmdbIdNum, season.season_number);
          if (seasonDetailsRes.ok) {
            seasonsCache.push({
              ...seasonDetailsRes.value,
              episode_count: season.episode_count || seasonDetailsRes.value.episodes?.length || 0
            });
          } else {
            console.warn(`[SyncWorker] Could not fetch episodes for Season ${season.season_number} of ${showToSync.title}`);
            seasonsCache.push({
              season_number: season.season_number,
              episode_count: season.episode_count || 0,
              air_date: season.air_date || '',
              episodes: []
            });
          }
        }

        seasonsCache.sort((a, b) => a.season_number - b.season_number);

        const nextEp = getNextEpisodeNumber(seasonsCache, showToSync.seenEpisodes || []);
        const isEnded = details.status === 'Ended' || details.status === 'Canceled';
        const lastSeasonNum = Math.max(...seasonsCache.map(s => s.season_number), 0);
        const isFinalSeason = (sNum: number) => (sNum === lastSeasonNum) && (isEnded && (lastSeasonNum > 1 || details.type === 'Miniseries'));

        const todayStr = getTodayStr();
        const seasonForNextEp = nextEp ? seasonsCache.find(s => s.season_number === nextEp.season) : null;
        let airedEpisodesInSeason = seasonForNextEp?.episode_count || 1;
        if (seasonForNextEp?.episodes && seasonForNextEp.episodes.length > 0) {
          airedEpisodesInSeason = seasonForNextEp.episodes.filter((ep: any) => ep.air_date && ep.air_date <= todayStr).length;
        }
        if (details.next_episode_to_air && details.next_episode_to_air.season_number === nextEp?.season && typeof details.next_episode_to_air.episode_number === 'number') {
          if (details.next_episode_to_air.air_date && details.next_episode_to_air.air_date > todayStr) {
            const airedBeforeNextToAir = Math.max(0, details.next_episode_to_air.episode_number - 1);
            airedEpisodesInSeason = Math.min(airedEpisodesInSeason, airedBeforeNextToAir);
          }
        }

        const nextEpisodeToWatch = nextEp ? {
          season_number: nextEp.season,
          episode_number: nextEp.episode,
          air_date: nextEp.episodeData?.air_date || null,
          name: nextEp.episodeData?.name || null,
          still_path: nextEp.episodeData?.still_path || null,
          episode_count: seasonForNextEp?.episode_count || 1,
          aired_episodes_in_season: airedEpisodesInSeason,
          is_final_season: isFinalSeason(nextEp.season),
          series_ended: isEnded
        } : null;

        let nextEpisodeToAir: any = null;
        if (details.next_episode_to_air && (!details.next_episode_to_air.air_date || details.next_episode_to_air.air_date >= todayStr)) {
          const sNum = details.next_episode_to_air.season_number;
          nextEpisodeToAir = {
            season_number: sNum,
            episode_number: details.next_episode_to_air.episode_number,
            air_date: details.next_episode_to_air.air_date,
            name: details.next_episode_to_air.name,
            still_path: details.next_episode_to_air.still_path || null,
            episode_count: seasonsCache.find(s => s.season_number === sNum)?.episode_count || 1,
            is_final_season: isFinalSeason(sNum),
            series_ended: isEnded
          };
        } else {
          const futureEpisodes: any[] = [];
          for (const s of seasonsCache) {
            for (const ep of s.episodes || []) {
              if (ep.air_date && ep.air_date >= todayStr) {
                futureEpisodes.push({
                  season_number: s.season_number,
                  episode_number: ep.episode_number,
                  air_date: ep.air_date,
                  name: ep.name,
                  still_path: ep.still_path || null,
                  episode_count: s.episode_count || 1,
                  is_final_season: isFinalSeason(s.season_number),
                  series_ended: isEnded
                });
              }
            }
          }
          if (futureEpisodes.length > 0) {
            futureEpisodes.sort((a, b) => new Date(a.air_date + 'T00:00:00').getTime() - new Date(b.air_date + 'T00:00:00').getTime());
            nextEpisodeToAir = futureEpisodes[0];
          }
        }

        // 1. DÉTECTION D'ANNULATION
        if (showToSync.status !== 'Canceled' && details.status === 'Canceled') {
          try {
            await addDoc(collection(db, 'users', userUid, 'news'), {
              type: 'CANCELED',
              showId: showId,
              showTitle: showToSync.title,
              message: 'La série a été officiellement annulée.',
              createdAt: Date.now()
            });
          } catch (newsErr) {
            console.error('[SyncWorker] Error adding CANCELED news:', newsErr);
          }
        }

        // 1b. DÉTECTION DE FIN DE SÉRIE
        if (showToSync.tmdbStatus !== 'Ended' && details.status === 'Ended') {
          try {
            await addDoc(collection(db, 'users', userUid, 'news'), {
              type: 'ENDED',
              showId: showId,
              showTitle: showToSync.title,
              message: 'La série est officiellement terminée.',
              description: `La série « ${showToSync.title} » est arrivée à son terme et s'est officiellement achevée après ${details.number_of_seasons || lastSeasonNum} saisons.`,
              createdAt: Date.now()
            });
          } catch (newsErr) {
            console.error('[SyncWorker] Error adding ENDED news:', newsErr);
          }
        }

        // 2. DÉTECTION DE DATE D'EPISODE / NOUVELLE SAISON / DERNIÈRE SAISON
        if (nextEpisodeToAir && nextEpisodeToAir.air_date) {
          const hadNoAirDate = !showToSync.nextEpisodeToAir || !showToSync.nextEpisodeToAir.air_date;
          const isNewerSeason = showToSync.nextEpisodeToAir && 
            typeof showToSync.nextEpisodeToAir.season_number === 'number' && 
            nextEpisodeToAir.season_number > showToSync.nextEpisodeToAir.season_number;

          if (hadNoAirDate || isNewerSeason) {
            try {
              const isFinal = isEnded && (lastSeasonNum > 1 || details.type === 'Miniseries');
              const newsType = isFinal 
                ? 'FINAL_SEASON' 
                : (nextEpisodeToAir.episode_number === 1 ? 'NEW_SEASON' : 'DATE_ANNOUNCED');
              const msg = isFinal 
                ? `La Saison ${nextEpisodeToAir.season_number} sera la dernière de la série !`
                : `La Saison ${nextEpisodeToAir.season_number} arrive le ${nextEpisodeToAir.air_date}.`;
              const desc = isFinal 
                ? `Il a été officiellement confirmé que la Saison ${nextEpisodeToAir.season_number} sera l'ultime chapitre qui conclura « ${showToSync.title} ».`
                : undefined;

              await addDoc(collection(db, 'users', userUid, 'news'), {
                type: newsType,
                showId: showId,
                showTitle: showToSync.title,
                message: msg,
                description: desc,
                createdAt: Date.now()
              });
            } catch (newsErr) {
              console.error('[SyncWorker] Error adding DATE_ANNOUNCED/NEW_SEASON/FINAL_SEASON news:', newsErr);
            }
          }
        }

        const totalEpisodes = details.number_of_episodes || seasonsCache.reduce((sum, s) => sum + (s.episode_count || 0), 0);

        const todayStr2 = getTodayStr();
        let totalAiredEpisodes = 0;
        for (const s of seasonsCache) {
          if (s.season_number > 0) {
            for (const ep of s.episodes || []) {
              if (ep.air_date && ep.air_date <= todayStr2) {
                totalAiredEpisodes++;
              }
            }
          }
        }

        const shouldBeArchived = computeAutoArchiveStatus({
          mediaType: 'tv',
          status: showToSync.status,
          tmdbStatus: details.status,
          seriesEnded: isEnded,
          nextEpisodeToWatch,
          nextEpisodeToAir
        });

        const hasNextToWatchChanged = JSON.stringify(showToSync.nextEpisodeToWatch || null) !== JSON.stringify(nextEpisodeToWatch || null);
        const hasNextToAirChanged = JSON.stringify(showToSync.nextEpisodeToAir || null) !== JSON.stringify(nextEpisodeToAir || null);
        const hasTotalChanged = showToSync.totalEpisodes !== totalEpisodes || showToSync.totalAiredEpisodes !== totalAiredEpisodes;
        const hasSeasonsCacheToDelete = !!showToSync.seasonsCache;
        const hasArchivedChanged = showToSync.isArchived !== shouldBeArchived;
        const hasSeriesEndedChanged = showToSync.seriesEnded !== isEnded;
        const hasTmdbStatusChanged = showToSync.tmdbStatus !== (details.status || null);

        const docRef = doc(db, 'users', userUid, 'shows', showId);

        if (!hasNextToWatchChanged && !hasNextToAirChanged && !hasTotalChanged && !hasSeasonsCacheToDelete && !hasArchivedChanged && !hasSeriesEndedChanged && !hasTmdbStatusChanged) {
           console.log(`[SyncWorker] No major changes for ${showToSync.title}, saving sync markers to Firestore.`);
           
           await updateDoc(docRef, { 
             isSynced: true, 
             lastSyncedAt: Date.now(),
             seriesEnded: isEnded,
             tmdbStatus: details.status || null,
             isArchived: shouldBeArchived
           });
           changesMade = true;
           syncedCount++;
           
           await new Promise(resolve => setTimeout(resolve, 500));
           continue;
        }

        const updatePayload: any = {
          nextEpisodeToWatch: nextEpisodeToWatch || null,
          nextEpisodeToAir: nextEpisodeToAir || null,
          totalEpisodes: totalEpisodes,
          totalAiredEpisodes: totalAiredEpisodes,
          networks: details.networks || null,
          detailsSyncedAt: Date.now(),
          isSynced: true,
          lastSyncedAt: Date.now(),
          updatedAt: Date.now(),
          seriesEnded: isEnded,
          tmdbStatus: details.status || null,
          isArchived: shouldBeArchived
        };
        
        if (details.status === 'Canceled' || details.status === 'Ended') {
          updatePayload.status = details.status;
        }
        
        updatePayload['seasonsCache'] = null; 

        await updateDoc(docRef, updatePayload);
        changesMade = true;
        syncedCount++;

        console.log(`[SyncWorker] Successfully synced details for ${showToSync.title}`);
        
        // Add a delay between shows to not hammer TMDB/Firestore
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (err: any) {
        console.error(`[SyncWorker] Error syncing details for ${showToSync.title}:`, err);
        const errStr = err?.message || String(err);
        const isQuotaError = 
          err?.code === 'resource-exhausted' || 
          errStr.toLowerCase().includes('quota exceeded') || 
          errStr.toLowerCase().includes('quota-exceeded') ||
          errStr.toLowerCase().includes('resource-exhausted') ||
          errStr.toLowerCase().includes('resource_exhausted');

        if (isQuotaError) {
          console.warn("[SyncWorker] Firestore quota exhausted. Stopping synchronizer.");
          setQuotaExceeded(true);
          setSyncStatus(null);
          break;
        }
      }
    }
    
    setSyncStatus(null);
    if (changesMade) {
      useShowsStore.getState().fetchShows();
    }
    return { success: true, syncedCount };
  } catch (err: any) {
    console.error("[SyncWorker] Error fetching shows to sync:", err);
    setSyncStatus(null);
    return { success: false, syncedCount, error: err?.message || String(err) };
  }
}

export function useDetailsSyncWorker() {
  const lastRunRef = useRef<number>(0);
  const lastPlexRunRef = useRef<number>(0);

  useEffect(() => {
    const runSync = () => {
      const now = Date.now();
      // Limiter les vérifications automatiques à au moins 12 heures d'intervalle (throttle anti-spam)
      if (now - lastRunRef.current < 12 * 60 * 60 * 1000) return;
      lastRunRef.current = now;

      performDetailsSync(false);
    };

    const runPlexSync = () => {
      const now = Date.now();
      // Verifier si une synchronisation Plex a eu lieu lors des 30 dernieres minutes (persiste dans localStorage)
      const lastSyncTimestampStr = localStorage.getItem('plex_last_sync_timestamp');
      if (lastSyncTimestampStr) {
        const lastSyncTimestamp = Number(lastSyncTimestampStr);
        if (!isNaN(lastSyncTimestamp) && now - lastSyncTimestamp < 30 * 60 * 1000) {
          return;
        }
      }

      if (now - lastPlexRunRef.current < 15 * 60 * 1000) return;
      lastPlexRunRef.current = now;

      const hasPlexToken = localStorage.getItem('plex_auth_token') || localStorage.getItem('plex_token');
      if (auth.currentUser && hasPlexToken) {
        performPlexSync({ delta: true, silent: false }).catch(console.error);
      }
    };

    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (!user) return;
      runSync();
      runPlexSync();
    });

    const handleFocus = () => {
      if (auth.currentUser) {
        runSync();
        runPlexSync();
      }
    };

    window.addEventListener('focus', handleFocus);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && auth.currentUser) {
        runSync();
        runPlexSync();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Periodic check every 15 minutes in the background
    const plexInterval = setInterval(() => {
      const hasPlexToken = localStorage.getItem('plex_auth_token') || localStorage.getItem('plex_token');
      if (auth.currentUser && hasPlexToken) {
        runPlexSync();
      }
    }, 15 * 60 * 1000);

    return () => {
      unsubscribe();
      clearInterval(plexInterval);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);
}

export async function syncSingleItem(showId: string, silent: boolean = false): Promise<{ success: boolean; title?: string; error?: string }> {
  const setSyncStatus = useSyncStore.getState().setSyncStatus;
  const user = auth.currentUser;
  if (!user) {
    return { success: false, error: 'Utilisateur non connecté' };
  }

  const userUid = user.uid;
  try {
    const showRef = doc(db, 'users', userUid, 'shows', showId);
    const showSnap = await getDoc(showRef);
    if (!showSnap.exists()) {
      return { success: false, error: 'Élément introuvable dans votre bibliothèque' };
    }

    const showToSync = { ...showSnap.data(), id: String(showSnap.id) } as any;
    if (!silent) setSyncStatus({ current: showToSync.title || 'Mise à jour', total: 1, pending: 1 });

    const tmdbIdNum = Number(showToSync.tmdbId || showToSync.tmdb_id);
    if (!tmdbIdNum || isNaN(tmdbIdNum)) {
      if (!silent) setSyncStatus(null);
      return { success: false, error: 'Identifiant TMDB invalide' };
    }

    if (showToSync.mediaType === 'movie') {
      const detailsRes = await tmdb.getMovieDetails(tmdbIdNum);
      if (!detailsRes.ok) {
        if (!silent) setSyncStatus(null);
        return { success: false, error: 'Erreur lors de la récupération des détails TMDB' };
      }
      const details = detailsRes.value;
      await updateDoc(showRef, {
        runtime: details.runtime || showToSync.runtime || 0,
        genres: details.genres || showToSync.genres || [],
        releaseDate: details.release_date || showToSync.releaseDate || '',
        voteAverage: details.vote_average || showToSync.voteAverage || 0,
        overview: details.overview || showToSync.overview || '',
        tagline: details.tagline || showToSync.tagline || '',
        detailsSyncedAt: Date.now(),
        isSynced: true,
        lastSyncedAt: Date.now(),
        updatedAt: Date.now()
      });
      useShowsStore.getState().fetchShows();
      if (!silent) setSyncStatus(null);
      return { success: true, title: showToSync.title };
    }

    // TV Show Sync
    const detailsRes = await tmdb.getShowDetails(tmdbIdNum);
    if (!detailsRes.ok) {
      if (!silent) setSyncStatus(null);
      return { success: false, error: 'Erreur lors de la récupération des détails TMDB' };
    }

    const details = detailsRes.value;
    const seasons = (details.seasons || []).filter((s: any) => s.season_number > 0);

    const seasonsCache: any[] = [];
    for (const season of seasons) {
      await new Promise(resolve => setTimeout(resolve, 150));
      const seasonDetailsRes = await tmdb.getSeasonDetails(tmdbIdNum, season.season_number);
      if (seasonDetailsRes.ok) {
        seasonsCache.push({
          ...seasonDetailsRes.value,
          episode_count: season.episode_count || seasonDetailsRes.value.episodes?.length || 0
        });
      } else {
        seasonsCache.push({
          season_number: season.season_number,
          episode_count: season.episode_count || 0,
          air_date: season.air_date || '',
          episodes: []
        });
      }
    }

    seasonsCache.sort((a, b) => a.season_number - b.season_number);

    const nextEp = getNextEpisodeNumber(seasonsCache, showToSync.seenEpisodes || []);
    const isEnded = details.status === 'Ended' || details.status === 'Canceled';
    const lastSeasonNum = Math.max(...seasonsCache.map(s => s.season_number), 0);
    const isFinalSeason = (sNum: number) => (sNum === lastSeasonNum) && (isEnded && (lastSeasonNum > 1 || details.type === 'Miniseries'));

    const todayStr = getTodayStr();
    const seasonForNextEp = nextEp ? seasonsCache.find(s => s.season_number === nextEp.season) : null;
    let airedEpisodesInSeason = seasonForNextEp?.episode_count || 1;
    if (seasonForNextEp?.episodes && seasonForNextEp.episodes.length > 0) {
      airedEpisodesInSeason = seasonForNextEp.episodes.filter((ep: any) => ep.air_date && ep.air_date <= todayStr).length;
    }
    if (details.next_episode_to_air && details.next_episode_to_air.season_number === nextEp?.season && typeof details.next_episode_to_air.episode_number === 'number') {
      if (details.next_episode_to_air.air_date && details.next_episode_to_air.air_date > todayStr) {
        const airedBeforeNextToAir = Math.max(0, details.next_episode_to_air.episode_number - 1);
        airedEpisodesInSeason = Math.min(airedEpisodesInSeason, airedBeforeNextToAir);
      }
    }

    const nextEpisodeToWatch = nextEp ? {
      season_number: nextEp.season,
      episode_number: nextEp.episode,
      air_date: nextEp.episodeData?.air_date || null,
      name: nextEp.episodeData?.name || null,
      still_path: nextEp.episodeData?.still_path || null,
      episode_count: seasonForNextEp?.episode_count || 1,
      aired_episodes_in_season: airedEpisodesInSeason,
      is_final_season: isFinalSeason(nextEp.season),
      series_ended: isEnded
    } : null;

    let nextEpisodeToAir: any = null;
    if (details.next_episode_to_air && (!details.next_episode_to_air.air_date || details.next_episode_to_air.air_date >= todayStr)) {
      const sNum = details.next_episode_to_air.season_number;
      nextEpisodeToAir = {
        season_number: sNum,
        episode_number: details.next_episode_to_air.episode_number,
        air_date: details.next_episode_to_air.air_date,
        name: details.next_episode_to_air.name,
        still_path: details.next_episode_to_air.still_path || null,
        episode_count: seasonsCache.find(s => s.season_number === sNum)?.episode_count || 1,
        is_final_season: isFinalSeason(sNum),
        series_ended: isEnded
      };
    } else {
      const futureEpisodes: any[] = [];
      for (const s of seasonsCache) {
        for (const ep of s.episodes || []) {
          if (ep.air_date && ep.air_date >= todayStr) {
            futureEpisodes.push({
              season_number: s.season_number,
              episode_number: ep.episode_number,
              air_date: ep.air_date,
              name: ep.name,
              still_path: ep.still_path || null,
              episode_count: s.episode_count || 1,
              is_final_season: isFinalSeason(s.season_number),
              series_ended: isEnded
            });
          }
        }
      }
      if (futureEpisodes.length > 0) {
        futureEpisodes.sort((a, b) => new Date(a.air_date + 'T00:00:00').getTime() - new Date(b.air_date + 'T00:00:00').getTime());
        nextEpisodeToAir = futureEpisodes[0];
      }
    }

    const totalEpisodes = details.number_of_episodes || seasonsCache.reduce((sum, s) => sum + (s.episode_count || 0), 0);

    const todayStr2 = getTodayStr();
    let totalAiredEpisodes = 0;
    for (const s of seasonsCache) {
      if (s.season_number > 0) {
        for (const ep of s.episodes || []) {
          if (ep.air_date && ep.air_date <= todayStr2) {
            totalAiredEpisodes++;
          }
        }
      }
    }

    const shouldBeArchived = computeAutoArchiveStatus({
      mediaType: 'tv',
      status: showToSync.status,
      tmdbStatus: details.status,
      seriesEnded: isEnded,
      nextEpisodeToWatch,
      nextEpisodeToAir
    });

    const updatePayload: any = {
      nextEpisodeToWatch: nextEpisodeToWatch || null,
      nextEpisodeToAir: nextEpisodeToAir || null,
      totalEpisodes: totalEpisodes,
      totalAiredEpisodes: totalAiredEpisodes,
      networks: details.networks || null,
      detailsSyncedAt: Date.now(),
      isSynced: true,
      lastSyncedAt: Date.now(),
      updatedAt: Date.now(),
      seriesEnded: isEnded,
      tmdbStatus: details.status || null,
      isArchived: shouldBeArchived
    };

    if (details.status === 'Canceled' || details.status === 'Ended') {
      updatePayload.status = details.status;
    }
    updatePayload['seasonsCache'] = null;

    await updateDoc(showRef, updatePayload);
    useShowsStore.getState().fetchShows();
    if (!silent) setSyncStatus(null);
    return { success: true, title: showToSync.title };
  } catch (err: any) {
    console.error(`[SyncWorker] Error syncing single item ${showId}:`, err);
    if (!silent) setSyncStatus(null);
    return { success: false, error: err?.message || String(err) };
  }
}

