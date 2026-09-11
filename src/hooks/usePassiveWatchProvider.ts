import { useEffect, useRef, useState } from 'react';
import { tmdb } from '../features/shows/tmdb';
import { checkPlexAvailability } from '../features/plex/plexAvailability';
import {
  observeWatchProviderCard,
  scheduleWatchProviderCardEnrichment,
} from '../features/providers/watchProviderRequestPolicy';
import {
  readWatchProviderCache,
  writeWatchProviderCache,
} from '../features/providers/watchProviderCache';
import { extractOfficialStreamingProvider, PLEX_LOGO_SVG } from '../utils/providerLogos';

interface PassiveWatchProviderParams {
  tmdbId?: number | string | null;
  mediaType: 'movie' | 'tv';
  title?: string;
  originalTitle?: string;
  year?: number | string;
  hasKnownProvider?: boolean;
  onEnrich?: () => void;
}

type OfficialProvider = ReturnType<typeof extractOfficialStreamingProvider>;

type CachedProviderSnapshot = {
  data: any;
  fresh: boolean;
  provider: OfficialProvider;
};

type ProviderState = {
  key: string;
  logo: string | null;
  name: string | null;
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

function toProviderState(key: string, provider: OfficialProvider): ProviderState {
  return {
    key,
    logo: provider?.logo_path || null,
    name: provider?.provider_name || null,
  };
}

export function usePassiveWatchProvider({
  tmdbId,
  mediaType,
  title,
  originalTitle,
  year,
  hasKnownProvider = false,
  onEnrich,
}: PassiveWatchProviderParams) {
  const cardRef = useRef<HTMLDivElement>(null);
  const numericTmdbId = Number(tmdbId);
  const validTmdbId = Number.isFinite(numericTmdbId) && numericTmdbId > 0;
  const providerKey = validTmdbId ? getProviderKey(numericTmdbId, mediaType) : `${mediaType}:invalid`;
  const renderSnapshot = validTmdbId && !hasKnownProvider
    ? readCachedProviderSnapshot(numericTmdbId, mediaType)
    : null;
  const renderProviderState = toProviderState(providerKey, renderSnapshot?.provider || null);
  const [providerState, setProviderState] = useState<ProviderState>(() => renderProviderState);
  const [loadingState, setLoadingState] = useState<ProviderLoadingState>(() => ({
    key: providerKey,
    loading: false,
  }));

  const currentProviderState = providerState.key === providerKey
    ? providerState
    : renderProviderState;
  const isProviderLoading = loadingState.key === providerKey && loadingState.loading;

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

    const finishLoading = () => {
      if (isMounted) setLoadingState({ key: providerKey, loading: false });
    };

    const startLoadingIfNeeded = () => {
      if (!isMounted || hasKnownProvider) return;
      const latestSnapshot = readCachedProviderSnapshot(numericTmdbId, mediaType);
      if (!latestSnapshot?.provider) {
        setLoadingState({ key: providerKey, loading: true });
      }
    };

    if (!cardRef.current || !validTmdbId) {
      setProviderState(toProviderState(providerKey, null));
      finishLoading();
      return () => { isMounted = false; };
    }

    const initialSnapshot = hasKnownProvider
      ? null
      : readCachedProviderSnapshot(numericTmdbId, mediaType);
    setProviderState(toProviderState(providerKey, initialSnapshot?.provider || null));
    finishLoading();

    const showPlexFromCache = async () => {
      try {
        const plexInfo = await checkPlexAvailability({
          tmdbId: numericTmdbId,
          title,
          originalTitle,
          year,
          mediaType,
        });
        if (!isMounted || !plexInfo.available) return;
        setProviderState({
          key: providerKey,
          logo: PLEX_LOGO_SVG,
          name: plexInfo.serverName ? `Plex (${plexInfo.serverName})` : 'Plex',
        });
      } catch {
        // Une disponibilité Plex passive est cache-only : une erreur termine simplement l'état de recherche.
      } finally {
        finishLoading();
      }
    };

    const applyAuthoritativeTmdbPayload = async (payload: any) => {
      if (!isMounted) return;
      const stream = payload?.results
        ? extractOfficialStreamingProvider(payload.results)
        : null;
      setProviderState(toProviderState(providerKey, stream));
      if (stream) {
        finishLoading();
      } else {
        await showPlexFromCache();
      }
    };

    const enrichProvider = () => {
      onEnrich?.();
      if (hasKnownProvider) {
        finishLoading();
        return;
      }

      const latestSnapshot = readCachedProviderSnapshot(numericTmdbId, mediaType);
      if (latestSnapshot?.fresh) {
        if (latestSnapshot.provider) {
          if (isMounted) setProviderState(toProviderState(providerKey, latestSnapshot.provider));
          finishLoading();
        } else {
          startLoadingIfNeeded();
          void showPlexFromCache();
        }
        return;
      }

      if (!latestSnapshot?.provider) startLoadingIfNeeded();

      tmdb.getWatchProviders(numericTmdbId, mediaType).then(async res => {
        if (!res.ok || !res.value) {
          finishLoading();
          return;
        }

        // Le payload TMDB public est stable et peut survivre aux démontages de cartes.
        // La disponibilité Plex reste dans son cache UID séparé et n'est jamais persistée ici.
        writeWatchProviderCache(numericTmdbId, mediaType, res.value);
        await applyAuthoritativeTmdbPayload(res.value);
      }).catch(() => {
        finishLoading();
      });
    };

    stopObserving = observeWatchProviderCard(cardRef.current, () => {
      startLoadingIfNeeded();
      cancelScheduledEnrichment = scheduleWatchProviderCardEnrichment(enrichProvider);
    });

    return () => {
      isMounted = false;
      stopObserving();
      cancelScheduledEnrichment();
    };
  }, [hasKnownProvider, mediaType, numericTmdbId, onEnrich, originalTitle, providerKey, title, validTmdbId, year]);

  return {
    cardRef,
    providerLogo: currentProviderState.logo,
    providerName: currentProviderState.name,
    isProviderLoading,
  };
}