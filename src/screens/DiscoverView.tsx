import React, { useMemo, useSyncExternalStore } from 'react';
import {
  getProgressiveAgeSnapshot,
  subscribeProgressiveAgeSnapshot,
} from '../features/discover/progressiveAgeFilter';
import { checkIsUpToDate } from './discoverPresentation';
import { DiscoverView as DiscoverViewCore } from './DiscoverViewCore';

interface DiscoverViewProps {
  model: Record<string, any>;
}

const mediaTypeOf = (item: any): 'movie' | 'tv' | 'person' => {
  if (item?.media_type === 'person') return 'person';
  if (item?.media_type === 'movie' || item?.release_date) return 'movie';
  return 'tv';
};

export function DiscoverView({ model }: DiscoverViewProps) {
  const snapshot = useSyncExternalStore(
    subscribeProgressiveAgeSnapshot,
    getProgressiveAgeSnapshot,
    getProgressiveAgeSnapshot,
  );

  const progressiveModel = useMemo(() => {
    const partial = snapshot?.page === 1 ? snapshot.partial : null;
    if (!model.loading
      || model.pegi === 'Tous'
      || model.debouncedQuery?.trim()
      || !Array.isArray(partial?.results)
      || partial.results.length === 0) {
      return model;
    }

    const results = partial.results.filter((item: any) => {
      const show = model.showsByTmdbId?.get?.(Number(item?.id));
      if (!show) return true;
      return !(show.status === 'completed'
        || show.seenEpisodes?.includes?.('movie')
        || checkIsUpToDate(show));
    });
    const seriesResults = results.filter((item: any) => mediaTypeOf(item) === 'tv');
    const movieResults = results.filter((item: any) => mediaTypeOf(item) === 'movie');

    return {
      ...model,
      loading: false,
      isLoadingMore: false,
      hasMore: false,
      processedResults: results,
      uniqueProcessedResults: results,
      visibleProcessedResults: results,
      personResults: [],
      visiblePersonResults: [],
      seriesResults,
      visibleSeriesResults: seriesResults,
      movieResults,
      visibleMovieResults: movieResults,
      top10: [],
      visibleHeroItems: [],
    };
  }, [model, snapshot]);

  return <DiscoverViewCore model={progressiveModel} />;
}
