import { useEffect, useRef, useState, useCallback } from 'react';
import { useShowsStore } from '../../store/showsStore';
import { useDownloadConfigStore } from '../../store/downloadConfigStore';
import { isDownloadFeatureEnabled, resolveDownloadAwareTab } from '../downloads/downloadFeatureVisibility';

type AppTab = 'watchlist' | 'library' | 'discover' | 'downloads' | 'settings' | 'profile';

export function useNavigation() {
  const downloadsEnabled = useDownloadConfigStore(isDownloadFeatureEnabled);
  const downloadsEnabledRef = useRef(downloadsEnabled);

  const getInitialState = () => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const showId = urlParams.get('showId');
      const tmdbId = urlParams.get('tmdbId');
      const mediaType = (urlParams.get('mediaType') as 'tv' | 'movie') || 'tv';
      const effectiveId = showId || tmdbId;

      if (effectiveId) {
        const season = urlParams.get('season');
        const episode = urlParams.get('episode');
        const requestedTab = (urlParams.get('tab') as AppTab) || 'watchlist';
        return {
          tab: resolveDownloadAwareTab(requestedTab, downloadsEnabled) as AppTab,
          selectedShow: {
            id: effectiveId,
            type: 'local' as const,
            mediaType,
            tmdbId: tmdbId ? Number(tmdbId) : undefined,
            initialSeason: season ? Number(season) : undefined,
            initialEpisode: episode ? Number(episode) : undefined
          }
        };
      }

      if (window.history.state) {
        return {
          tab: resolveDownloadAwareTab((window.history.state.tab || 'watchlist') as AppTab, downloadsEnabled) as AppTab,
          selectedShow: window.history.state.selectedShow || null
        };
      }
    }
    return { tab: 'watchlist' as AppTab, selectedShow: null };
  };

  const initialState = getInitialState();
  const [currentTab, setCurrentTab] = useState<AppTab>(initialState.tab);
  const [selectedShow, setSelectedShow] = useState<{ id: any, type: 'local' | 'tmdb', mediaType?: 'tv' | 'movie', tmdbId?: number, initialSeason?: number, initialEpisode?: number } | null>(initialState.selectedShow);

  useEffect(() => {
    downloadsEnabledRef.current = downloadsEnabled;
    if (!downloadsEnabled && currentTab === 'downloads') {
      setCurrentTab('watchlist');
      setSelectedShow(null);
      window.history.replaceState({ tab: 'watchlist', selectedShow: null, isRoot: true }, '');
    }
  }, [downloadsEnabled, currentTab]);

  useEffect(() => {
    if (!window.history.state) {
      window.history.replaceState({ 
        tab: initialState.tab, 
        selectedShow: initialState.selectedShow,
        isRoot: !initialState.selectedShow 
      }, '');
    } else if (window.history.state.tab === 'downloads' && !downloadsEnabledRef.current) {
      window.history.replaceState({ tab: 'watchlist', selectedShow: null, isRoot: true }, '');
    }

    const handlePopState = (e: PopStateEvent) => {
      if (e.state && e.state.selectedShow !== undefined) {
        setSelectedShow(e.state.selectedShow);
      } else {
        setSelectedShow(null);
      }
      
      if (e.state && e.state.tab) {
        const resolvedTab = resolveDownloadAwareTab(e.state.tab as AppTab, downloadsEnabledRef.current) as AppTab;
        setCurrentTab(resolvedTab);
        if (resolvedTab !== e.state.tab) {
          setSelectedShow(null);
          window.history.replaceState({ tab: 'watchlist', selectedShow: null, isRoot: true }, '');
        }
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const changeTab = useCallback((tab: AppTab) => {
    window.dispatchEvent(new CustomEvent('app-close-modals'));
    const resolvedTab = resolveDownloadAwareTab(tab, downloadsEnabled) as AppTab;
    setCurrentTab(resolvedTab);
    setSelectedShow(null);
    window.history.pushState({ tab: resolvedTab, selectedShow: null, isRoot: resolvedTab === 'watchlist' }, '');
  }, [downloadsEnabled]);

  const openShow = useCallback((id: any, type: 'local' | 'tmdb' = 'local', mediaType?: 'tv' | 'movie', tmdbId?: number, initialSeason?: number, initialEpisode?: number) => {
    let resolvedTmdbId = tmdbId;
    let resolvedMediaType = mediaType;

    if (type === 'local') {
      const found = useShowsStore.getState().shows.find(s => String(s.id) === String(id) || String(s.tmdbId) === String(id));
      if (found) {
        if (!resolvedTmdbId && found.tmdbId) {
          resolvedTmdbId = Number(found.tmdbId);
        }
        if (!resolvedMediaType && found.mediaType) {
          resolvedMediaType = found.mediaType;
        }
      }
    } else if (type === 'tmdb') {
      if (!resolvedTmdbId && !isNaN(Number(id))) {
        resolvedTmdbId = Number(id);
      }
    }

    const showState = { id, type, mediaType: resolvedMediaType, tmdbId: resolvedTmdbId, initialSeason, initialEpisode };
    const currentSelected = window.history.state?.selectedShow;
    if (
      currentSelected &&
      (
        (currentSelected.id && String(currentSelected.id) === String(id)) ||
        (currentSelected.tmdbId && resolvedTmdbId && Number(currentSelected.tmdbId) === Number(resolvedTmdbId))
      ) &&
      currentSelected.initialSeason === initialSeason &&
      currentSelected.initialEpisode === initialEpisode
    ) {
      setSelectedShow(showState);
      return;
    }

    setSelectedShow(showState);
    (window as any).isNavigatingForward = true;
    window.history.pushState({ tab: currentTab, selectedShow: showState, isRoot: false }, '');
    setTimeout(() => {
       (window as any).isNavigatingForward = false;
    }, 100);
  }, [currentTab]);

  const closeShow = useCallback(() => {
    setSelectedShow(null);
    if (window.history.state && window.history.state.selectedShow) {
      window.history.back();
    }
  }, []);

  return {
    currentTab,
    changeTab,
    selectedShow,
    openShow,
    closeShow
  };
}
