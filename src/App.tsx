import { getTodayStr } from './lib/utils';
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Activity, lazy, Suspense, startTransition, useCallback, useState, useEffect, useRef } from 'react';
import { closeTopDialog, closeTabSubview } from './features/navigation/dialogStack';
import { DialogLayer } from './components/ui/DialogLayer';
import { hydratePlatformPreferences } from './features/providers/platformPreferenceHydration';
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
import { useUpdateStore } from './store/updateStore';
import { consumeAppUpdateAvailablePush, handleAppUpdateAvailablePush, isAppUpdateAvailablePush } from './features/release/releaseUpdatePushClient';
import { useParentalRatingStore } from './store/parentalRatingStore';
import { parentalRatingKey } from './features/shows/parentalRating';
import { markEpisodeWatched } from './features/shows/markEpisodeWatched';
import { cleanOldCache } from './db/dexie';
import './store/showsStore';
import {
  activatePlexUserScope,
  flushNativePlexAvailabilityDiagnostics,
  syncNativePlexBackgroundCredentials
} from './features/plex/plexStorage';
import { usePlexAvailabilityStore } from './features/plex/plexAvailability';
import { activateLogUserScope, appLogger } from './store/logStore';
import { createCachedAsyncLoader, preloadInBackground } from './features/navigation/screenPreload';
import { resolveRootNavigationTab } from './features/navigation/tabPresentation';
import { activateCurrentNavigationTab, resetCurrentNavigationTab } from './features/navigation/navigationActions';
import type { RootNavigationTab } from './features/navigation/tabPresentation';
import { activateNavigationShortcut } from './features/navigation/navigationShortcuts';
const QuickAccountSheet = lazy(() => import('./components/QuickAccountSheet').then(module => ({ default: module.QuickAccountSheet })));
const TvPairingPage = lazy(() => import('./screens/TvPairingPage').then(module => ({ default: module.TvPairingPage })));

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
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );

  const [showSplash, setShowSplash] = useState(true);
  const [isSplashClosing, setIsSplashClosing] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      activateLogUserScope(user?.uid);
      if (activatePlexUserScope(user?.uid)) {
        usePlexAvailabilityStore.getState().clearCache();
      }
      syncNativePlexBackgroundCredentials(user?.uid);
      setCurrentUser(user);
      if (user) {
        void syncGrantedNotificationDevice();
        void user.getIdToken()
          .then(idToken => flushNativePlexAvailabilityDiagnostics(user.uid, idToken))
          .then(({ events, uploaded }) => {
            for (const event of events) {
              appLogger.info(
                'system',
                `[Plex disponibilité] trace=${event.traceId} étape=${event.stage} résultat=${event.outcome} tentative=${event.attempt}`
              );
            }
            if (events.length > 0 && !uploaded) {
              appLogger.info('system', '[Plex disponibilité] traces conservées pour un prochain envoi.');
            }
          })
          .catch(() => undefined);
        try {
          const prefRef = doc(db, 'users', user.uid, 'settings', 'preferences');
          await hydratePlatformPreferences(user.uid, {
            read: async () => {
              const snap = await getDoc(prefRef);
              return snap.exists() ? snap.data()?.platforms : undefined;
            },
            save: platforms => setDoc(prefRef, { platforms }, { merge: true }),
          });
        } catch (e: unknown) {
          const errorDetails = typeof e === 'object' && e !== null
            ? e as { message?: unknown; code?: unknown }
            : {};
          const errorMessage = typeof errorDetails.message === 'string' ? errorDetails.message : String(e);
          const errorCode = typeof errorDetails.code === 'string' ? errorDetails.code : '';
          const isOffline = !navigator.onLine ||
                            errorMessage.toLowerCase().includes('offline') ||
                            errorCode === 'unavailable';
          if (isOffline) {
            appLogger.warn('system', '[App] Client is offline, using local cached streaming platforms', { errorMessage });
          } else {
            appLogger.error('system', '[App] Error syncing user streaming platforms from cloud', e);
          }
        }
      }
    });
    return unsub;
  }, []);

  const isReady = currentUser !== undefined;

  useEffect(() => {
    if (!currentUser || window.location.pathname === '/tv/connect') return;
    void preloadInBackground(privateScreenPreloaders);
  }, [currentUser]);

  useEffect(() => {
    if (isNative) {
      StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
      StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
      StatusBar.setBackgroundColor({ color: '#00000000' }).catch(() => {});

      const animFrame = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          CapSplashScreen.hide().catch(() => {});
        });
      });
      return () => cancelAnimationFrame(animFrame);
    }
  }, [isNative]);

  return (
    <>
      {showSplash && (
        <SplashScreen
          isReady={isReady}
          animate={true}
          onStartClose={() => setIsSplashClosing(true)}
          onComplete={() => setShowSplash(false)}
        />
      )}

      {isReady && isSplashClosing ? (
        currentUser === null ? <LoginScreen /> : window.location.pathname === '/tv/connect'
          ? <Suspense fallback={<div role="status">Connexion SeenIt TV…</div>}><TvPairingPage user={currentUser} /></Suspense>
          : <MainApp />
      ) : (
        <div className="w-full min-h-[100dvh] bg-[#040406]" />
      )}
    </>
  );
}

