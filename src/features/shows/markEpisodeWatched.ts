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
    return false;
  }

  const sNum = Number(season);
  const eNum = Number(episode);
  if (isNaN(sNum) || isNaN(eNum)) return false;
  const initiatingUid = auth.currentUser?.uid;
  if (!initiatingUid || targetShow.userId && targetShow.userId !== initiatingUid) return false;

  const epKey = `${sNum}x${eNum}`;
  const sNumStr = String(sNum).padStart(2, '0');
  const eNumStr = String(eNum).padStart(2, '0');

  const prevSeenEpisodes = targetShow.seenEpisodes || [];
  const prevEpisodeRecords = targetShow.episodeRecords || {};
  const prevLastWatchedAt = targetShow.lastWatchedAt || null;
  const prevNextEpisodeToWatch = targetShow.nextEpisodeToWatch || null;
  const prevStatus = targetShow.status;

  const newSeenSet = new Set(prevSeenEpisodes);
  newSeenSet.add(epKey);
  const newSeenArray = Array.from(newSeenSet);

  let fetchedEpTitle: string | null = null;
  let fetchedRuntime: number | null = null;
  let optimisticNextEp: Show['nextEpisodeToWatch'] = null;
  const totalEps = targetShow.totalAiredEpisodes || targetShow.totalEpisodes || 0;

  if (targetShow.tmdbId) {
    try {
      const seasonRes = await tmdb.getSeasonDetails(targetShow.tmdbId, sNum);
      if (seasonRes.ok && seasonRes.value?.episodes) {
        const curEp = seasonRes.value.episodes.find((x: { episode_number: number; name?: string; runtime?: number }) => x.episode_number === eNum);
        if (curEp && curEp.name) fetchedEpTitle = curEp.name;
        if (typeof curEp?.runtime === 'number' && curEp.runtime > 0) fetchedRuntime = curEp.runtime;

        if (totalEps > 0 && newSeenArray.length >= totalEps) {
          optimisticNextEp = null;
        } else {
          const nextInSeason = seasonRes.value.episodes.find((x: any) => x.episode_number > eNum && !newSeenSet.has(`${sNum}x${x.episode_number}`));
          if (nextInSeason) {
            const evidence = targetShow.seasonProgress?.[String(sNum)];
            const previous = targetShow.nextEpisodeToWatch?.season_number === sNum ? targetShow.nextEpisodeToWatch : null;
            optimisticNextEp = {
              ...evidence,
              season_number: nextInSeason.season_number,
              episode_number: nextInSeason.episode_number,
              air_date: nextInSeason.air_date || null,
              name: nextInSeason.name || null,
              still_path: nextInSeason.still_path || null,
              episode_count: evidence?.episode_count ?? (evidence?.season_total_unknown || previous?.season_total_unknown ? null : previous?.episode_count || null),
              known_episodes_in_season: Math.max(evidence?.known_episodes_in_season || 0, ...seasonRes.value.episodes.map((ep: { episode_number: number }) => ep.episode_number)),
              aired_episodes_in_season: targetShow.nextEpisodeToWatch?.aired_episodes_in_season,
              is_final_season: targetShow.nextEpisodeToWatch?.is_final_season,
              series_ended: targetShow.nextEpisodeToWatch?.series_ended || targetShow.seriesEnded
            };
          } else {
            const nextSeasonRes = await tmdb.getSeasonDetails(targetShow.tmdbId, sNum + 1);
            if (nextSeasonRes.ok && nextSeasonRes.value?.episodes) {
              const nextSeasonUnseen = nextSeasonRes.value.episodes.find((x: any) => !newSeenSet.has(`${sNum + 1}x${x.episode_number}`));
              if (nextSeasonUnseen) {
                const evidence = targetShow.seasonProgress?.[String(sNum + 1)];
                optimisticNextEp = {
                  ...evidence,
                  season_number: nextSeasonUnseen.season_number,
                  episode_number: nextSeasonUnseen.episode_number,
                  air_date: nextSeasonUnseen.air_date || null,
                  name: nextSeasonUnseen.name || null,
                  still_path: nextSeasonUnseen.still_path || null,
                  episode_count: evidence?.episode_count || null,
                  known_episodes_in_season: Math.max(evidence?.known_episodes_in_season || 0, ...nextSeasonRes.value.episodes.map((ep: { episode_number: number }) => ep.episode_number)),
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

  if (!optimisticNextEp && (totalEps === 0 || newSeenArray.length < totalEps)) {
    let checkEp = eNum + 1;
    while (newSeenSet.has(`${sNum}x${checkEp}`) && checkEp <= 100) checkEp++;
    optimisticNextEp = { season_number: sNum, episode_number: checkEp };
  }

  const episodeTitle = fetchedEpTitle || optimisticNextEp?.name || null;

  if (auth.currentUser?.uid !== initiatingUid) return false;
  const localUpdates: Partial<Show> = {
    seenEpisodes: newSeenArray,
    episodeRecords: {
      ...prevEpisodeRecords,
      [epKey]: {
        ...prevEpisodeRecords[epKey],
        watchedAt: Date.now(),
        watchedTimeKnown: true,
        episodeTitle,
        ...(fetchedRuntime ? { runtime: fetchedRuntime } : {})
      }
    },
    lastWatchedAt: Date.now(),
    nextEpisodeToWatch: optimisticNextEp,
    status: targetShow.status === 'plan_to_watch' ? 'watching' : targetShow.status,
    updatedAt: Date.now(),
    isSynced: false
  };

  useShowsStore.getState().updateShowOptimistic(targetShow.id, localUpdates);

  const user = auth.currentUser;
  if (user && targetShow.id) {
    const stringId = String(targetShow.id);
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    useLogStore.getState().addLog(`[Firestore] Début màj atomique pour ${stringId} (${targetShow.title}) - En ligne : ${isOnline}`, "info");

    try {
      const updatePayload: Record<string, unknown> = {
        seenEpisodes: arrayUnion(epKey),
        lastWatchedAt: Date.now(),
        updatedAt: Date.now(),
        isSynced: false
      };

      updatePayload[`episodeRecords.${epKey}`] = {
        ...prevEpisodeRecords[epKey],
        watchedAt: Date.now(),
        watchedTimeKnown: true,
        episodeTitle: fetchedEpTitle || optimisticNextEp?.name || null,
        ...(fetchedRuntime ? { runtime: fetchedRuntime } : {})
      };

      if (optimisticNextEp !== undefined) {
        const cleanNextEp: any = { ...optimisticNextEp };
        Object.keys(cleanNextEp).forEach(key => {
          if (cleanNextEp[key] === undefined) cleanNextEp[key] = null;
        });
        updatePayload.nextEpisodeToWatch = cleanNextEp;
      }

      if (targetShow.status === 'plan_to_watch') updatePayload.status = 'watching';

      useLogStore.getState().addLog(`[Firestore] Envoi payload (${Object.keys(updatePayload).join(', ')}) pour la série ${stringId}`, "info");

      const docRef = doc(db, 'users', user.uid, 'shows', stringId);

      // Firestore ne permet pas d'annuler updateDoc : attendre son résultat réel évite
      // un rollback local sur timeout alors que l'écriture distante peut encore réussir.
      await updateDoc(docRef, updatePayload);

      useLogStore.getState().addLog(`[Firestore] Succès de la màj atomique pour ${stringId} (Ep: ${epKey})`, "success");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      useLogStore.getState().addLog(`[Firestore] ERREUR lors de la màj pour la série ${targetShow.id} : ${message}`, "error");
      console.error("Firestore update error:", error);
      useLogStore.getState().addLog(`[Système] Erreur de mise à jour Firestore: ${message}`, 'error', error);
      if (auth.currentUser?.uid === initiatingUid) {
        useShowsStore.getState().updateShowOptimistic(targetShow.id, {
          seenEpisodes: prevSeenEpisodes, episodeRecords: prevEpisodeRecords, lastWatchedAt: prevLastWatchedAt,
          nextEpisodeToWatch: prevNextEpisodeToWatch, status: prevStatus,
        });
        useToastStore.getState().showToast('L’épisode n’a pas pu être marqué vu.', 'error');
      }
      return false;
    }
  } else {
    if (!user) useLogStore.getState().addLog(`[Firestore] Échec màj : Aucun utilisateur connecté`, "error");
    if (!targetShow.id) useLogStore.getState().addLog(`[Firestore] Échec màj : ID de série manquant`, "error");
  }

  if (auth.currentUser?.uid !== initiatingUid) return false;
  scrollAllCarouselsToStart();

  useToastStore.getState().showToast(
    `« ${targetShow.title} » S${sNumStr} | E${eNumStr} marqué comme vu !`,
    'success',
    targetShow,
    async () => {
      if (auth.currentUser?.uid !== initiatingUid) return;
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
  return true;
}
