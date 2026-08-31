/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { lazy, Suspense, startTransition, useCallback, useState, useEffect, useRef } from 'react';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { SplashScreen as CapSplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { auth, db, syncGrantedNotificationDevice } from './lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { LoginScreen } from './screens/LoginScreen';
import { SplashScreen } from './components/SplashScreen';

import { BottomNav } from './components/BottomNav';
import { ToastContainer } from './components/ToastContainer';
import { PWAInstallBanner } from './components/PWAInstallBanner';
import { AppUpdateBanner } from './components/AppUpdateBanner';
import { useNavigation } from './features/navigation/useNavigation';
import { useDetailsSyncWorker } from './hooks/useDetailsSyncWorker';
import { useRemindersNotifier } from './hooks/useRemindersNotifier';
import { useSyncStore } from './store/syncStore';
import { useShows } from './hooks/useShows';
import { useShowsStore } from './store/showsStore';
import { useToastStore } from './store/toastStore';
import { markEpisodeWatched } from './features/shows/markEpisodeWatched';
import { cn } from './lib/utils';
import { cleanOldCache } from './db/dexie';
import './store/showsStore';
import { activatePlexUserScope } from './features/plex/plexStorage';
import { usePlexAvailabilityStore } from './features/plex/plexAvailability';
import { readUserScopedJson, writeUserScopedJson } from './lib/userIsolation';
import { activateLogUserScope } from './store/logStore';
import { createCachedAsyncLoader, preloadInBackground } from './features/navigation/screenPreload';

const loadProfileScreen = createCachedAsyncLoader(() => import('./screens/ProfileScreen').then(module => ({ default: module.ProfileScreen })));
const loadShowDetailScreen = createCachedAsyncLoader(() => import('./screens/ShowDetailScreen').then(module => ({ default: module.ShowDetailScreen })));
const loadWatchListScreen = createCachedAsyncLoader(() => import('./screens/WatchListScreen').then(module => ({ default: module.WatchListScreen })));
const loadDiscoverScreen = createCachedAsyncLoader(() => import('./screens/DiscoverScreen').then(module => ({ default: module.DiscoverScreen })));
const loadDownloadsScreen = createCachedAsyncLoader(() => import('./screens/DownloadsScreen').then(module => ({ default: module.DownloadsScreen })));

const ProfileScreen = lazy(loadProfileScreen);
const ShowDetailScreen = lazy(loadShowDetailScreen);
const WatchListScreen = lazy(loadWatchListScreen);
const DiscoverScreen = lazy(loadDiscoverScreen);
const DownloadsScreen = lazy(loadDownloadsScreen);

const privateScreenPreloaders = [
  loadWatchListScreen,
  loadProfileScreen,
  loadDiscoverScreen,
  loadDownloadsScreen,
  loadShowDetailScreen
];

const tabScreenPreloaders: Record<string, () => Promise<unknown>> = {
  watchlist: loadWatchListScreen,
  library: loadWatchListScreen,
  profile: loadProfileScreen,
  settings: loadProfileScreen,
  discover: loadDiscoverScreen,
  downloads: loadDownloadsScreen
};

export default function App() {
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null | undefined>(undefined);
  
  const isNative = Capacitor.isNativePlatform();

  const isPWAStandalone = typeof window !== 'undefined' && (
    window.matchMedia('(display-mode: standalone)').matches || 
    (window.navigator as any).standalone === true
  );

  const [showSplash, setShowSplash] = useState(true);
  const [isSplashClosing, setIsSplashClosing] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      activateLogUserScope(user?.uid);
      if (activatePlexUserScope(user?.uid)) {
        usePlexAvailabilityStore.getState().clearCache();
      }
      setCurrentUser(user);
      if (user) {
        void syncGrantedNotificationDevice();
        try {
          const prefRef = doc(db, 'users', user.uid, 'settings', 'preferences');
          const snap = await getDoc(prefRef);
          const localPlatforms = readUserScopedJson<number[]>(user.uid, 'platforms', []);

          if (snap.exists() && Array.isArray(snap.data()?.platforms)) {
            const cloudPlatforms: number[] = snap.data().platforms;
            writeUserScopedJson(user.uid, 'platforms', cloudPlatforms);
            window.dispatchEvent(new Event('storage'));
          } else if (localPlatforms.length > 0) {
            await setDoc(prefRef, { platforms: localPlatforms }, { merge: true });
          }
        } catch (e: any) {
          const errorMessage = e?.message || String(e);
          const isOffline = !navigator.onLine || 
                            errorMessage.toLowerCase().includes('offline') || 
                            e?.code === 'unavailable';
          if (isOffline) {
            console.warn('[App] Client is offline, using local cached streaming platforms:', errorMessage);
          } else {
            console.error('[App] Error syncing user streaming platforms from cloud', e);
          }
        }
      }
    });
    return unsub;
  }, []);

  const isReady = currentUser !== undefined;

  useEffect(() => {
    if (!currentUser) return;
    void preloadInBackground(privateScreenPreloaders);
  }, [currentUser]);

  useEffect(() => {
    if (isNative) {
      StatusBar.setStyle({ style: Style.Light }).catch(() => {});
      StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
      StatusBar.setBackgroundColor({ color: '#040406' }).catch(() => {});

      const animFrame = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          CapSplashScreen.hide().catch(() => {});
        });
      });
      return () => cancelAnimationFrame(animFrame);
    }
  }, [isNative]);

  const splashDuration = 2200;

  return (
    <>
      {showSplash && (
        <SplashScreen 
          isReady={isReady}
          minimumDisplayTime={splashDuration}
          animate={true}
          onStartClose={() => setIsSplashClosing(true)}
          onComplete={() => setShowSplash(false)} 
        />
      )}
      
      {isReady && isSplashClosing ? (
        currentUser === null ? <LoginScreen /> : <MainApp />
      ) : (
        <div className="w-full min-h-[100dvh] bg-[#040406]" />
      )}
    </>
  );
}

