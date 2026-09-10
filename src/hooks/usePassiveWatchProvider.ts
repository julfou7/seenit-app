import { useEffect, useRef, useState } from 'react';
import { tmdb } from '../features/shows/tmdb';
import { checkPlexAvailability } from '../features/plex/plexAvailability';
import {
  observeWatchProviderCard,
  scheduleWatchProviderCardEnrichment,
} from '../features/providers/watchProviderRequestPolicy';
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
  const [providerLogo, setProviderLogo] = useState<string | null>(null);
  const [providerName, setProviderName] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    let cancelScheduledEnrichment = () => {};
    let stopObserving = () => {};
    setProviderLogo(null);
    setProviderName(null);

    const numericTmdbId = Number(tmdbId);
    if (!cardRef.current || !Number.isFinite(numericTmdbId) || numericTmdbId <= 0) {
      return () => { isMounted = false; };
    }

    const enrichProvider = () => {
      onEnrich?.();
      if (hasKnownProvider) return;

      tmdb.getWatchProviders(numericTmdbId, mediaType).then(res => {
        if (!isMounted) return;
        const stream = res.ok && res.value?.results
          ? extractOfficialStreamingProvider(res.value.results)
          : null;
        if (stream) {
          setProviderLogo(stream.logo_path);
          setProviderName(stream.provider_name);
          return;
        }

        checkPlexAvailability({
          tmdbId: numericTmdbId,
          title,
          originalTitle,
          year,
          mediaType,
        }).then(plexInfo => {
          if (!isMounted || !plexInfo.available) return;
          setProviderLogo(PLEX_LOGO_SVG);
          setProviderName(plexInfo.serverName ? `Plex (${plexInfo.serverName})` : 'Plex');
        }).catch(() => {});
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
  }, [hasKnownProvider, mediaType, onEnrich, originalTitle, title, tmdbId, year]);

  return { cardRef, providerLogo, providerName };
}
