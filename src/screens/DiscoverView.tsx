import React, { useMemo, useRef, useSyncExternalStore } from 'react';
import {
  getProgressiveAgeSnapshot,
  subscribeProgressiveAgeSnapshot,
} from '../features/discover/progressiveAgeFilter';
import {
  mergeProgressivePageItems,
  stabilizeProgressiveDisplayItems,
} from '../features/discover/progressiveAgeFilterCore';
import { DiscoverView as DiscoverViewCore } from './DiscoverViewCore';

interface DiscoverViewProps {
  model: Record<string, any>;
}

const mediaTypeOf = (item: any): 'movie' | 'tv' | 'person' => {
  if (item?.media_type === 'person') return 'person';
  if (item?.media_type === 'movie' || item?.release_date) return 'movie';
  return 'tv';
};

const mediaKeyOf = (item: any): string => {
  const id = Number(item?.id);
  if (!Number.isFinite(id)) return '';
  return `${mediaTypeOf(item)}:${id}`;
};

const progressiveScopeOf = (model: Record<string, any>): string => JSON.stringify({
  pegi: model.pegi,
  category: model.activeCategory,
  platforms: [...(model.selectedPlatforms || [])].sort(),
  genres: [...(model.selectedGenres || [])].sort(),
  minRating: model.minRating,
  sortBy: model.sortBy,
});

export function DiscoverView({ model }: DiscoverViewProps) {
  const snapshot = useSyncExternalStore(
    subscribeProgressiveAgeSnapshot,
    getProgressiveAgeSnapshot,
    getProgressiveAgeSnapshot,
  );
  const stableOrderRef = useRef<string[]>([]);
  const stableScopeRef = useRef('');

  const progressiveModel = useMemo(() => {
    const ageFilterActive = model.pegi !== 'Tous' && !model.debouncedQuery?.trim();
    const stableProgressiveOrderEnabled = ageFilterActive && model.sortBy === 'popular';

    if (!stableProgressiveOrderEnabled || typeof model.processRawResults !== 'function') {
      stableOrderRef.current = [];
      stableScopeRef.current = '';
      return model;
    }

    const progressiveScope = progressiveScopeOf(model);
    if (stableScopeRef.current !== progressiveScope) {
      stableScopeRef.current = progressiveScope;
      stableOrderRef.current = [];
    }

    const stabilizeResults = (items: any[]) => {
      const stabilized = stabilizeProgressiveDisplayItems(items, stableOrderRef.current, mediaKeyOf);
      stableOrderRef.current = stabilized.order;
      return stabilized.items;
    };

    const buildStableModel = (results: any[], overrides: Record<string, any> = {}) => {
      const seriesResults = results.filter((item: any) => mediaTypeOf(item) === 'tv');
      const movieResults = results.filter((item: any) => mediaTypeOf(item) === 'movie');
      return {
        ...model,
        ...overrides,
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
    };

    const page = Number(snapshot?.page || 0);
    const partial = snapshot?.partial;
    const progressiveRequestActive = page === 1 ? model.loading : page > 1 && model.isLoadingMore;

    if (!progressiveRequestActive
      || !Array.isArray(partial?.results)
      || partial.results.length === 0) {
      if (stableOrderRef.current.length === 0 || !Array.isArray(model.processedResults)) {
        return model;
      }
      return buildStableModel(stabilizeResults(model.processedResults));
    }

    const settledItems = page === 1 && model.loading
      ? []
      : (Array.isArray(model.processedResults) ? model.processedResults : []);
    const mergedItems = mergeProgressivePageItems(
      settledItems,
      partial.results,
      page,
      mediaKeyOf,
    );
    const results = stabilizeResults(model.processRawResults(mergedItems));

    return buildStableModel(results, {
      loading: false,
      isLoadingMore: page > 1,
      hasMore: page > 1 ? model.hasMore : false,
      // hasMore=false sur une page 1 partielle bloque volontairement la pagination,
      // mais ne signifie pas que la recherche est terminée.
      suppressEndOfResults: true,
    });
  }, [model, snapshot]);

  return <DiscoverViewCore model={progressiveModel} />;
}
