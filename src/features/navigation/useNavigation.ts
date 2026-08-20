import { useEffect, useState, useCallback } from 'react';

export function useNavigation() {
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
        return {
          tab: (urlParams.get('tab') as any) || 'watchlist',
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
          tab: window.history.state.tab || 'watchlist',
          selectedShow: window.history.state.selectedShow || null
        };
      }
    }
    return { tab: 'watchlist', selectedShow: null };
  };

  const initialState = getInitialState();
  const [currentTab, setCurrentTab] = useState<'watchlist' | 'library' | 'discover' | 'settings' | 'profile'>(initialState.tab);
  const [selectedShow, setSelectedShow] = useState<{ id: any, type: 'local' | 'tmdb', mediaType?: 'tv' | 'movie', tmdbId?: number, initialSeason?: number, initialEpisode?: number } | null>(initialState.selectedShow);

  useEffect(() => {
    if (!window.history.state) {
      window.history.replaceState({ 
        tab: initialState.tab, 
        selectedShow: initialState.selectedShow,
        isRoot: !initialState.selectedShow 
      }, '');
    }

    const handlePopState = (e: PopStateEvent) => {
      if (e.state && (e.state.isModal || e.state.isEpisodeDetailModal || e.state.isPersonDetailModal)) {
        return;
      }
      if (e.state && e.state.selectedShow !== undefined) {
        setSelectedShow(e.state.selectedShow);
      } else {
        setSelectedShow(null);
      }
      
      if (e.state && e.state.tab) {
        setCurrentTab(e.state.tab);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const changeTab = useCallback((tab: 'watchlist' | 'library' | 'discover' | 'settings' | 'profile') => {
    window.dispatchEvent(new CustomEvent('app-close-modals'));
    setCurrentTab(tab);
    setSelectedShow(null);
    window.history.pushState({ tab, selectedShow: null, isRoot: tab === 'watchlist' }, '');
  }, []);

  const openShow = useCallback((id: any, type: 'local' | 'tmdb' = 'local', mediaType?: 'tv' | 'movie', tmdbId?: number, initialSeason?: number, initialEpisode?: number) => {
    window.dispatchEvent(new CustomEvent('app-close-modals'));
    const showState = { id, type, mediaType, tmdbId, initialSeason, initialEpisode };
    setSelectedShow(showState);
    
    (window as any).isNavigatingForward = true;
    
    if (window.history.state?.isModal || window.history.state?.isEpisodeDetailModal || window.history.state?.isPersonDetailModal) {
       window.history.replaceState({ tab: currentTab, selectedShow: showState, isRoot: false }, '');
    } else {
       window.history.pushState({ tab: currentTab, selectedShow: showState, isRoot: false }, '');
    }
    
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
