import { useEffect, useState } from 'react';
import type { Show } from '../types';
import { tmdb } from '../features/shows/tmdb';
import {
  applyProfileAnalyticsContributions,
  getProfileAnalyticsMediaKey,
  readProfileAnalyticsSnapshot,
  reconcileProfileAnalyticsSnapshot,
  writeProfileAnalyticsSnapshot,
  type AnalyticsData,
  type AnalyticsMediaContribution,
  type AnalyticsPersonContribution,
  type ProfileAnalyticsSnapshot,
} from '../features/profile/profileAnalyticsSnapshot';
import { checkIsUpToDate } from '../lib/utils';
import { auth } from '../lib/firebase';

export type { AnalyticsData, PersonStat } from '../features/profile/profileAnalyticsSnapshot';
export { getArchetypeForGenre } from '../features/profile/profileAnalyticsSnapshot';

// Les contributions sont publiques et typées par média. Ce petit LRU de session
// complète le snapshot UID persistant sans exposer de progression entre comptes.
const analyticsContributionCache = new Map<string, AnalyticsMediaContribution>();
const MAX_ANALYTICS_CONTRIBUTIONS = 512;

// Le snapshot complet permet de reprendre une réconciliation interrompue sans
// désérialiser localStorage à chaque retour vers le Profil.
const analyticsSnapshotCache = new Map<string, ProfileAnalyticsSnapshot>();
const MAX_ANALYTICS_SNAPSHOTS = 4;

// Le résultat exact reste disponible pour un rendu synchrone pendant la session.
const analyticsResultCache = new Map<string, AnalyticsData>();
const MAX_ANALYTICS_RESULTS = 8;

const readContributionCache = (key: string): AnalyticsMediaContribution | null => {
  const cached = analyticsContributionCache.get(key);
  if (!cached) return null;
  analyticsContributionCache.delete(key);
  analyticsContributionCache.set(key, cached);
  return cached;
};

const writeContributionCache = (key: string, contribution: AnalyticsMediaContribution) => {
  if (analyticsContributionCache.has(key)) analyticsContributionCache.delete(key);
  analyticsContributionCache.set(key, contribution);
  while (analyticsContributionCache.size > MAX_ANALYTICS_CONTRIBUTIONS) {
    const oldest = analyticsContributionCache.keys().next().value;
    if (!oldest) break;
    analyticsContributionCache.delete(oldest);
  }
};

const writeSnapshotCache = (uid: string, snapshot: ProfileAnalyticsSnapshot) => {
  if (analyticsSnapshotCache.has(uid)) analyticsSnapshotCache.delete(uid);
  analyticsSnapshotCache.set(uid, snapshot);
  while (analyticsSnapshotCache.size > MAX_ANALYTICS_SNAPSHOTS) {
    const oldest = analyticsSnapshotCache.keys().next().value;
    if (!oldest) break;
    analyticsSnapshotCache.delete(oldest);
  }
};

const writeResultCache = (key: string, data: AnalyticsData) => {
  if (analyticsResultCache.has(key)) analyticsResultCache.delete(key);
  analyticsResultCache.set(key, data);
  while (analyticsResultCache.size > MAX_ANALYTICS_RESULTS) {
    const oldest = analyticsResultCache.keys().next().value;
    if (!oldest) break;
    analyticsResultCache.delete(oldest);
  }
};

const isDirectingJob = (jobValue: string) => {
  const job = (jobValue || '').toLowerCase();
  return job.includes('director')
    || job.includes('réalisat')
    || job.includes('creator')
    || job.includes('créat')
    || job === 'showrunner';
};

const toPersonContribution = (person: any): AnalyticsPersonContribution => ({
  id: Number(person.id),
  name: person.name || '',
  profile_path: person.profile_path || null,
  popularity: Number(person.popularity) || 0,
});

const extractAnalyticsContribution = (show: Show, details: any): AnalyticsMediaContribution => {
  const genres = Array.from(new Set<string>(
    (Array.isArray(details?.genres) ? details.genres : [])
      .map((genre: any) => String(genre?.name || '').trim())
      .filter((name: string) => name.length > 0),
  ));

  let castList: any[] = [];
  if (show.mediaType === 'tv') {
    if (Array.isArray(details?.aggregate_credits?.cast) && details.aggregate_credits.cast.length > 0) {
      castList = [...details.aggregate_credits.cast].sort((left: any, right: any) => {
        const episodeDiff = (right.total_episode_count || 0) - (left.total_episode_count || 0);
        return episodeDiff || (left.order || 0) - (right.order || 0);
      });
    } else if (Array.isArray(details?.credits?.cast)) {
      castList = details.credits.cast;
    }
  } else if (Array.isArray(details?.credits?.cast)) {
    castList = details.credits.cast;
  }

  const actorsById = new Map<number, AnalyticsPersonContribution>();
  castList.forEach((cast) => {
    const id = Number(cast?.id);
    if (id && !actorsById.has(id)) actorsById.set(id, toPersonContribution(cast));
  });

  const directorsById = new Map<number, AnalyticsPersonContribution>();
  const addDirector = (person: any) => {
    const id = Number(person?.id);
    if (id && !directorsById.has(id)) directorsById.set(id, toPersonContribution(person));
  };

  if (show.mediaType === 'tv') {
    if (Array.isArray(details?.created_by)) details.created_by.forEach(addDirector);
    const crew = details?.aggregate_credits?.crew || details?.credits?.crew || [];
    if (Array.isArray(crew)) {
      crew.forEach((member: any) => {
        const directing = Array.isArray(member?.jobs)
          ? member.jobs.some((job: any) => isDirectingJob(job?.job))
          : isDirectingJob(member?.job);
        if (directing) addDirector(member);
      });
    }
  } else {
    const crew = details?.credits?.crew || [];
    if (Array.isArray(crew)) {
      crew.forEach((member: any) => {
        if (isDirectingJob(member?.job)) addDirector(member);
      });
    }
  }

  return {
    genres,
    actors: Array.from(actorsById.values()),
    directors: Array.from(directorsById.values()),
  };
};