function MainApp() {
  const { updateShow } = useShows();
  const shows = useShowsStore(state => state.shows);
  const showToast = useToastStore(state => state.showToast);
  const processedActionsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    useSyncStore.getState().resetQuotaError();
    cleanOldCache();
  }, []);

  useDetailsSyncWorker();
  useRemindersNotifier();
  const { currentTab, changeTab, selectedShow, openShow, closeShow } = useNavigation();
  const [mountedTabs, setMountedTabs] = useState<Set<string>>(() => new Set(['watchlist', currentTab]));

  const handleTabChange = useCallback((tab: Parameters<typeof changeTab>[0]) => {
    void tabScreenPreloaders[tab]?.();
    startTransition(() => {
      setMountedTabs(previous => {
        if (previous.has(tab)) return previous;
        const next = new Set(previous);
        next.add(tab);
        return next;
      });
      changeTab(tab);
    });
  }, [changeTab]);

  const openShowSmooth = useCallback((
    id: any,
    type: 'local' | 'tmdb' = 'local',
    mediaType?: 'tv' | 'movie',
    tmdbId?: number,
    initialSeason?: number,
    initialEpisode?: number
  ) => {
    void loadShowDetailScreen();
    startTransition(() => {
      openShow(id, type, mediaType, tmdbId, initialSeason, initialEpisode);
    });
  }, [openShow]);

  useEffect(() => {
    setMountedTabs(previous => {
      if (previous.has(currentTab)) return previous;
      const next = new Set(previous);
      next.add(currentTab);
      return next;
    });
  }, [currentTab]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let listenerHandler: any = null;

    const setupBackButton = async () => {
      listenerHandler = await CapApp.addListener('backButton', ({ canGoBack }) => {
        const state = window.history.state;
        const isModalOpen = Boolean(
          state?.isModal || 
          state?.isEpisodeDetailModal || 
          state?.isPersonDetailModal
        );

        if (isModalOpen) {
          window.history.back();
          return;
        }

        if (selectedShow) {
          closeShow();
          return;
        }

        if (canGoBack && state && !state.isRoot) {
          window.history.back();
          return;
        }

        if (currentTab !== 'watchlist') {
          changeTab('watchlist');
          return;
        }

        CapApp.exitApp();
      });
    };

    setupBackButton();

    return () => {
      if (listenerHandler) {
        listenerHandler.remove();
      }
    };
  }, [selectedShow, closeShow, currentTab, changeTab]);

  useEffect(() => {
    const checkUrlParams = () => {
      if (typeof window === 'undefined') return;
      if (!window.location.search || window.location.search.length <= 1) return;

      const urlParams = new URLSearchParams(window.location.search);
      const showId = urlParams.get('showId');
      const tmdbId = urlParams.get('tmdbId');
      const action = urlParams.get('action');
      const season = urlParams.get('season');
      const episode = urlParams.get('episode');
      const mediaType = (urlParams.get('mediaType') as 'tv' | 'movie') || 'tv';
      const effectiveId = showId || tmdbId;

      if (!effectiveId) return;

      const cleanPath = window.location.pathname;
      window.history.replaceState({ tab: 'watchlist' }, '', cleanPath);

      const actionKey = `${effectiveId}_${action}_${season}_${episode}_${Date.now().toString().slice(0, -3)}`;
      if (processedActionsRef.current.has(actionKey)) return;
      processedActionsRef.current.add(actionKey);

      if (action === 'mark_watched') {
        if (season && episode) {
          markEpisodeWatched(effectiveId, Number(season), Number(episode), updateShow);
        }
        openShowSmooth(
          effectiveId, 
          'local', 
          mediaType, 
          tmdbId ? Number(tmdbId) : undefined, 
          season ? Number(season) : undefined, 
          episode ? Number(episode) : undefined
        );
      } else {
        openShowSmooth(
          effectiveId, 
          'local', 
          mediaType, 
          tmdbId ? Number(tmdbId) : undefined, 
          season ? Number(season) : undefined, 
          episode ? Number(episode) : undefined
        );
      }
    };

    checkUrlParams();

    const handleNotificationMessage = (data: any) => {
      if (!data) return;

      if (data.type === 'NAVIGATE_SHOW') {
        const idToOpen = data.showId || data.tmdbId;
        if (idToOpen) {
          openShowSmooth(
            idToOpen, 
            'local', 
            data.mediaType || 'tv', 
            data.tmdbId ? Number(data.tmdbId) : undefined,
            data.season ? Number(data.season) : undefined,
            data.episode ? Number(data.episode) : undefined
          );
        }
      }

      if (data.type === 'QUICK_ACTION_MARK_WATCHED') {
        const idToWatch = data.showId || data.tmdbId;
        const season = data.season;
        const episode = data.episode;
        
        if (idToWatch && season && episode) {
          markEpisodeWatched(idToWatch, Number(season), Number(episode), updateShow);
        }

        if (idToWatch) {
          openShowSmooth(
            idToWatch,
            'local',
            data.mediaType || 'tv',
            data.tmdbId ? Number(data.tmdbId) : undefined,
            season ? Number(season) : undefined,
            episode ? Number(episode) : undefined
          );
        }
      }
    };

    const handleSWMessage = (event: MessageEvent) => {
      handleNotificationMessage(event.data);
    };

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleSWMessage);
    }

    const handleCapacitorAction = (event: CustomEvent) => {
      if (event.detail) {
        handleNotificationMessage(event.detail);
      }
    };
    window.addEventListener('capacitor-notification-action' as any, handleCapacitorAction);

    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('app_notifications');
      bc.onmessage = (event) => {
        handleNotificationMessage(event.data);
      };
    } catch (e) {}

    const handleVisibilityOrFocus = () => {
      checkUrlParams();
      if (document.visibilityState === 'visible' && auth.currentUser) {
        useShowsStore.getState().fetchShows();
      }
    };

    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    return () => {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleSWMessage);
      }
      if (bc) {
        bc.close();
      }
      window.removeEventListener('capacitor-notification-action' as any, handleCapacitorAction);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [openShowSmooth, updateShow, showToast]);

  const handleActiveTabClick = () => {
    window.dispatchEvent(new CustomEvent('app-close-modals'));

    if (
      typeof window !== 'undefined' &&
      (window.history.state?.isModal ||
        window.history.state?.isEpisodeDetailModal ||
        window.history.state?.isPersonDetailModal)
    ) {
      window.history.back();
    } else if (selectedShow) {
      closeShow();
    }
  };

  const handleActiveTabDoubleClick = () => {
    const scrollableElements = document.querySelectorAll('.overflow-y-auto, .custom-scrollbar, [style*="overflow-y: auto"]');
    scrollableElements.forEach(el => {
      try {
        if (typeof el.scrollTo === 'function') {
          el.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
          el.scrollTop = 0;
        }
      } catch (e) {
        el.scrollTop = 0;
      }
    });

    if (currentTab === 'discover') {
      window.dispatchEvent(new CustomEvent('discover-reset-all'));
    }
    if (currentTab === 'profile') {
      window.dispatchEvent(new CustomEvent('profile-reset-all'));
    }
  };

  return (
    <div className="w-full min-h-[100dvh] bg-[#040406] flex justify-center selection:bg-[#E5A93D]/30">
      <div className="w-full max-w-md bg-premium-ambient h-[100dvh] flex flex-col relative shadow-2xl shadow-black/90 overflow-hidden pt-safe">
        
        <PWAInstallBanner />
        <AppUpdateBanner />
        
        <div className="flex-1 min-h-0 flex flex-col relative">
          <div className="flex-1 min-h-0 flex flex-col">
            <Suspense fallback={<div className="flex-1 bg-premium-ambient" aria-label="Chargement de l’écran" />}>
              {mountedTabs.has('watchlist') && (
                <div className={cn("flex-1 min-h-0 flex flex-col", currentTab !== 'watchlist' && "hidden")}>
                  <WatchListScreen onShowClick={(id, mediaType) => openShowSmooth(id, 'local', mediaType)} />
                </div>
              )}

              {(mountedTabs.has('profile') || mountedTabs.has('settings')) && (
                <div className={cn("flex-1 min-h-0 flex flex-col", (currentTab !== 'profile' && currentTab !== 'settings') && "hidden")}>
                  <ProfileScreen
                    initialShowSettings={currentTab === 'settings'}
                    onShowClick={(id, mediaType) => openShowSmooth(id, 'tmdb', mediaType)}
                  />
                </div>
              )}

              {mountedTabs.has('discover') && (
                <div className={cn("flex-1 min-h-0 flex flex-col", currentTab !== 'discover' && "hidden")}>
                  <DiscoverScreen onShowClick={(id, mediaType) => openShowSmooth(id, 'tmdb', mediaType)} />
                </div>
              )}

              {mountedTabs.has('downloads') && (
                <div className={cn("flex-1 min-h-0 flex flex-col", currentTab !== 'downloads' && "hidden")}>
                  <DownloadsScreen onShowClick={(id, mediaType) => openShowSmooth(id, 'tmdb', mediaType)} />
                </div>
              )}
            </Suspense>
          </div>

          {selectedShow && (
            <div 
              className="fixed inset-0 z-[150] bg-black flex flex-col overflow-hidden max-w-md mx-auto animate-in fade-in slide-in-from-bottom-6 duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] animate-overlay-in pt-safe"
              style={{ willChange: 'transform, opacity' }}
            >
              <Suspense fallback={<div className="flex-1 bg-premium-ambient" aria-label="Chargement de la fiche" />}>
                <ShowDetailScreen
                  key={`${selectedShow.id}-${selectedShow.mediaType || 'tv'}`}
                  showId={selectedShow.type === 'local' ? String(selectedShow.id) : undefined}
                  tmdbId={selectedShow.type === 'tmdb' ? Number(selectedShow.id) : (selectedShow.tmdbId ? Number(selectedShow.tmdbId) : undefined)}
                  mediaType={selectedShow.mediaType}
                  initialSeason={selectedShow.initialSeason}
                  initialEpisode={selectedShow.initialEpisode}
                  onBack={closeShow}
                  onShowClick={(id, mediaType) => openShowSmooth(id, 'tmdb', mediaType)}
                />
              </Suspense>
            </div>
          )}
        </div>

        <BottomNav 
          currentTab={currentTab} 
          onTabChange={handleTabChange}
          onActiveTabClick={handleActiveTabClick}
          onActiveTabDoubleClick={handleActiveTabDoubleClick}
        />

        <ToastContainer />
      </div>
    </div>
  );
}
