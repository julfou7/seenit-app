import { useShowsStore } from '../../store/showsStore';
import { tmdb } from './tmdb';
import { syncSingleItem } from '../../hooks/useDetailsSyncWorker';
import { useToastStore } from '../../store/toastStore';
import { scrollAllCarouselsToStart } from '../../lib/utils';
import { type Show } from '../../types';
import { db, auth } from '../../lib/firebase';
import { doc, setDoc } from 'firebase/firestore';

export async function markEpisodeWatched(
  showIdOrTmdbId: string | number,
  season: number,
  episode: number,
  updateShowFn?: (id: string, updates: Partial<Show>) => Promise<void>
) {
  const showIdStr = String(showIdOrTmdbId);
  const targetShow = useShowsStore.getState().shows.find(
    s => String(s.id) === showIdStr || String(s.tmdbId) === showIdStr
  );

  if (!targetShow || !targetShow.id) {
    console.warn(`[markEpisodeWatched] Show not found: ${showIdOrTmdbId}`);
    return;
  }

  const sNum = Number(season);
  const eNum = Number(episode);
  if (isNaN(sNum) || isNaN(eNum)) return;

  const epKey = `${sNum}x${eNum}`;
  const sNumStr = String(sNum).padStart(2, '0');
  const eNumStr = String(eNum).padStart(2, '0');

  // Save previous state for undo capability
  const prevSeenEpisodes = targetShow.seenEpisodes || [];
  const prevEpisodeRecords = targetShow.episodeRecords || {};
  const prevLastWatchedAt = targetShow.lastWatchedAt || null;
  const prevNextEpisodeToWatch = targetShow.nextEpisodeToWatch || null;
  const prevStatus = targetShow.status;

  const newSeen = new Set(prevSeenEpisodes);
  newSeen.add(epKey);

  const newRecords = { ...prevEpisodeRecords };
  newRecords[epKey] = {
    watchedAt: Date.now(),
    episodeTitle: prevEpisodeRecords[epKey]?.episodeTitle || null,
    ...(newRecords[epKey] || {})
  };

  // Try to get episode title & next episode
  let optimisticNextEp: any = null;
  const totalEps = targetShow.totalAiredEpisodes || targetShow.totalEpisodes || 0;
  const newSeenArray = Array.from(newSeen as Set<string>);

  if (targetShow.tmdbId) {
    try {
      const seasonRes = await tmdb.getSeasonDetails(targetShow.tmdbId, sNum);
      if (seasonRes.ok && seasonRes.value?.episodes) {
        const curEp = seasonRes.value.episodes.find((x: any) => x.episode_number === eNum);
        if (curEp && curEp.name) {
          newRecords[epKey].episodeTitle = curEp.name;
        }

        if (totalEps > 0 && newSeenArray.length >= totalEps) {
          optimisticNextEp = null;
        } else {
          const nextInSeason = seasonRes.value.episodes.find((x: any) => x.episode_number === eNum + 1);
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
            if (nextSeasonRes.ok && nextSeasonRes.value?.episodes?.[0]) {
              const nextSeasonFirst = nextSeasonRes.value.episodes[0];
              optimisticNextEp = {
                season_number: nextSeasonFirst.season_number,
                episode_number: nextSeasonFirst.episode_number,
                air_date: nextSeasonFirst.air_date || null,
                name: nextSeasonFirst.name || null,
                still_path: nextSeasonFirst.still_path || null,
                episode_count: nextSeasonRes.value.episodes?.length || 1,
                aired_episodes_in_season: nextSeasonRes.value.episodes?.filter((ep: any) => ep.air_date && ep.air_date <= new Date().toISOString().slice(0, 10)).length || 1,
                is_final_season: targetShow.nextEpisodeToWatch?.is_final_season,
                series_ended: targetShow.nextEpisodeToWatch?.series_ended || targetShow.seriesEnded
              };
            }
          }
        }
      }
    } catch (e) {
      console.error('[markEpisodeWatched] TMDB fetch error:', e);
    }
  }

  const updates: Partial<Show> = {
    seenEpisodes: newSeenArray,
    episodeRecords: newRecords,
    lastWatchedAt: Date.now(),
    nextEpisodeToWatch: optimisticNextEp,
    status: targetShow.status === 'plan_to_watch' ? 'watching' : targetShow.status,
    updatedAt: Date.now(),
    isSynced: false
  };

  if (updateShowFn) {
    await updateShowFn(targetShow.id, updates);
  } else {
    useShowsStore.getState().updateShowOptimistic(targetShow.id, updates);
    const user = auth.currentUser;
    if (user && targetShow.id) {
      try {
        const cleanUpdates: any = {};
        Object.entries(updates).forEach(([key, val]) => {
          cleanUpdates[key] = val === undefined ? null : val;
        });
        await setDoc(doc(db, 'users', user.uid, 'shows', targetShow.id), cleanUpdates, { merge: true });
      } catch (e) {
        console.error('[markEpisodeWatched] Direct Firestore update failed:', e);
      }
    }
  }

  syncSingleItem(targetShow.id, true).catch(console.error);
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
      if (updateShowFn) {
        await updateShowFn(targetShow.id, rollbackUpdates);
      } else {
        useShowsStore.getState().updateShowOptimistic(targetShow.id, rollbackUpdates);
        const user = auth.currentUser;
        if (user && targetShow.id) {
          try {
            const cleanRollback: any = {};
            Object.entries(rollbackUpdates).forEach(([key, val]) => {
              cleanRollback[key] = val === undefined ? null : val;
            });
            await setDoc(doc(db, 'users', user.uid, 'shows', targetShow.id), cleanRollback, { merge: true });
          } catch (e) {
            console.error('[markEpisodeWatched] Direct rollback failed:', e);
          }
        }
      }
      syncSingleItem(targetShow.id, true).catch(console.error);
      scrollAllCarouselsToStart();
    }
  );
}
