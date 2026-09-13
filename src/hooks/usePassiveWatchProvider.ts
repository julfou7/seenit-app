import { useEffect, useRef, useState } from 'react';
import { tmdb } from '../features/shows/tmdb';
import { getPlexMediaKey, usePlexAvailabilityStore } from '../features/plex/plexAvailability';
import {
  observeWatchProviderCard,
  scheduleWatchProviderCardEnrichment,
} from '../features/providers/watchProviderRequestPolicy';
import {
  readWatchProviderCache,
  retainWatchProviderCacheEntry,
  writeWatchProviderCache,
} from '../features/providers/watchProviderCache';
import {
  arePassiveProviderStatesEqual,
  isPassiveProviderResolutionComplete,
  resolvePassiveProviderState,
  type PassiveProviderState,
} from '../features/providers/passiveProviderState';
import { extractOfficialStreamingProvider } from '../utils/providerLogos';

interface PassiveWatchProviderParams {
  tmdbId?: number | string | null;
  mediaType: 'movie' | 'tv';
  title?: string;
  originalTitle?: string;
  year?: number | string;
  hasKnownProvider?: boolean;
  retainInLibraryCache?: boolean;
  onEnrich?: () => void;
}

type OfficialProvider = ReturnType<typeof extractOfficialStreamingProvider>;

type CachedProviderSnapshot = {
  data: any;
  fresh: boolean;
  provider: OfficialProvider;
};

type ProviderLoadingState = {
  key: string;
  loading: boolean;
};

function getProviderKey(tmdbId: number, mediaType: 'movie' | 'tv'): string {
  return `${mediaType}:${tmdbId}`;
}

function readCachedProviderSnapshot(
  tmdbId: number,
  mediaType: 'movie' | 'tv',
): CachedProviderSnapshot | null {
  const memoryData = tmdb.peekWatchProviders(tmdbId, mediaType);
  if (memoryData) {
    return {
      data: memoryData,
      fresh: true,
      provider: extractOfficialStreamingProvider(memoryData?.results),
    };
  }

  const persisted = readWatchProviderCache(tmdbId, mediaType, { allowStale: true });
  if (!persisted) return null;

  return {
    data: persisted.data,
    fresh: persisted.fresh,
    provider: extractOfficialStreamingProvider(persisted.data?.results),
  };
}

