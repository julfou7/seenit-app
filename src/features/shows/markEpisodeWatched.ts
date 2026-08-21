import { useShowsStore } from '../../store/showsStore';
import { tmdb } from './tmdb';
import { useToastStore } from '../../store/toastStore';
import { useLogStore } from '../../store/logStore';
import { scrollAllCarouselsToStart } from '../../lib/utils';
import { type Show } from '../../types';
import { db, auth } from '../../lib/firebase';
import { doc, updateDoc, arrayUnion } from 'firebase/firestore';

export async function markEpisodeWatched(
  showOrId: Show | string | number,
  season: number,
  episode: number,
  updateShowFn?: (id: string, updates: Partial<Show>) => Promise<void>
) {
  let targetShow: Show | undefined;
  if (typeof showOrId === 'object' && showOrId !== null) {
    targetShow = useShowsStore.getState().shows.find(s => s.id === showOrId.id) || showOrId;
  } else {
    const showIdStr = String(showOrId);
    targetShow = useShowsStore.getState().shows.find(
      s => String(s.id) === showIdStr || String(s.tmdbId) === showIdStr
    );
  }

  if (!targetShow || !targetShow.id) {
    console.warn(`[markEpisodeWatched] Show not found: ${typeof showOrId === 'object' ? showOrId?.id : showOrId}`);
    return;
  }

  const sNum = Number(season);
  const eNum = Number(episode);
  if (isNaN(sNum) || isNaN(eNum)) return;

  const epKey = `${sNum}x${eNum}`;
  const sNumStr = String(sNum).padStart(2, '0');
  const eNumStr = String(eNum).padStart(2, '0');

  // Sauvegarde de l'état précédent pour l'annulation (undo)
  const prevSeenEpisodes = targetShow.seenEpisodes || [];
  const prevEpisodeRecords = targetShow.episodeRecords || {};
  const prevLastWatchedAt = targetShow.lastWatchedAt || null;
  const prevNextEpisodeToWatch = targetShow.nextEpisodeToWatch || null;
  const prevStatus = targetShow.status;

  const newSeenSet = new Set(prevSeenEpisodes);
  newSeenSet.add(epKey);
  const newSeenArray = Array.from(newSeenSet);

  // Recherche du titre de l'épisode et du prochain épisode via TMDB
  let fetchedEpTitle: string | null = null;
  let optimisticNextEp: any = null;
  const totalEps = targetShow.totalAiredEpisodes || targetShow.totalEpisodes || 0;

  if (targetShow.tmdbId) {
    try {
      const seasonRes = await tmdb.getSeasonDetails(targetShow.tmdbId, sNum);
      if (seasonRes.ok && seasonRes.value?.episodes) {
        const curEp = seasonRes.value.episodes.find((x: any) => x.episode_number === eNum);
        if (curEp && curEp.name) {
          fetchedEpTitle = curEp.name;
        }

        if (totalEps > 0 && newSeenArray.length >= totalEps) {
          optimisticNextEp = null;
        } else {
          // Trouver le premier épisode non vu de la saison
          const nextInSeason = seasonRes.value.episodes.find((x: any) => x.episode_number > eNum && !newSeenSet.has(`${sNum}x${x.episode_number}`));
          if (nextInSeason) {
            optimisticNextEp = {
              season_number: nextInSeason.season_number,
              episode_number: nextInSeason.episode_number,
              air_date: nextInSeason.air_date || null,
              name: nextInSeason.name || null,
              still_path: nextInSeason.still_path || null,
              episode_count: seasonRes.value.episodes?.length || targetShow.nextEpisodeToWatch?.episode_count || 1,
              aired_episodes_in_season: targetShow.nextEpisodeToWatch?.aired_episodes_in_season,
              is_final_season: targetShow.nextEpisodeToWatch?.is_final_season,
              series_ended: targetShow.nextEpisodeToWatch?.series_ended || targetShow.seriesEnded
            };
          } else {
            const nextSeasonRes = await tmdb.getSeasonDetails(targetShow.tmdbId, sNum + 1);
            if (nextSeasonRes.ok && nextSeasonRes.value?.episodes) {
              const nextSeasonUnseen = nextSeasonRes.value.episodes.find((x: any) => !newSeenSet.has(`${sNum + 1}x${x.episode_number}`));
              if (nextSeasonUnseen) {
                optimisticNextEp = {
                  season_number: nextSeasonUnseen.season_number,
                  episode_number: nextSeasonUnseen.episode_number,
                  air_date: nextSeasonUnseen.air_date || null,
                  name: nextSeasonUnseen.name || null,
                  still_path: nextSeasonUnseen.still_path || null,
                  episode_count: nextSeasonRes.value.episodes?.length || 1,
                  aired_episodes_in_season: nextSeasonRes.value.episodes?.filter((ep: any) => ep.air_date && ep.air_date <= new Date().toISOString().slice(0, 10)).length || 1,
                  is_final_season: targetShow.nextEpisodeToWatch?.is_final_season,
                  series_ended: targetShow.nextEpisodeToWatch?.series_ended || targetShow.seriesEnded
                };
              }
            }
          }
        }
      }
    } catch (e) {
      console.error('[markEpisodeWatched] TMDB fetch error:', e);
    }
  }

  // Fallback si TMDB n'a pas répondu ou est indisponible
  if (!optimisticNextEp && (totalEps === 0 || newSeenArray.length < totalEps)) {
    let checkEp = eNum + 1;
    while (newSeenSet.has(`${sNum}x${checkEp}`) && checkEp <= 100) {
      checkEp++;
    }
    optimisticNextEp = { season_number: sNum, episode_number: checkEp };
  }

  const episodeTitle = fetchedEpTitle || optimisticNextEp?.name || null;

  // 1. Mise à jour optimiste dans le store local Zustand pour réactivité instantanée UI
  const localUpdates: Partial<Show> = {
    seenEpisodes: newSeenArray,
    episodeRecords: {
      ...prevEpisodeRecords,
      [epKey]: {
        watchedAt: Date.now(),
        episodeTitle
      }
    },
    lastWatchedAt: Date.now(),
    nextEpisodeToWatch: optimisticNextEp,
    status: targetShow.status === 'plan_to_watch' ? 'watching' : targetShow.status,
    updatedAt: Date.now(),
    isSynced: false
  };

  useShowsStore.getState().updateShowOptimistic(targetShow.id, localUpdates);

  // 2. Envoi strict et ciblé à Firestore avec la VRAIE notation pointée (dot-notation)
  const user = auth.currentUser;
  if (user && targetShow.id) {
    const stringId = String(targetShow.id);
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    useLogStore.getState().addLog(`[Firestore] Début màj atomique pour ${stringId} (${targetShow.title}) - En ligne : ${isOnline}`, "info");

    try {
      const updatePayload: any = {
        seenEpisodes: arrayUnion(epKey),
        lastWatchedAt: Date.now(),
        updatedAt: Date.now(),
        isSynced: false
      };

      // C'est ICI qu'on utilise la VRAIE notation pointée de Firestore pour mettre à jour
      // UNE SEULE CLÉ dans le dictionnaire distant, SANS lire ni écraser le reste.
      updatePayload[`episodeRecords.${epKey}`] = {
        watchedAt: Date.now(),
        episodeTitle: fetchedEpTitle || optimisticNextEp?.name || null
      };

      if (optimisticNextEp !== undefined) {
        // Firebase refuse le type undefined. On assainit l'objet en remplaçant undefined par null.
        const cleanNextEp: any = { ...optimisticNextEp };
        Object.keys(cleanNextEp).forEach(key => {
          if (cleanNextEp[key] === undefined) {
            cleanNextEp[key] = null;
          }
        });
        updatePayload.nextEpisodeToWatch = cleanNextEp;
      }

      if (targetShow.status === 'plan_to_watch') {
        updatePayload.status = 'watching';
      }

      useLogStore.getState().addLog(`[Firestore] Envoi payload (${Object.keys(updatePayload).join(', ')}) pour la série ${stringId}`, "info");

      const docRef = doc(db, 'users', user.uid, 'shows', stringId);
      
      // Configuration d'un timeout de 4 secondes pour lever une alerte claire si le réseau ou le cache bloque
      const updatePromise = updateDoc(docRef, updatePayload);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Délai d'attente dépassé (4s) - Écriture Firestore en attente")), 4000)
      );

      await Promise.race([updatePromise, timeoutPromise]);

      useLogStore.getState().addLog(`[Firestore] Succès de la màj atomique pour ${stringId} (Ep: ${epKey})`, "success");
    } catch (error: any) {
      useLogStore.getState().addLog(`[Firestore] ERREUR lors de la màj pour la série ${targetShow.id} : ${error.message}`, "error");
      console.error("Firestore update error:", error);
    }
  } else {
    if (!user) {
      useLogStore.getState().addLog(`[Firestore] Échec màj : Aucun utilisateur connecté`, "error");
    }
    if (!targetShow.id) {
      useLogStore.getState().addLog(`[Firestore] Échec màj : ID de série manquant`, "error");
    }
  }

  scrollAllCarouselsToStart();

  useToastStore.getState().showToast(
    `« ${targetShow.title} » S${sNumStr}E${eNumStr} marqué comme vu !`,
    'success',
    targetShow,
    async () => {
      const rollbackUpdates: Partial<Show> = {
        seenEpisodes: prevSeenEpisodes,
        episodeRecords: prevEpisodeRecords,
        lastWatchedAt: prevLastWatchedAt,
        nextEpisodeToWatch: prevNextEpisodeToWatch,
        status: prevStatus,
        updatedAt: Date.now(),
        isSynced: false
      };

      useShowsStore.getState().updateShowOptimistic(targetShow.id, rollbackUpdates);
      const user = auth.currentUser;
      if (user && targetShow.id) {
        try {
          const stringId = String(targetShow.id);
          const cleanRollback: any = {};
          Object.entries(rollbackUpdates).forEach(([key, val]) => {
            cleanRollback[key] = val === undefined ? null : val;
          });
          const docRef = doc(db, 'users', user.uid, 'shows', stringId);
          await updateDoc(docRef, cleanRollback);
        } catch (e) {
          console.error('[markEpisodeWatched] Direct rollback failed:', e);
        }
      }
      scrollAllCarouselsToStart();
    }
  );
}
