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

  const currentProviderState = providerState.key === providerKey
    ? providerState
    : renderProviderState;

  useEffect(() => {
    let isMounted = true;
    let cancelScheduledEnrichment = () => {};
    let stopObserving = () => {};

    if (!cardRef.current || !validTmdbId) {
      setProviderState(toProviderState(providerKey, null));
      return () => { isMounted = false; };
    }

    const initialSnapshot = hasKnownProvider
      ? null
      : readCachedProviderSnapshot(numericTmdbId, mediaType);
    setProviderState(toProviderState(providerKey, initialSnapshot?.provider || null));

    const showPlexFromCache = () => {
      checkPlexAvailability({
        tmdbId: numericTmdbId,
        title,
        originalTitle,
        year,
        mediaType,
      }).then(plexInfo => {
        if (!isMounted || !plexInfo.available) return;
        setProviderState({
          key: providerKey,
          logo: PLEX_LOGO_SVG,
          name: plexInfo.serverName ? `Plex (${plexInfo.serverName})` : 'Plex',
        });
      }).catch(() => {});
    };

    const applyAuthoritativeTmdbPayload = (payload: any) => {
      if (!isMounted) return;
      const stream = payload?.results
        ? extractOfficialStreamingProvider(payload.results)
        : null;
      setProviderState(toProviderState(providerKey, stream));
      if (!stream) showPlexFromCache();
    };

    const enrichProvider = () => {
      onEnrich?.();
      if (hasKnownProvider) return;

      const latestSnapshot = readCachedProviderSnapshot(numericTmdbId, mediaType);
      if (latestSnapshot?.fresh) {
        if (latestSnapshot.provider) {
          if (isMounted) setProviderState(toProviderState(providerKey, latestSnapshot.provider));
        } else {
          showPlexFromCache();
        }
        return;
      }

      tmdb.getWatchProviders(numericTmdbId, mediaType).then(res => {
        if (!res.ok || !res.value) return;

        // Le payload TMDB public est stable et peut survivre aux démontages de cartes.
        // La disponibilité Plex reste dans son cache UID séparé et n'est jamais persistée ici.
        writeWatchProviderCache(numericTmdbId, mediaType, res.value);
        applyAuthoritativeTmdbPayload(res.value);
      }).catch(() => {});
    };

    stopObserving = observeWatchProviderCard(cardRef.current, () => {
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
  };
}