export function usePassiveWatchProvider({
  tmdbId,
  mediaType,
  hasKnownProvider = false,
  retainInLibraryCache = false,
  onEnrich,
}: PassiveWatchProviderParams) {
  const cardRef = useRef<HTMLDivElement>(null);
  const numericTmdbId = Number(tmdbId);
  const validTmdbId = Number.isFinite(numericTmdbId) && numericTmdbId > 0;
  const providerKey = validTmdbId ? getProviderKey(numericTmdbId, mediaType) : `${mediaType}:invalid`;
  const plexMediaKey = getPlexMediaKey(validTmdbId ? numericTmdbId : null, mediaType);
  const cachedPlexInfo = usePlexAvailabilityStore(state => validTmdbId && !hasKnownProvider
    ? state.cache[plexMediaKey]
    : undefined);
  const renderSnapshot = validTmdbId && !hasKnownProvider
    ? readCachedProviderSnapshot(numericTmdbId, mediaType)
    : null;
  const renderProviderState = resolvePassiveProviderState(
    providerKey,
    renderSnapshot?.provider,
    cachedPlexInfo,
  );
  const [providerState, setProviderState] = useState<PassiveProviderState>(() => renderProviderState);
  const [loadingState, setLoadingState] = useState<ProviderLoadingState>(() => ({
    key: providerKey,
    loading: false,
  }));

  const currentProviderState = providerState.key === providerKey
    ? providerState
    : renderProviderState;
  const isProviderLoading = loadingState.key === providerKey && loadingState.loading;

  useEffect(() => {
    if (!validTmdbId || hasKnownProvider || !retainInLibraryCache) return;
    retainWatchProviderCacheEntry(numericTmdbId, mediaType);
  }, [hasKnownProvider, mediaType, numericTmdbId, retainInLibraryCache, validTmdbId]);

  useEffect(() => {
    const node = cardRef.current;
    if (!node) return;

    if (isProviderLoading && !currentProviderState.logo) {
      node.dataset.providerLoading = 'true';
      node.setAttribute('aria-busy', 'true');
    } else {
      delete node.dataset.providerLoading;
      node.removeAttribute('aria-busy');
    }

    return () => {
      delete node.dataset.providerLoading;
      node.removeAttribute('aria-busy');
    };
  }, [currentProviderState.logo, isProviderLoading, providerKey]);

  useEffect(() => {
    let isMounted = true;
    let cancelScheduledEnrichment = () => {};
    let stopObserving = () => {};

    const updateProviderState = (nextState: PassiveProviderState) => {
      if (!isMounted) return;
      setProviderState(current => arePassiveProviderStatesEqual(current, nextState) ? current : nextState);
    };

    const finishLoading = () => {
      if (!isMounted) return;
      setLoadingState(current => current.key === providerKey && !current.loading
        ? current
        : { key: providerKey, loading: false });
    };

    const startLoadingIfNeeded = () => {
      if (!isMounted || hasKnownProvider) return;
      const latestSnapshot = readCachedProviderSnapshot(numericTmdbId, mediaType);
      const latestPlexInfo = usePlexAvailabilityStore.getState().getMediaAvailability(plexMediaKey);
      if (!latestSnapshot?.provider && !latestPlexInfo?.available && !latestSnapshot?.fresh) {
        setLoadingState(current => current.key === providerKey && current.loading
          ? current
          : { key: providerKey, loading: true });
      }
    };

    if (!cardRef.current || !validTmdbId) {
      updateProviderState(resolvePassiveProviderState(providerKey));
      finishLoading();
      return () => { isMounted = false; };
    }

    const initialSnapshot = hasKnownProvider
      ? null
      : readCachedProviderSnapshot(numericTmdbId, mediaType);
    updateProviderState(resolvePassiveProviderState(
      providerKey,
      initialSnapshot?.provider,
      usePlexAvailabilityStore.getState().getMediaAvailability(plexMediaKey),
    ));
    finishLoading();

    const applyAuthoritativeTmdbPayload = (payload: any) => {
      if (!isMounted) return;
      const stream = payload?.results
        ? extractOfficialStreamingProvider(payload.results)
        : null;
      updateProviderState(resolvePassiveProviderState(
        providerKey,
        stream,
        usePlexAvailabilityStore.getState().getMediaAvailability(plexMediaKey),
      ));
      finishLoading();
    };

    const enrichProvider = () => {
      onEnrich?.();
      if (hasKnownProvider) {
        finishLoading();
        return;
      }

      const latestSnapshot = readCachedProviderSnapshot(numericTmdbId, mediaType);
      const latestPlexInfo = usePlexAvailabilityStore.getState().getMediaAvailability(plexMediaKey);
      if (isPassiveProviderResolutionComplete(hasKnownProvider, Boolean(latestSnapshot?.fresh))) {
        updateProviderState(resolvePassiveProviderState(
          providerKey,
          latestSnapshot?.provider,
          latestPlexInfo,
        ));
        finishLoading();
        return;
      }

      if (!latestSnapshot?.provider && !latestPlexInfo?.available) startLoadingIfNeeded();

      tmdb.getWatchProviders(numericTmdbId, mediaType).then(res => {
        if (!res.ok || !res.value) {
          finishLoading();
          return;
        }

        // Le payload TMDB public est stable et peut survivre aux démontages de cartes.
        // La disponibilité Plex reste dans son cache UID séparé et n'est jamais persistée ici.
        writeWatchProviderCache(numericTmdbId, mediaType, res.value, {
          retention: retainInLibraryCache ? 'library' : 'discovery',
        });
        applyAuthoritativeTmdbPayload(res.value);
      }).catch(() => {
        finishLoading();
      });
    };

    stopObserving = observeWatchProviderCard(cardRef.current, () => {
      const latestSnapshot = hasKnownProvider
        ? null
        : readCachedProviderSnapshot(numericTmdbId, mediaType);
      if (!onEnrich && isPassiveProviderResolutionComplete(hasKnownProvider, Boolean(latestSnapshot?.fresh))) {
        updateProviderState(resolvePassiveProviderState(
          providerKey,
          latestSnapshot?.provider,
          usePlexAvailabilityStore.getState().getMediaAvailability(plexMediaKey),
        ));
        finishLoading();
        return;
      }
      startLoadingIfNeeded();
      cancelScheduledEnrichment = scheduleWatchProviderCardEnrichment(enrichProvider);
    });

    return () => {
      isMounted = false;
      stopObserving();
      cancelScheduledEnrichment();
    };
  }, [cachedPlexInfo, hasKnownProvider, mediaType, numericTmdbId, onEnrich, plexMediaKey, providerKey, retainInLibraryCache, validTmdbId]);

  return {
    cardRef,
    providerLogo: currentProviderState.logo,
    providerName: currentProviderState.name,
    isProviderLoading,
  };
}