export function isShowWatched(show: Show | undefined): boolean {
  if (!show || !show.tmdbId) return false;
  if (show.mediaType === 'movie') {
    return show.status === 'completed'
      || Boolean(show.seenEpisodes?.includes('movie'))
      || checkIsUpToDate(show);
  }
  const seenCount = (show.seenEpisodes || []).filter((episode) => episode !== 'movie').length;
  return show.status === 'completed' || seenCount > 0 || checkIsUpToDate(show);
}

const monotonicNow = () => (
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
);

const reportPerformance = (
  mode: string,
  startedAt: number,
  mediaCount: number,
  changedMediaCount: number,
  metadataRequests: number,
) => {
  console.info('[AnalyticsPerformance]', {
    mode,
    durationMs: Math.round((monotonicNow() - startedAt) * 10) / 10,
    mediaCount,
    changedMediaCount,
    metadataRequests,
  });
};

export function useProAnalytics(shows: Show[], libraryReady = true) {
  const [ownedData, setOwnedData] = useState<{ uid: string; data: AnalyticsData } | null>(null);
  const [loading, setLoading] = useState(false);
  const uid = auth.currentUser?.uid || 'anonymous';
  const data = ownedData?.uid === uid ? ownedData.data : null;

  useEffect(() => {
    let isMounted = true;

    async function loadStats() {
      const startedAt = monotonicNow();
      const memorySnapshot = analyticsSnapshotCache.get(uid) || null;
      const persistedSnapshot = uid === 'anonymous' || memorySnapshot
        ? null
        : readProfileAnalyticsSnapshot(uid);
      const previous = memorySnapshot || persistedSnapshot;

      // La baseline UID est affichée avant tout recalcul ou appel TMDB.
      if (previous && isMounted) setOwnedData({ uid, data: previous.data });
      if (!libraryReady) {
        if (isMounted) setLoading(!previous);
        return;
      }

      const reconciliation = reconcileProfileAnalyticsSnapshot({
        uid,
        shows: shows || [],
        isWatched: isShowWatched,
        previous,
      });
      const { snapshot } = reconciliation;
      writeSnapshotCache(uid, snapshot);

      const resultCacheKey = `${uid}:${snapshot.signature}`;
      const exactResult = analyticsResultCache.get(resultCacheKey);
      if (exactResult && reconciliation.mode === 'snapshot-exact') snapshot.data = exactResult;

      if (isMounted) {
        setOwnedData({ uid, data: snapshot.data });
        setLoading(reconciliation.metadataKeys.length > 0);
      }

      if (uid !== 'anonymous' && reconciliation.mode !== 'snapshot-exact') {
        writeProfileAnalyticsSnapshot(snapshot);
      }

      if (reconciliation.metadataKeys.length === 0) {
        writeResultCache(resultCacheKey, snapshot.data);
        reportPerformance(
          reconciliation.mode,
          startedAt,
          reconciliation.scannedMediaCount,
          reconciliation.changedMediaKeys.length,
          0,
        );
        return;
      }

      const batchSize = 12;
      let metadataRequests = 0;
      const showsByMediaKey = new Map(
        shows.map((show) => [getProfileAnalyticsMediaKey(show), show]),
      );
      for (let offset = 0; offset < reconciliation.metadataKeys.length; offset += batchSize) {
        if (!isMounted) return;
        const batch = reconciliation.metadataKeys.slice(offset, offset + batchSize);
        const contributions = await Promise.all(batch.map(async (mediaKey) => {
          const cached = readContributionCache(mediaKey);
          if (cached) return { mediaKey, contribution: cached };

          const state = snapshot.media[mediaKey];
          if (!state) return null;
          metadataRequests += 1;
          try {
            const result = state.mediaType === 'movie'
              ? await tmdb.getMovieDetails(state.tmdbId)
              : await tmdb.getShowDetails(state.tmdbId);
            if (!result.ok || !result.value) return null;
            const show = showsByMediaKey.get(mediaKey);
            if (!show) return null;
            const contribution = extractAnalyticsContribution(show, result.value);
            writeContributionCache(mediaKey, contribution);
            return { mediaKey, contribution };
          } catch (error) {
            console.warn('[Analytics] Impossible de charger une contribution TMDB', error);
            return null;
          }
        }));

        if (!isMounted) return;
        const fetchedAt = Date.now();
        applyProfileAnalyticsContributions(
          snapshot,
          contributions.filter((result): result is NonNullable<typeof result> => Boolean(result)),
          fetchedAt,
        );

        const batchIndex = Math.floor(offset / batchSize);
        const isLastBatch = offset + batch.length >= reconciliation.metadataKeys.length;
        if (batchIndex === 0 || (batchIndex + 1) % 4 === 0 || isLastBatch) {
          setOwnedData({ uid, data: snapshot.data });
          if (uid !== 'anonymous') writeProfileAnalyticsSnapshot(snapshot);
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }

      if (!isMounted) return;
      setLoading(false);
      writeResultCache(resultCacheKey, snapshot.data);
      reportPerformance(
        reconciliation.mode,
        startedAt,
        reconciliation.scannedMediaCount,
        reconciliation.changedMediaKeys.length,
        metadataRequests,
      );
    }

    void loadStats();
    return () => { isMounted = false; };
  }, [uid, shows, libraryReady]);

  return { data, loading };
}
