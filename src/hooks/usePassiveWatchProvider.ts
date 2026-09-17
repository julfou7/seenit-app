import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
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
import {
  hydratePreferredProviderIds,
  normalizePreferredProviderIds,
} from '../features/providers/providerPreferences';
import { extractOfficialStreamingProvider } from '../utils/providerLogos';
import { auth } from '../lib/firebase';
import { readUserScopedJson, subscribeUserScopedStorageField } from '../lib/userIsolation';

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
  preferredProviderIds: readonly number[],
): CachedProviderSnapshot | null {
  const memoryData = tmdb.peekWatchProviders(tmdbId, mediaType);
  if (memoryData) {
    return {
      data: memoryData,
      fresh: true,
      provider: extractOfficialStreamingProvider(memoryData?.results, preferredProviderIds),
    };
  }

  const persisted = readWatchProviderCache(tmdbId, mediaType, { allowStale: true });
  if (!persisted) return null;

  return {
    data: persisted.data,
    fresh: persisted.fresh,
    provider: extractOfficialStreamingProvider(persisted.data?.results, preferredProviderIds),
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
  const currentUid = auth.currentUser?.uid ?? null;
  const subscribeToPlatformPreferences = useCallback(
    (listener: () => void) => subscribeUserScopedStorageField(currentUid, 'platforms', listener),
    [currentUid],
  );
  const readPlatformPreferencesSnapshot = useCallback(
    () => JSON.stringify(readUserScopedJson<number[]>(currentUid, 'platforms', [])),
    [currentUid],
  );
  const readServerPlatformPreferencesSnapshot = useCallback(() => '[]', []);
  const serializedPreferredProviderIds = useSyncExternalStore(
    subscribeToPlatformPreferences,
    readPlatformPreferencesSnapshot,
    readServerPlatformPreferencesSnapshot,
  );
  const preferredProviderIds = normalizePreferredProviderIds(
    JSON.parse(serializedPreferredProviderIds) as number[],
  );
  const preferredProviderKey = preferredProviderIds.join(',');
  const providerKey = validTmdbId
    ? `${getProviderKey(numericTmdbId, mediaType)}:prefs:${preferredProviderKey}`
    : `${mediaType}:invalid:prefs:${preferredProviderKey}`;
  const plexMediaKey = getPlexMediaKey(validTmdbId ? numericTmdbId : null, mediaType);
  const cachedPlexInfo = usePlexAvailabilityStore(state => validTmdbId && !hasKnownProvider
    ? state.cache[plexMediaKey]
    : undefined);
  const renderSnapshot = validTmdbId && !hasKnownProvider
    ? readCachedProviderSnapshot(numericTmdbId, mediaType, preferredProviderIds)
    : null;
  const renderProviderState = resolvePassiveProviderState(
    providerKey,
    renderSnapshot?.provider,
    cachedPlexInfo,
    Boolean(renderSnapshot?.fresh),
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
    if (!currentUid) return;
    // `Mes plateformes` est une préférence de compte, pas une donnée de l’écran
    // Réglages. Une WebView fraîche/mise à niveau doit l’hydrater avant de figer
    // une décision Plex à partir de son seul cache local.
    void hydratePreferredProviderIds(currentUid).catch(() => undefined);
  }, [currentUid]);

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
      const latestSnapshot = readCachedProviderSnapshot(numericTmdbId, mediaType, preferredProviderIds);
      if (!latestSnapshot?.fresh) {
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
      : readCachedProviderSnapshot(numericTmdbId, mediaType, preferredProviderIds);
    updateProviderState(resolvePassiveProviderState(
      providerKey,
      initialSnapshot?.provider,
      usePlexAvailabilityStore.getState().getMediaAvailability(plexMediaKey),
      Boolean(initialSnapshot?.fresh),
    ));
    finishLoading();

    const applyAuthoritativeTmdbPayload = (payload: any) => {
      if (!isMounted) return;
      const stream = payload?.results
        ? extractOfficialStreamingProvider(payload.results, preferredProviderIds)
        : null;
      updateProviderState(resolvePassiveProviderState(
        providerKey,
        stream,
        usePlexAvailabilityStore.getState().getMediaAvailability(plexMediaKey),
        true,
      ));
      finishLoading();
    };

    const enrichProvider = () => {
      onEnrich?.();
      if (hasKnownProvider) {
        finishLoading();
        return;
      }

      const latestSnapshot = readCachedProviderSnapshot(numericTmdbId, mediaType, preferredProviderIds);
      const latestPlexInfo = usePlexAvailabilityStore.getState().getMediaAvailability(plexMediaKey);
      if (isPassiveProviderResolutionComplete(hasKnownProvider, Boolean(latestSnapshot?.fresh))) {
        updateProviderState(resolvePassiveProviderState(
          providerKey,
          latestSnapshot?.provider,
          latestPlexInfo,
          true,
        ));
        finishLoading();
        return;
      }

      startLoadingIfNeeded();

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
        : readCachedProviderSnapshot(numericTmdbId, mediaType, preferredProviderIds);
      if (!onEnrich && isPassiveProviderResolutionComplete(hasKnownProvider, Boolean(latestSnapshot?.fresh))) {
        updateProviderState(resolvePassiveProviderState(
          providerKey,
          latestSnapshot?.provider,
          usePlexAvailabilityStore.getState().getMediaAvailability(plexMediaKey),
          true,
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
  }, [cachedPlexInfo, hasKnownProvider, mediaType, numericTmdbId, onEnrich, plexMediaKey, preferredProviderKey, providerKey, retainInLibraryCache, validTmdbId]);

  return {
    cardRef,
    providerLogo: currentProviderState.logo,
    providerName: currentProviderState.name,
    isProviderLoading,
  };
}
