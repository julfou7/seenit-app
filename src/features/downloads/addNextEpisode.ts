import { useEffect, useState } from 'react';
import { tmdb } from '../shows/tmdb';
import { useMediaPresenceStore } from '../../store/mediaPresenceStore';
import { useDownloadConfigStore } from '../../store/downloadConfigStore';
import { useShowsStore } from '../../store/showsStore';
import { useLiveDownloadStore } from '../../store/liveDownloadStore';
import { getTodayStr } from '../../lib/utils';
import { isDownloadFeatureEnabled } from './downloadFeatureVisibility';
import { hasActiveDownloadInScope } from './downloadSearchGuard';
import { episodePresenceKey } from './episodePresenceKey';
import { nextEpisodeToAdd } from './downloadSeriesGroups';
import type { DownloadQualityChoice } from './downloadLaunch';

export interface SeasonTarget { tmdbId: number; tvdbId?: number; season: number; title: string; posterPath?: string; tracked: readonly number[] }

/** #879 — Prochain épisode à ajouter à une carte de saison (TMDB, progression et présence Sonarr exacte). */
export function useNextEpisodeToAdd(target: SeasonTarget | null): { episode: number; name?: string } | null {
  const [next, setNext] = useState<{ episode: number; name?: string } | null>(null);
  const shows = useShowsStore(state => state.shows);
  const key = target ? `${target.tmdbId}:${target.season}:${target.tracked.join(',')}` : '';
  useEffect(() => {
    if (!target || !isDownloadFeatureEnabled(useDownloadConfigStore.getState())) { setNext(null); return; }
    let cancelled = false;
    void Promise.all([
      tmdb.getSeasonDetails(target.tmdbId, target.season),
      useMediaPresenceStore.getState().checkPresence({ tmdbId: target.tmdbId, tvdbId: target.tvdbId, title: target.title, mediaType: 'tv' })
    ]).then(([season, presence]) => {
      if (cancelled || !season.ok) return;
      const show = shows.find(entry => Number(entry.tmdbId) === target.tmdbId);
      const seen = new Set(show?.seenEpisodes || []);
      setNext(nextEpisodeToAdd(season.value?.episodes || [], {
        today: getTodayStr(),
        seen: episode => seen.has(`${target.season}x${episode}`),
        hasFile: episode => Boolean(presence.episodesHasFile?.[episodePresenceKey(target.season, episode)]),
        tracked: new Set(target.tracked)
      }));
    }).catch(() => { if (!cancelled) setNext(null); });
    return () => { cancelled = true; };
  }, [key, shows]);
  return next;
}

/** Ajoute un épisode avec les gardes du mode : fichier présent ou demande active jamais relancés. */
export async function addEpisodeToSeason(target: SeasonTarget, episode: number, quality: DownloadQualityChoice, notify: (action: string, kind?: 'download' | 'success' | 'error' | 'info') => void): Promise<void> {
  const { launchArrEpisodeBatch } = await import('./downloadLaunch');
  await launchArrEpisodeBatch({
    title: target.title, tmdbId: target.tmdbId, tvdbId: target.tvdbId, posterPath: target.posterPath,
    season: target.season, episodes: [episode], qualityPreference: quality,
    readConfig: () => useDownloadConfigStore.getState(),
    skip: number => Boolean(useMediaPresenceStore.getState().getPresence(target.tmdbId, 'tv')?.episodesHasFile?.[episodePresenceKey(target.season, number)])
      || hasActiveDownloadInScope(useLiveDownloadStore.getState().downloads, { mediaType: 'tv', tmdbId: target.tmdbId, seasonNumber: target.season, episodeNumber: number }),
    notify: (_episode, action, kind) => notify(action, kind)
  });
}
