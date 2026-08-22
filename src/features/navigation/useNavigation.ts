import { useEffect, useState, useCallback } from 'react';
import { useShowsStore } from '../../store/showsStore';

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
