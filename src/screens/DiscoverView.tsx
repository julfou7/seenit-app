import React, { useMemo, useSyncExternalStore } from 'react';
import {
  getProgressiveAgeSnapshot,
  subscribeProgressiveAgeSnapshot,
} from '../features/discover/progressiveAgeFilter';
import { mergeProgressivePageItems } from '../features/discover/progressiveAgeFilterCore';
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
    const page = Number(snapshot?.page || 0);
    const partial = snapshot?.partial;
    const progressiveRequestActive = page === 1 ? model.loading : page > 1 && model.isLoadingMore;
    if (!progressiveRequestActive
      || model.pegi === 'Tous'
      || model.debouncedQuery?.trim()
      || !Array.isArray(partial?.results)
      || partial.results.length === 0
      || typeof model.processRawResults !== 'function') {
      return model;
    }

    const settledItems = page === 1 && model.loading
      ? []
      : (Array.isArray(model.processedResults) ? model.processedResults : []);
    const mergedItems = mergeProgressivePageItems(
      settledItems,
      partial.results,
      page,
      (item: any) => `${mediaTypeOf(item)}:${Number(item?.id)}`,
    );
    const results = model.processRawResults(mergedItems);
    const seriesResults = results.filter((item: any) => mediaTypeOf(item) === 'tv');
    const movieResults = results.filter((item: any) => mediaTypeOf(item) === 'movie');

    return {
      ...model,
      loading: false,
      isLoadingMore: page > 1,
      hasMore: page > 1 ? model.hasMore : false,
      // hasMore=false sur une page 1 partielle bloque volontairement la pagination,
      // mais ne signifie pas que la recherche est terminée.
      suppressEndOfResults: true,
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