function MainApp() {
  const { updateShow } = useShows();
  const shows = useShowsStore(state => state.shows);
  const parentalRatingOverrides = useParentalRatingStore(state => state.overrides);
  const showToast = useToastStore(state => state.showToast);
  const processedActionsRef = useRef<Set<string>>(new Set());
  const detailOpenRequestRef = useRef(0);

  useEffect(() => {
    useSyncStore.getState().resetQuotaError();
    cleanOldCache();
  }, []);

  useDetailsSyncWorker();
  useRemindersNotifier();
  const { currentTab, changeTab, selectedShow, openShow, closeShow } = useNavigation();
  const [mountedTabs, setMountedTabs] = useState<Set<string>>(() => new Set(['watchlist', currentTab]));
  const [shortcut, setShortcut] = useState<{ tab: RootNavigationTab; request: number } | null>(null);
  const shortcutSequence = useRef(0);
  const [quickAccountOpen, setQuickAccountOpen] = useState(false);

  const selectedLocalShow = selectedShow?.type === 'local'
    ? shows.find(show => String(show.id) === String(selectedShow.id) || String(show.tmdbId) === String(selectedShow.id))
    : undefined;
  const selectedRatingTmdbId = selectedShow
    ? Number(
        selectedShow.type === 'tmdb'
          ? selectedShow.id
          : (selectedShow.tmdbId || selectedLocalShow?.tmdbId || 0)
      )
    : 0;
  const selectedRatingMediaType: 'tv' | 'movie' = selectedShow?.mediaType || selectedLocalShow?.mediaType || 'tv';
  const selectedRatingKey = selectedRatingTmdbId
    ? parentalRatingKey(selectedRatingMediaType, selectedRatingTmdbId)
    : null;
  const selectedRatingRevision = selectedRatingKey
    ? (parentalRatingOverrides[selectedRatingKey]?.updatedAt || 0)
    : 0;

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
    id: string | number,
    type: 'local' | 'tmdb' = 'local',
    mediaType?: 'tv' | 'movie',
    tmdbId?: number,
    initialSeason?: number,
    initialEpisode?: number
  ) => {
    const requestId = ++detailOpenRequestRef.current;
    void loadShowDetailScreen();

    const matchingLocalShow = type === 'local'
      ? shows.find(show => String(show.id) === String(id) || String(show.tmdbId) === String(id))
      : undefined;
    const resolvedTmdbId = Number(
      type === 'tmdb' ? id : (tmdbId || matchingLocalShow?.tmdbId || 0),
    );
    const resolvedMediaType: 'tv' | 'movie' =
      mediaType === 'movie' || matchingLocalShow?.mediaType === 'movie' ? 'movie' : 'tv';

    const commitOpen = () => {
      if (requestId !== detailOpenRequestRef.current) return;
      startTransition(() => {
        openShow(id, type, mediaType, tmdbId, initialSeason, initialEpisode);
      });
    };

    if (!Number.isFinite(resolvedTmdbId) || resolvedTmdbId <= 0) {
      commitOpen();
      return;
    }

    void (async () => {
      await import('./features/shows/tmdb')
        .then(({ tmdb }) => tmdb.primeMediaRenderSnapshotFromPersistentCache(resolvedTmdbId, resolvedMediaType))
        .catch(() => false);
      commitOpen();
    })();
  }, [openShow, shows]);

  const openLocalMedia = useCallback((id: string | number, mediaType?: 'tv' | 'movie') => {
    openShowSmooth(id, 'local', mediaType);
  }, [openShowSmooth]);

  const openLocalMediaImmediate = useCallback((id: string | number, mediaType?: 'tv' | 'movie') => {
    void loadShowDetailScreen();
    openShow(id, 'local', mediaType);
  }, [openShow]);

  const openTmdbMedia = useCallback((id: string | number, mediaType?: 'tv' | 'movie') => {
    openShowSmooth(id, 'tmdb', mediaType);
  }, [openShowSmooth]);

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

    let listenerHandler: { remove: () => Promise<void> } | null = null;

    const setupBackButton = async () => {
      listenerHandler = await CapApp.addListener('backButton', ({ canGoBack }) => {
        if (closeTopDialog()) return;
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

        const rootTab = resolveRootNavigationTab(currentTab);
        if (rootTab && closeTabSubview(rootTab)) return;

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

    const handleNativeMediaUrl = (rawUrl?: string | null) => {
      if (!rawUrl || !rawUrl.startsWith('com.seenit.app://media')) return;
      if (!auth.currentUser) {
        sessionStorage.setItem('seenit_pending_media_url', rawUrl);
        return;
      }

      let parsed: URL;
      try {
        parsed = new URL(rawUrl);
      } catch {
        return;
      }

      const tmdbId = Number(parsed.searchParams.get('tmdbId'));
      const mediaType = parsed.searchParams.get('mediaType') === 'movie' ? 'movie' : 'tv';
      const seasonParam = parsed.searchParams.get('season');
      const episodeParam = parsed.searchParams.get('episode');
      const season = seasonParam !== null && seasonParam.trim() ? Number(seasonParam) : NaN;
      const episode = episodeParam !== null && episodeParam.trim() ? Number(episodeParam) : NaN;
      if (!Number.isInteger(tmdbId) || tmdbId <= 0) return;

      const actionKey = `native-media:${mediaType}:${tmdbId}:${season || 0}:${episode || 0}`;
      if (processedActionsRef.current.has(actionKey)) return;
      processedActionsRef.current.add(actionKey);
      sessionStorage.removeItem('seenit_pending_media_url');

      openShowSmooth(
        tmdbId,
        'tmdb',
        mediaType,
        tmdbId,
        Number.isInteger(season) && season >= 0 ? season : undefined,
        Number.isInteger(episode) && episode > 0 ? episode : undefined
      );
    };

    let appUrlListener: { remove: () => Promise<void> } | null = null;
    if (Capacitor.isNativePlatform()) {
      void CapApp.addListener('appUrlOpen', ({ url }) => handleNativeMediaUrl(url))
        .then(handle => { appUrlListener = handle; });
      void CapApp.getLaunchUrl().then(result => handleNativeMediaUrl(result?.url));
      handleNativeMediaUrl(sessionStorage.getItem('seenit_pending_media_url'));
    }

    const handleNotificationMessage = (data: { ownerUid?: string; providerId?: number; providerName?: string; notificationId?: number; notificationTitle?: string; notificationIcon?: string; notificationImage?: string; releasedSeason?: number; releasedEpisode?: number; releasedName?: string; releasedDate?: string; type?: string; showId?: string | number; tmdbId?: string | number; mediaType?: 'tv' | 'movie'; season?: string | number; episode?: string | number }) => {
      if (!data || data.ownerUid && data.ownerUid !== auth.currentUser?.uid) return;

      if (isAppUpdateAvailablePush(data)) {
        consumeAppUpdateAvailablePush();
        void handleAppUpdateAvailablePush(
          data,
          useUpdateStore.getState().checkForUpdates,
          () => {
            handleTabChange('watchlist');
            useUpdateStore.getState().requestUpdateModal();
          }
        );
        return;
      }

      if (data.type === 'NAVIGATE_SHOW' || data.type === 'DOWNLOAD_EVENT' || data.type === 'PLEX_AVAILABLE') {
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

      if (data.type === 'QUICK_ACTION_OPEN_PROVIDER' && data.ownerUid === auth.currentUser?.uid) {
        const show = useShowsStore.getState().shows.find(item => item.id === String(data.showId) && item.userId === data.ownerUid);
        if (!show || !Number.isSafeInteger(data.providerId) || !data.providerName) return;
        void Promise.all([import('./features/providers/providerLink.ts'), import('./lib/utils')]).then(([{ getProviderLinkPresentation }, { openExternalUrl }]) => {
          if (data.ownerUid !== auth.currentUser?.uid) return;
          const target = getProviderLinkPresentation({ providerId: Number(data.providerId), providerName: data.providerName || '', title: show.title, fallbackLink: '' });
          if (target.url && target.url !== '#') return openExternalUrl(target.url, { title: show.title, originalTitle: show.originalTitle, tmdbId: show.tmdbId, mediaType: show.mediaType });
        }).catch(() => undefined);
        return;
      }

      if (data.type === 'QUICK_ACTION_REMIND_TONIGHT' && data.ownerUid === auth.currentUser?.uid) {
        void Promise.all([import('./features/notifications/tonightReminder.ts'), import('./features/notifications/mediaReminderNotification.ts')]).then(async ([{ nextTonightReminder }, { sendMediaReminderNotification }]) => {
          const show = useShowsStore.getState().shows.find(item => item.id === String(data.showId) && item.userId === data.ownerUid);
          if (!show || show.isArchived || show.status === 'dropped' || data.ownerUid !== auth.currentUser?.uid) return;
          const season = Number(data.season), episode = Number(data.episode);
          if (!Number.isInteger(season) || season < 0 || !Number.isInteger(episode) || episode <= 0 || show.seenEpisodes.includes(`${season}x${episode}`)) return;
          await sendMediaReminderNotification(show.title, { notificationId: data.notificationId,
            summaryText: 'Rappel', body: `S${String(season).padStart(2, '0')} | E${String(episode).padStart(2, '0')} t’attend`,
            detailText: 'Le rappel que tu as demandé pour ce soir.', channelId: 'seenit_reminders',
            scheduleDate: nextTonightReminder(), reminderPurpose: 'tonight', allowMarkWatched: true,
            icon: data.notificationIcon, image: data.notificationImage, showId: show.id, tmdbId: show.tmdbId, mediaType: 'tv', season, episode });
        }).catch(() => undefined);
        return;
      }

      if (data.type === 'QUICK_ACTION_MARK_WATCHED') {
        if (data.mediaType === 'movie') {
          const show = useShowsStore.getState().shows.find(item => item.id === String(data.showId) && item.userId === auth.currentUser?.uid);
          if (show) void import('./features/watchlist/watchProgressActions.ts').then(({ markMovieWatched }) => markMovieWatched(show, updateShow)).catch(() => undefined);
          return;
        }
        const idToWatch = data.showId || data.tmdbId;
        const season = data.season;
        const episode = data.episode;

        if (idToWatch && season !== undefined && episode !== undefined) {
          void markEpisodeWatched(idToWatch, Number(season), Number(episode), updateShow).then(async success => {
            if (!success || !data.notificationId || data.ownerUid !== auth.currentUser?.uid) return;
            const show = useShowsStore.getState().shows.find(item => String(item.id) === String(idToWatch) && item.userId === data.ownerUid);
            if (!show || show.isArchived || show.status === 'dropped') return;
            const [{ buildTvEpisodeReminderCopy }, { sendMediaReminderNotification }] = await Promise.all([
              import('./features/notifications/tvReminderCopy.ts'), import('./features/notifications/mediaReminderNotification.ts'),
            ]);
            if (data.ownerUid !== auth.currentUser?.uid) return;
            const released = { season_number: Number(data.releasedSeason ?? season), episode_number: Number(data.releasedEpisode ?? episode),
              name: data.releasedName, air_date: data.releasedDate };
            const next = show.nextEpisodeToWatch;
            const available = next && (!next.air_date || next.air_date <= getTodayStr());
            const copy = buildTvEpisodeReminderCopy(show, released, getTodayStr());
            await sendMediaReminderNotification(show.title, { ...copy, notificationId: data.notificationId,
              icon: data.notificationIcon, image: data.notificationImage, silent: true,
              showId: show.id, tmdbId: show.tmdbId, mediaType: 'tv',
              season: available ? next.season_number : undefined, episode: available ? next.episode_number : undefined,
              allowMarkWatched: !!available, allowTonight: !!available,
              data: { showId: show.id, tmdbId: show.tmdbId, mediaType: 'tv',
                season: available ? next.season_number : undefined, episode: available ? next.episode_number : undefined,
                releasedSeason: released.season_number, releasedEpisode: released.episode_number,
                releasedName: released.name, releasedDate: released.air_date },
            });
          }).catch(() => undefined);
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

    const handleCapacitorAction: EventListener = (event) => {
      if (event instanceof CustomEvent && event.detail) {
        handleNotificationMessage(event.detail);
      }
    };
    window.addEventListener('capacitor-notification-action', handleCapacitorAction);

    const pendingAppUpdatePush = consumeAppUpdateAvailablePush();
    if (pendingAppUpdatePush) {
      handleNotificationMessage(pendingAppUpdatePush);
    }

    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('app_notifications');
      bc.onmessage = (event) => {
        handleNotificationMessage(event.data);
      };
    } catch (e) {}

    const handleVisibilityOrFocus = () => {
      checkUrlParams();
      // Le listener Firestore actif reprend automatiquement les changements distants.
      // Ne pas relire toute la bibliothèque à chaque focus/retour de visibilité.
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
      if (appUrlListener) {
        appUrlListener.remove();
      }
      window.removeEventListener('capacitor-notification-action', handleCapacitorAction);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [handleTabChange, openShowSmooth, updateShow, showToast]);

  const handleActiveTabClick = () => {
    if (closeTopDialog()) return;

    if (
      typeof window !== 'undefined' &&
      (window.history.state?.isModal ||
        window.history.state?.isEpisodeDetailModal ||
        window.history.state?.isPersonDetailModal)
    ) {
      window.history.back();
    } else if (selectedShow) {
      closeShow();
    } else {
      const rootTab = resolveRootNavigationTab(currentTab);
      if (rootTab) {
        activateCurrentNavigationTab(rootTab);
      }
    }
  };

  const handleActiveTabDoubleClick = () => {
    const rootTab = resolveRootNavigationTab(currentTab);
    if (!rootTab) return;

    resetCurrentNavigationTab(rootTab);
  };

  const handleNavigationLongPress = (tab: RootNavigationTab) => {
    activateNavigationShortcut(currentTab, tab, {
      changeTab: handleTabChange,
      request: target => setShortcut({ tab: target, request: ++shortcutSequence.current }),
      quickAccount: () => setQuickAccountOpen(true),
    });
  };

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (selectedShow) closeShow();
      else {
        const rootTab = resolveRootNavigationTab(currentTab);
        if (rootTab) closeTabSubview(rootTab);
      }
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [selectedShow, currentTab, closeShow]);

  return (
    <div className="w-full min-h-[100dvh] bg-[#040406] flex justify-center selection:bg-[#E5A93D]/30">
      <div className="w-full max-w-md bg-premium-ambient h-[100dvh] flex flex-col relative shadow-2xl shadow-black/90 overflow-hidden pt-safe">

        <PWAInstallBanner />
        <AppUpdateBanner />

        <div className="flex-1 min-h-0 flex flex-col relative">
          <div className="flex-1 min-h-0 flex flex-col">
            <Suspense fallback={<div className="flex-1 bg-premium-ambient" aria-label="Chargement de l’écran" />}>
              {mountedTabs.has('watchlist') && (
                <Activity mode={currentTab === 'watchlist' ? 'visible' : 'hidden'}>
                  <div data-app-tab="watchlist" className="flex-1 min-h-0 flex flex-col">
                    <WatchListScreen onExplore={() => handleTabChange('discover')} onShowClick={openLocalMedia} onEpisodeParentClick={openLocalMediaImmediate} navigationShortcut={currentTab === 'watchlist' && shortcut?.tab === 'watchlist' ? shortcut.request : undefined} />
                  </div>
                </Activity>
              )}

              {(mountedTabs.has('profile') || mountedTabs.has('settings')) && (
                <Activity mode={(currentTab === 'profile' || currentTab === 'settings') ? 'visible' : 'hidden'}>
                  <div data-app-tab="profile" className="flex-1 min-h-0 flex flex-col">
                    <ProfileScreen
                      initialShowSettings={currentTab === 'settings'}
                      onQuickSettings={() => setQuickAccountOpen(true)}
                      onShowClick={openTmdbMedia}
                    />
                  </div>
                </Activity>
              )}

              {mountedTabs.has('discover') && (
                <div
                  data-app-tab="discover"
                  className={currentTab === 'discover' ? 'flex-1 min-h-0 flex flex-col' : 'hidden'}
                  aria-hidden={currentTab !== 'discover'}
                >
                  <DiscoverScreen onShowClick={openTmdbMedia} navigationShortcut={currentTab === 'discover' && shortcut?.tab === 'discover' ? shortcut.request : undefined} />
                </div>
              )}

              {mountedTabs.has('downloads') && (
                <Activity mode={currentTab === 'downloads' ? 'visible' : 'hidden'}>
                  <div data-app-tab="downloads" className="flex-1 min-h-0 flex flex-col">
                    <DownloadsScreen onShowClick={openTmdbMedia} navigationShortcut={currentTab === 'downloads' && shortcut?.tab === 'downloads' ? shortcut.request : undefined} />
                  </div>
                </Activity>
              )}
            </Suspense>
          </div>

          {selectedShow && (
            <DialogLayer key={`${selectedShow.id}-${selectedShow.mediaType || 'tv'}`} label="Fiche média" onDismiss={closeShow} historyMode="external" blocking={false}
              className="fixed inset-0 z-[150] bg-black flex flex-col overflow-hidden max-w-md mx-auto animate-in slide-in-from-right duration-300 ease-out motion-reduce:animate-none pt-safe"
              style={{ willChange: 'transform' }}
            >
              <Suspense fallback={<div className="flex-1 bg-premium-ambient" aria-label="Chargement de la fiche" />}>
                <ShowDetailScreen
                  key={`${selectedShow.id}-${selectedShow.mediaType || 'tv'}-${selectedRatingRevision}`}
                  showId={selectedShow.type === 'local' ? String(selectedShow.id) : undefined}
                  tmdbId={selectedShow.type === 'tmdb' ? Number(selectedShow.id) : (selectedShow.tmdbId ? Number(selectedShow.tmdbId) : undefined)}
                  mediaType={selectedShow.mediaType}
                  initialSeason={selectedShow.initialSeason}
                  initialEpisode={selectedShow.initialEpisode}
                  onBack={closeShow}
                  onShowClick={openTmdbMedia}
                />
              </Suspense>
            </DialogLayer>
          )}
        </div>

        <BottomNav
          currentTab={currentTab}
          onTabChange={handleTabChange}
          onActiveTabClick={handleActiveTabClick}
          onActiveTabDoubleClick={handleActiveTabDoubleClick}
          onLongPress={handleNavigationLongPress}
        />

        {quickAccountOpen && <Suspense fallback={null}><QuickAccountSheet onClose={() => setQuickAccountOpen(false)} /></Suspense>}

        <ToastContainer />
      </div>
    </div>
  );
}
