/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */


import { useState, useEffect, useRef } from 'react';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { SplashScreen as CapSplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { auth, db } from './lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { LoginScreen } from './screens/LoginScreen';
import { SplashScreen } from './components/SplashScreen';

import { BottomNav } from './components/BottomNav';
import { ToastContainer } from './components/ToastContainer';
import { LibraryScreen } from './screens/LibraryScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { ShowDetailScreen } from './screens/ShowDetailScreen';
import { WatchListScreen } from './screens/WatchListScreen';
import { DiscoverScreen } from './screens/DiscoverScreen';
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


export default function App() {
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null | undefined>(undefined);
  
  const isNative = Capacitor.isNativePlatform();

  // Detect if app is launched as an installed PWA (where Android/iOS already shows native OS splash)
  const isPWAStandalone = typeof window !== 'undefined' && (
    window.matchMedia('(display-mode: standalone)').matches || 
    (window.navigator as any).standalone === true
  );

  const [showSplash, setShowSplash] = useState(true);
  const [isSplashClosing, setIsSplashClosing] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (user) {
        try {
          const prefRef = doc(db, 'users', user.uid, 'settings', 'preferences');
          const snap = await getDoc(prefRef);
          const localStr = localStorage.getItem('user_platforms');
          const localPlatforms = localStr ? JSON.parse(localStr) : [];

          if (snap.exists() && Array.isArray(snap.data()?.platforms)) {
            const cloudPlatforms: number[] = snap.data().platforms;
            localStorage.setItem('user_platforms', JSON.stringify(cloudPlatforms));
            window.dispatchEvent(new Event('storage'));
          } else if (localPlatforms.length > 0) {
            await setDoc(prefRef, { platforms: localPlatforms }, { merge: true });
          }
        } catch (e) {
          console.error('[App] Error syncing user streaming platforms from cloud', e);
        }
      }
    });
    return unsub;
  }, []);

  const isReady = currentUser !== undefined;

  // On native platform, hide the static OS splash screen quickly so the animated React splash takes over smoothly.
  // Also configure the status bar for dark mode to ensure icons (time, battery) are white.
  useEffect(() => {
    if (isNative) {
      StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
      StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
      StatusBar.setBackgroundColor({ color: '#040406' }).catch(() => {});

      // Hide native splash screen only AFTER React DOM frame is fully painted on screen
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
      
      {/* 
        CRITICAL PERFORMANCE OPTIMIZATION:
        We completely defer mounting the heavy MainApp (which downloads images, parses IndexedDB, and creates hundreds of DOM nodes) 
        until the splash screen has FINISHED its 2-second vector animation and is starting to fade out.
        This guarantees perfectly smooth 60fps/120fps CSS animations for the splash screen on all devices.
      */}
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
    // Nettoyage asynchrone du cache IndexedDB pour libérer de la mémoire
    cleanOldCache();
  }, []);


  useDetailsSyncWorker();
  useRemindersNotifier();
  const { currentTab, changeTab, selectedShow, openShow, closeShow } = useNavigation();

  // Gestion de la touche retour physique Android sur APK Native via Capacitor App
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let listenerHandler: any = null;

    const setupBackButton = async () => {
      listenerHandler = await CapApp.addListener('backButton', ({ canGoBack }) => {
        // 1. Fermer les sous-menus et fenêtres flottantes non gérées dans l'historique
        window.dispatchEvent(new CustomEvent('app-close-modals'));

        const state = window.history.state;
        const isModalOpen = Boolean(
          state?.isModal || 
          state?.isEpisodeDetailModal || 
          state?.isPersonDetailModal
        );

        // 2. Si une modale est ouverte (fiche épisode, personne, filtres...)
        if (isModalOpen) {
          window.history.back();
          return;
        }

        // 3. Si la fiche d'un média est ouverte
        if (selectedShow) {
          closeShow();
          return;
        }

        // 4. Si on peut revenir en arrière dans l'historique
        if (canGoBack && state && !state.isRoot) {
          window.history.back();
          return;
        }

        // 5. Si on est sur un onglet secondaire, retourner à l'onglet principal (watchlist)
        if (currentTab !== 'watchlist') {
          changeTab('watchlist');
          return;
        }

        // 6. Si on est sur l'écran racine principal, fermer/quitter l'application
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

  // Écouter les messages et actions provenant des notifications push Service Worker (BroadcastChannel + postMessage)
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

      // Nettoyer immédiatement l'URL pour ne jamais la re-traiter
      const cleanPath = window.location.pathname;
      window.history.replaceState({ tab: 'watchlist' }, '', cleanPath);

      const actionKey = `${effectiveId}_${action}_${season}_${episode}_${Date.now().toString().slice(0, -3)}`;
      if (processedActionsRef.current.has(actionKey)) return;
      processedActionsRef.current.add(actionKey);

      if (action === 'mark_watched') {
        if (season && episode) {
          markEpisodeWatched(effectiveId, Number(season), Number(episode), updateShow);
        }
        openShow(
          effectiveId, 
          'local', 
          mediaType, 
          tmdbId ? Number(tmdbId) : undefined, 
          season ? Number(season) : undefined, 
          episode ? Number(episode) : undefined
        );
      } else {
        // Clic d'ouverture simple : ouvrir la fiche / l'épisode SANS marquer comme vu
        openShow(
          effectiveId, 
          'local', 
          mediaType, 
          tmdbId ? Number(tmdbId) : undefined, 
          season ? Number(season) : undefined, 
          episode ? Number(episode) : undefined
        );
      }
    };

    // 1. Exécuter à l'initialisation
    checkUrlParams();

    // 2. Gestionnaire universel de messages notifications
    const handleNotificationMessage = (data: any) => {
      if (!data) return;

      if (data.type === 'NAVIGATE_SHOW') {
        const idToOpen = data.showId || data.tmdbId;
        if (idToOpen) {
          openShow(
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

        // Also open the show at the specific episode
        if (idToWatch) {
          openShow(
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

    // Écouteur Service Worker postMessage
    const handleSWMessage = (event: MessageEvent) => {
      handleNotificationMessage(event.data);
    };

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleSWMessage);
    }

    // Écouteur des notifications Capacitor natives (clic sur notification APK Android)
    const handleCapacitorAction = (event: CustomEvent) => {
      if (event.detail) {
        handleNotificationMessage(event.detail);
      }
    };
    window.addEventListener('capacitor-notification-action' as any, handleCapacitorAction);

    // Écouteur BroadcastChannel (ultra-fiable en PWA et arrière-plan)
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('app_notifications');
      bc.onmessage = (event) => {
        handleNotificationMessage(event.data);
      };
    } catch (e) {}

    // Écouter quand la fenêtre redevient active (retour d'arrière-plan Android)
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
  }, [openShow, updateShow, showToast]);

  const handleActiveTabClick = () => {
    // 1. Fermer toutes les modales ouvertes (fiche épisode, personne, filtres, trailers)
    window.dispatchEvent(new CustomEvent('app-close-modals'));

    // 2. Priorité à la fermeture de modale dans l'historique si on est dedans
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
    // Recherche de tous les conteneurs défilants pour les remonter tout en haut
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

    // Cas particulier : si on est sur l'onglet Explorer (discover), réinitialiser tous les filtres et tout remettre par défaut
    if (currentTab === 'discover') {
      window.dispatchEvent(new CustomEvent('discover-reset-all'));
    }
    // Cas onglet Profil : réinitialiser les réglages, modals et états Voir plus
    if (currentTab === 'profile') {
      window.dispatchEvent(new CustomEvent('profile-reset-all'));
    }
  };

  return (
    <div className="w-full min-h-[100dvh] bg-[#040406] flex justify-center selection:bg-[#E5A93D]/30">
      <div className="w-full max-w-md bg-premium-ambient h-[100dvh] flex flex-col relative shadow-2xl shadow-black/90 overflow-hidden pt-safe">
        
        {/* Banner PWA Install (S25 Ultra / Android / Chrome) */}
        <PWAInstallBanner />

        {/* In-App Automatic Update Checker Banner */}
        <AppUpdateBanner />
        
        {/* Main Content Area */}
        <div className="flex-1 min-h-0 flex flex-col relative">
          {/* 1. Écrans d'onglets principaux (Tous montés, visibilité basculée par CSS) */}
          <div className="flex-1 min-h-0 flex flex-col">
            <div className={cn("flex-1 min-h-0 flex flex-col", currentTab !== 'watchlist' && "hidden")}>
              <WatchListScreen onShowClick={(id, mediaType) => openShow(id, 'local', mediaType)} />
            </div>

            <div className={cn("flex-1 min-h-0 flex flex-col", currentTab !== 'library' && "hidden")}>
              <LibraryScreen onShowClick={(id, mediaType) => openShow(id, 'local', mediaType)} />
            </div>

            <div className={cn("flex-1 min-h-0 flex flex-col", currentTab !== 'discover' && "hidden")}>
              <DiscoverScreen onShowClick={(id, mediaType) => openShow(id, 'tmdb', mediaType)} />
            </div>

            <div className={cn("flex-1 min-h-0 flex flex-col", (currentTab !== 'profile' && currentTab !== 'settings') && "hidden")}>
              <ProfileScreen 
                initialShowSettings={currentTab === 'settings'} 
                onShowClick={(id, mediaType) => openShow(id, 'tmdb', mediaType)}
              />
            </div>
          </div>

          {/* 2. Vue Fiche Série (Overlay plein écran par-dessus l'onglet actif avec accélération GPU) */}
          {selectedShow && (
            <div 
              className="fixed inset-0 z-[60] bg-black flex flex-col overflow-hidden max-w-md mx-auto animate-in fade-in slide-in-from-bottom-6 duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] animate-overlay-in pt-safe"
              style={{ willChange: 'transform, opacity' }}
            >
              <ShowDetailScreen 
                key={`${selectedShow.id}-${selectedShow.mediaType || 'tv'}`}
                showId={selectedShow.type === 'local' ? String(selectedShow.id) : undefined}
                tmdbId={selectedShow.type === 'tmdb' ? Number(selectedShow.id) : (selectedShow.tmdbId ? Number(selectedShow.tmdbId) : undefined)}
                mediaType={selectedShow.mediaType}
                initialSeason={selectedShow.initialSeason}
                initialEpisode={selectedShow.initialEpisode}
                onBack={closeShow} 
                onShowClick={(id, mediaType) => openShow(id, 'tmdb', mediaType)}
              />
            </div>
          )}
        </div>

        {/* Navigation Bottom (Fixe) - Always Visible */}
        <BottomNav 
          currentTab={currentTab} 
          onTabChange={changeTab}
          onActiveTabClick={handleActiveTabClick}
          onActiveTabDoubleClick={handleActiveTabDoubleClick}
        />

        {/* Global Toast */}
        <ToastContainer />
      </div>
    </div>
  );
}