import { useAnimatedBadges } from '../hooks/useAnimatedBadges';
import { DialogLayer } from '../components/ui/DialogLayer';
import { hydratePlatformPreferences } from '../features/providers/platformPreferenceHydration';
import { useState, useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Cloud, LogIn, FileText, CheckCircle2, Bell, RefreshCw, Loader2, Terminal, Copy, Trash2, ChevronRight, Check, AlertCircle, Sparkles, Download, X, UploadCloud, DownloadCloud, LayoutGrid, Server, MonitorSmartphone, Package, Tv, Clock, Newspaper, Film, Smartphone, FlaskConical, Sun } from 'lucide-react';
import { auth, db, googleAuthProvider, requestNotificationPermission, revokeCurrentDeviceNotifications } from '../lib/firebase';
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { registerPlugin } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { DEFAULT_NOTIFICATION_PREFS, mergeNotificationPreferences } from '../features/notifications/notificationPreferences.ts';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { signInWithPopup, signInWithCredential, GoogleAuthProvider, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { cn } from '../lib/utils';
import { CsvImporter } from '../components/CsvImporter';
import { useToastStore } from '../store/toastStore';
import { useSyncStore, type PlexSyncStatus } from '../store/syncStore';
import { useShowsStore } from '../store/showsStore';
import { useLogStore, appLogger, LogCategory } from '../store/logStore';
import { useUpdateStore, CURRENT_APP_VERSION } from '../store/updateStore';
import { performDetailsSync } from '../hooks/useDetailsSyncWorker';
import {
  buildPlexAuthUrl,
  getPlexPin,
  pollPlexAuthAttempt,
  PlexAuthError,
  type PlexAuthAttempt
} from '../services/plex';
import { performPlexSync } from '../features/plex/syncPlex';
import { isPlexSyncTerminal } from '../features/plex/plexSyncPresentation';
import { ReleaseHistoryViewer } from '../components/ChangelogViewer';
import { DownloadFeatureSettingsRow } from '../components/DownloadFeatureSettingsCard';
import {
  SettingsCard,
  SettingsConfirm,
  SettingsGroup,
  SettingsHeader,
  SettingsRow,
  SettingsSubscreen,
  formatSettingsAgo,
  type SettingsTone,
} from '../components/settings/SettingsUi';
import { getProfileAvatarUrl, getProfileInitials } from '../features/profile/profileAvatar';
import { loadPlatformLogos, platformLogoUrl, readPlatformLogos } from '../features/providers/platformLogos';
import './reglages.css';
import { downloadAndInstallApk, getUpdateProgressPresentation, UpdateProgress } from '../services/appUpdater';
import {
  activatePlexUserScope,
  clearPlexCredentials,
  getPlexLastSyncTimestamp,
  getStoredPlexToken,
  getStoredPlexUsername,
  storePlexCredentials
} from '../features/plex/plexStorage';
import { usePlexAvailabilityStore } from '../features/plex/plexAvailability';
import { readUserScopedJson, subscribeUserScopedStorageField, writeUserScopedJson } from '../lib/userIsolation';
import { resolveNotificationMediaVisual } from '../features/notifications/notificationMedia';
import { sendMediaReminderNotification } from '../features/notifications/mediaReminderNotification';
import { buildNotificationTestSample, type NotificationTestType } from '../features/notifications/notificationTestSample';
const NotificationSettings = registerPlugin<{ open(): Promise<void>; openChannel(options: { channelId: string }): Promise<void> }>('SeenItNotificationSettings');

const STREAMING_PLATFORMS = [
  { id: 8, name: 'Netflix', short: 'NF', tile: '#141414', ink: '#ff5a5f' },
  { id: 119, name: 'Prime Video', short: 'PV', tile: '#0b2a3a', ink: '#67e8f9' },
  { id: 337, name: 'Disney+', short: 'D+', tile: '#0e1d3a', ink: '#93c5fd' },
  { id: 381, name: 'Canal+', short: 'C+', tile: '#f4f4f5', ink: '#111' },
  { id: 350, name: 'Apple TV+', short: 'tv', tile: '#f4f4f5', ink: '#111' },
  { id: 531, name: 'Paramount+', short: 'P+', tile: '#0b1f4d', ink: '#93c5fd' },
  { id: 1899, name: 'Max', short: 'MX', tile: '#0f1f4d', ink: '#bfdbfe' },
  { id: 234, name: 'France TV', short: 'FTV', tile: '#16233f', ink: '#fca5a5' },
  { id: 239, name: 'Arte', short: 'AR', tile: '#2a1410', ink: '#fdba74' }
];

const NOTIFICATION_TESTS: { type: NotificationTestType; label: string; sub: string }[] = [
  { type: 'release_today_tv', label: 'Test · nouvel épisode', sub: 'Série de ta liste' },
  { type: 'season_d7', label: 'Test · nouvelle saison', sub: 'Rappel J-7' },
  { type: 'movie_theater', label: 'Test · sortie au cinéma', sub: 'Film de ta liste' },
  { type: 'movie_dvd_vod', label: 'Test · sortie DVD / VOD', sub: 'Aperçu, aucune date inventée' },
];

const describeError = (error: unknown) => error instanceof Error ? error.message : String(error);

// Types sans préférence SeenIt : leurs canaux Android (#778) se règlent dans le système.
const ANDROID_ALERTS = [
  { channelId: 'seenit_reminders', icon: Bell, label: 'Rappels', sub: 'Les cloches posées sur un épisode ou un film' },
  { channelId: 'seenit_downloads', icon: Download, label: 'Téléchargements et Plex', sub: 'Import terminé, disponible dans Plex, échec' },
  { channelId: 'seenit_app', icon: Package, label: 'Mise à jour de SeenIt', sub: 'Nouvelle version disponible ou téléchargée' },
] as const;

type SettingsPage = 'plats' | 'notifs' | 'plex' | 'devices' | 'compte' | 'app';
type NotificationPermissionState = 'granted' | 'denied' | 'prompt' | 'unknown';
const PLEX_FRESH_MS = 24 * 60 * 60 * 1000;

type PlexAuthSession = Readonly<{
  uid: string;
  attempt: PlexAuthAttempt;
}>;

export function SettingsScreen({ onClose }: { onClose?: () => void } = {}) {
  const [animatedBadges, setAnimatedBadges] = useAnimatedBadges();
  const [page, setPage] = useState<SettingsPage | null>(null);
  const [confirm, setConfirm] = useState<'logout' | 'plexout' | null>(null);
  const [showNotificationTests, setShowNotificationTests] = useState(false);
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermissionState>('unknown');
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [platformLogos, setPlatformLogos] = useState(() => readPlatformLogos());
  const [brokenLogos, setBrokenLogos] = useState<ReadonlySet<number>>(() => new Set());
  const plexSyncStatus = useSyncStore(state => state.plexSyncStatus);
  const isQuotaExceeded = useSyncStore(state => state.isQuotaExceeded);
  const { showToast } = useToastStore();
  const syncStatus = useSyncStore(state => state.syncStatus);
  const shows = useShowsStore(state => state.shows);
  const { logs, clearLogs, getLogsAsText, diagnosticsEnabled, setDiagnosticsEnabled } = useLogStore();
  const {
    currentVersion,
    latestRelease,
    hasUpdate,
    isChecking: isCheckingUpdates,
    lastChecked,
    checkForUpdates,
    releaseHistory,
    isLoadingReleaseHistory,
    releaseHistoryError,
    loadReleaseHistory,
  } = useUpdateStore();
  const [apkUpdateProgress, setApkUpdateProgress] = useState<UpdateProgress | null>(null);
  const apkUpdatePresentation = apkUpdateProgress
    ? getUpdateProgressPresentation(apkUpdateProgress)
    : null;
  const [showVersionNotesModal, setShowVersionNotesModal] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [userPlatforms, setUserPlatforms] = useState<number[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);

  const [notificationPrefs, setNotificationPrefs] = useState(() =>
    mergeNotificationPreferences(readUserScopedJson(auth.currentUser?.uid, 'notifications', null))
  );

  const handleToggleNotif = async (key: string, value: boolean) => {
    const newPrefs = { ...notificationPrefs, [key]: value };
    setNotificationPrefs(newPrefs);
    writeUserScopedJson(auth.currentUser?.uid, 'notifications', newPrefs);
    if (auth.currentUser) {
      try {
        const notifRef = doc(db, 'users', auth.currentUser.uid, 'settings', 'notifications');
        await setDoc(notifRef, newPrefs, { merge: true });
      } catch (e) {
        appLogger.error('system', 'Enregistrement des préférences de notifications impossible', e);
      }
    }
  };

  // Plex Auth State
  const [plexAuthSession, setPlexAuthSession] = useState<PlexAuthSession | null>(null);
  const [plexAuthError, setPlexAuthError] = useState<string | null>(null);
  const [isStartingPlexAuth, setIsStartingPlexAuth] = useState(false);
  const plexAuthStartGuard = useRef(false);
  const [plexToken, setPlexToken] = useState<string | null>(
    getStoredPlexToken(auth.currentUser?.uid)
  );
  const [plexSyncMode, setPlexSyncMode] = useState<'delta' | 'full' | null>(null);

  // App Logs state
  const [showLogsPanel, setShowLogsPanel] = useState(false);
  const [selectedLogCategory, setSelectedLogCategory] = useState<string>('all');
  const [copiedLogs, setCopiedLogs] = useState(false);

  useEffect(() => {
    if (!plexAuthSession || plexToken) return;

    const controller = new AbortController();
    let active = true;
    const { uid, attempt } = plexAuthSession;

    appLogger.info('plex', 'Association Plex en attente d’autorisation.', { platform: attempt.platform });

    void (async () => {
      try {
        const res = await pollPlexAuthAttempt(attempt, { signal: controller.signal });
        if (!active || !res.authToken || auth.currentUser?.uid !== uid) return;

        const username = res.username || '';
        const plexRef = doc(db, 'users', uid, 'settings', 'plex');
        await setDoc(plexRef, { authToken: res.authToken, username }, { merge: true });

        if (!active || auth.currentUser?.uid !== uid) return;
        storePlexCredentials(uid, res.authToken, username);
        setPlexToken(res.authToken);
        setPlexAuthSession(null);
        setPlexAuthError(null);
        showToast('Compte Plex connecté !', 'success');
        appLogger.success('plex', 'Compte Plex authentifié et validé avec succès.');

        try {
          await performPlexSync({ delta: false, silent: false, ignoreCooldown: true });
        } catch {
          appLogger.warn('plex', 'Compte Plex associé, mais la première synchronisation complète a échoué.');
        }
      } catch (error: unknown) {
        if (!active || (error instanceof PlexAuthError && error.code === 'cancelled')) return;

        const message = error instanceof PlexAuthError
          ? error.message
          : "Impossible de terminer l'association Plex. Réessayez.";
        setPlexAuthSession(null);
        setPlexAuthError(message);
        showToast(message, 'error');
        appLogger.warn('plex', 'Association Plex interrompue.', {
          code: error instanceof PlexAuthError ? error.code : 'unknown'
        });
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [plexAuthSession, plexToken, user?.uid, showToast]);

  const handlePlexLogin = async () => {
    if (!user?.uid || plexAuthStartGuard.current || plexAuthSession) return;

    const uid = user.uid;
    plexAuthStartGuard.current = true;
    setIsStartingPlexAuth(true);
    setPlexAuthError(null);

    try {
      const platform = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
        ? 'Android' as const
        : 'Web' as const;
      const attempt = await getPlexPin(platform);
      if (auth.currentUser?.uid !== uid) return;

      setPlexAuthSession(Object.freeze({ uid, attempt }));
      appLogger.info('plex', 'Demande d’association Plex créée ; ouverture de l’autorisation.', { platform });
      const authUrl = buildPlexAuthUrl(attempt);

      if (Capacitor.isNativePlatform()) {
        await Browser.open({ url: authUrl, windowName: '_system' });
      } else {
        const opened = window.open(authUrl, '_blank', 'noopener,noreferrer');
        if (!opened) throw new Error("Le navigateur a bloqué l'ouverture de Plex.");
      }
    } catch (error: unknown) {
      setPlexAuthSession(null);
      const message = error instanceof PlexAuthError
        ? error.message
        : "Impossible d'ouvrir l'autorisation Plex. Réessayez.";
      setPlexAuthError(message);
      showToast(message, 'error');
      appLogger.warn('plex', 'Impossible de démarrer l’association Plex.', {
        code: error instanceof PlexAuthError ? error.code : 'open_failed'
      });
    } finally {
      plexAuthStartGuard.current = false;
      setIsStartingPlexAuth(false);
    }
  };

  const handleCancelPlexLogin = () => {
    setPlexAuthSession(null);
    setPlexAuthError(null);
    plexAuthStartGuard.current = false;
    setIsStartingPlexAuth(false);
    appLogger.info('plex', 'Association Plex annulée par l’utilisateur.');
  };

  const handlePlexSync = async (delta: boolean = true) => {
    if (!plexToken || !user) return;
    setPlexSyncMode(delta ? 'delta' : 'full');
    try {
      await performPlexSync({ delta, silent: false, ignoreCooldown: true });
    } catch (e: unknown) {
      showToast(`Erreur système: ${describeError(e)}`, "error");
    } finally {
      setPlexSyncMode(null);
    }
  };

  const handlePlexLogout = async () => {
    setPlexAuthSession(null);
    setPlexAuthError(null);
    setPlexToken(null);
    clearPlexCredentials(user?.uid);
    usePlexAvailabilityStore.getState().clearCache();
    if (user) {
      try {
        const plexRef = doc(db, 'users', user.uid, 'settings', 'plex');
        await deleteDoc(plexRef);
      } catch (err) {
        appLogger.error('plex', 'Suppression de la configuration Plex cloud impossible', err);
      }
    }
    showToast("Compte Plex déconnecté.", "info");
    appLogger.info('plex', 'Compte Plex déconnecté');
  };

  useEffect(() => {
    setUserPlatforms(readUserScopedJson<number[]>(auth.currentUser?.uid, 'platforms', []));

    const handleStorage = () => {
      setUserPlatforms(readUserScopedJson<number[]>(auth.currentUser?.uid, 'platforms', []));
    };
    window.addEventListener('storage', handleStorage);

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      const scopeChanged = activatePlexUserScope(currentUser?.uid);
      if (scopeChanged) usePlexAvailabilityStore.getState().clearCache();
      setPlexAuthSession(current => current && current.uid !== currentUser?.uid ? null : current);
      setPlexAuthError(null);
      plexAuthStartGuard.current = false;
      setIsStartingPlexAuth(false);
      setPlexToken(getStoredPlexToken(currentUser?.uid));
      setUser(currentUser);
      if (currentUser) {
        // Réinitialiser immédiatement l'UI dans le périmètre du nouveau compte,
        // avant même que les lectures Firestore asynchrones ne se terminent.
        setUserPlatforms(readUserScopedJson<number[]>(currentUser.uid, 'platforms', []));
        setNotificationPrefs(mergeNotificationPreferences(readUserScopedJson(currentUser.uid, 'notifications', null)));
        try {
          // 1. Plateformes de streaming
          const prefRef = doc(db, 'users', currentUser.uid, 'settings', 'preferences');
          await hydratePlatformPreferences(currentUser.uid, {
            read: async () => {
              const snap = await getDoc(prefRef);
              return snap.exists() ? snap.data()?.platforms : undefined;
            },
            save: platforms => setDoc(prefRef, { platforms }, { merge: true }),
          });
          if (auth.currentUser?.uid !== currentUser.uid) return;
          setUserPlatforms(readUserScopedJson<number[]>(currentUser.uid, 'platforms', []));

          // 2. Préférences de notifications
          const notifRef = doc(db, 'users', currentUser.uid, 'settings', 'notifications');
          const snapNotif = await getDoc(notifRef);
          const localNotifs = readUserScopedJson<Record<string, boolean> | null>(currentUser.uid, 'notifications', null);

          if (snapNotif.exists()) {
            const cloudNotifs = mergeNotificationPreferences(snapNotif.data());
            setNotificationPrefs(mergeNotificationPreferences(cloudNotifs));
            writeUserScopedJson(currentUser.uid, 'notifications', cloudNotifs);
          } else if (localNotifs) {
            await setDoc(notifRef, localNotifs, { merge: true });
          }

          // 3. Configuration Plex synchronisée
          const plexRef = doc(db, 'users', currentUser.uid, 'settings', 'plex');
          const snapPlex = await getDoc(plexRef);

          if (snapPlex.exists() && snapPlex.data()?.authToken) {
            const cloudPlexToken = snapPlex.data().authToken;
            setPlexToken(cloudPlexToken);
            storePlexCredentials(currentUser.uid, cloudPlexToken, snapPlex.data()?.username || '');
          } else {
            setPlexToken(null);
            clearPlexCredentials(currentUser.uid);
          }
        } catch (e: unknown) {
          const errorMessage = e instanceof Error ? e.message : String(e);
          const isOffline = !navigator.onLine ||
                            errorMessage.toLowerCase().includes('offline') ||
                            (typeof e === 'object' && e !== null && 'code' in e && e.code === 'unavailable');
          if (isOffline) {
            console.warn('[Settings] Client is offline, using local cached settings:', errorMessage);
          } else {
            console.error('[Settings] Error syncing cloud settings', e);
          }
        }
      } else {
        setPlexAuthSession(null);
        setPlexToken(null);
        setUserPlatforms([]);
        setNotificationPrefs(DEFAULT_NOTIFICATION_PREFS);
      }
    });

    return () => {
      window.removeEventListener('storage', handleStorage);
      unsubscribe();
    };
  }, []);

  const handleBackupToCloud = async () => {
    if (!user) {
      showToast("Veuillez vous connecter pour sauvegarder vos données.", "error");
      return;
    }
    showToast("Sauvegarde de votre bibliothèque sur le Cloud...", "info");
    try {
      const res = await useShowsStore.getState().uploadAllToCloud();
      if (res.success) {
        // Sauvegarder également les plateformes, notifications et plex
        const prefRef = doc(db, 'users', user.uid, 'settings', 'preferences');
        await setDoc(prefRef, { platforms: userPlatforms }, { merge: true });

        const notifRef = doc(db, 'users', user.uid, 'settings', 'notifications');
        await setDoc(notifRef, notificationPrefs, { merge: true });

        const plexTokenLocal = getStoredPlexToken(user.uid);
        if (plexTokenLocal) {
          const plexRef = doc(db, 'users', user.uid, 'settings', 'plex');
          await setDoc(plexRef, { authToken: plexTokenLocal, username: getStoredPlexUsername(user.uid) }, { merge: true });
        }

        showToast(`✅ ${res.count} série(s) & vos réglages synchronisés avec le Cloud !`, "success");
      } else {
        showToast(`Erreur : ${res.error || 'Erreur inconnue'}`, "error");
      }
    } catch (e: unknown) {
      showToast(`Erreur : ${describeError(e)}`, "error");
    }
  };

  const handleRestoreFromCloud = async () => {
    if (!user) {
      showToast("Veuillez vous connecter pour synchroniser depuis le Cloud.", "error");
      return;
    }
    showToast("Récupération des données depuis le Cloud...", "info");
    try {
      await useShowsStore.getState().fetchShows();

      // Recharger plateformes
      const prefRef = doc(db, 'users', user.uid, 'settings', 'preferences');
      const snap = await getDoc(prefRef);
      if (snap.exists() && Array.isArray(snap.data()?.platforms)) {
        setUserPlatforms(snap.data().platforms);
        writeUserScopedJson(user.uid, 'platforms', snap.data().platforms);
      }

      // Recharger notifications
      const notifRef = doc(db, 'users', user.uid, 'settings', 'notifications');
      const snapNotif = await getDoc(notifRef);
      if (snapNotif.exists()) {
        const cloudNotifs = mergeNotificationPreferences(snapNotif.data());
        setNotificationPrefs(mergeNotificationPreferences(cloudNotifs));
        writeUserScopedJson(user.uid, 'notifications', cloudNotifs);
      }

      // Recharger Plex
      const plexRef = doc(db, 'users', user.uid, 'settings', 'plex');
      const snapPlex = await getDoc(plexRef);
      if (snapPlex.exists() && snapPlex.data()?.authToken) {
        setPlexToken(snapPlex.data().authToken);
        storePlexCredentials(user.uid, snapPlex.data().authToken, snapPlex.data()?.username || '');
      }

      showToast("✅ Données Cloud rechargées avec succès !", "success");
    } catch (e: unknown) {
      showToast(`Erreur : ${describeError(e)}`, "error");
    }
  };

  const handleForceSync = async () => {
    if (syncStatus) {
      showToast("Une synchronisation est déjà en cours...", "info");
      return;
    }

    if (!user) {
      showToast("Connectez-vous pour synchroniser votre bibliothèque.", "info");
      return;
    }

    setIsSyncing(true);
    showToast("Démarrage de la synchronisation forcée des séries...", "info");

    try {
      const res = await performDetailsSync(true);
      if (res.success) {
        if (res.syncedCount === 0) {
          showToast("Toutes vos séries sont déjà parfaitement à jour !", "success");
        } else {
          showToast(`Synchronisation forcée terminée (${res.syncedCount} série(s) mise(s) à jour) !`, "success");
        }
      } else {
        showToast(`Erreur de synchronisation : ${res.error || 'Erreur inconnue'}`, "error");
      }
    } catch (err) {
      appLogger.error('tmdb', 'Synchronisation forcée des fiches impossible', err);
      showToast("Erreur lors de la synchronisation.", "error");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleTogglePlatform = async (id: number) => {
    const newPlatforms = userPlatforms.includes(id)
      ? userPlatforms.filter(p => p !== id)
      : [...userPlatforms, id];

    setUserPlatforms(newPlatforms);
    writeUserScopedJson(auth.currentUser?.uid, 'platforms', newPlatforms);
    window.dispatchEvent(new Event('storage'));

    if (auth.currentUser) {
      try {
        const prefRef = doc(db, 'users', auth.currentUser.uid, 'settings', 'preferences');
        await setDoc(prefRef, { platforms: newPlatforms }, { merge: true });
      } catch (e) {
        appLogger.error('system', 'Enregistrement des plateformes impossible', e);
      }
    }
  };

  const handleLogin = async () => {
    try {
      if (Capacitor.isNativePlatform()) {
        const googleUser = await FirebaseAuthentication.signInWithGoogle({ useCredentialManager: false });
        const idToken = googleUser.credential?.idToken;
        if (!idToken) {
          throw new Error("Jeton d'authentification Google manquant.");
        }
        const credential = GoogleAuthProvider.credential(idToken);
        await signInWithCredential(auth, credential);
        return;
      }

      await signInWithPopup(auth, googleAuthProvider);
    } catch (err) {
      console.error("Erreur d'authentification Google in settings :", err);
    }
  };

  const handleLogout = async () => {
    showToast("Déconnexion en cours...", "info");
    localStorage.setItem('explicit_logout', 'true');
    setPlexAuthSession(null);
    clearPlexCredentials(auth.currentUser?.uid);
    usePlexAvailabilityStore.getState().clearCache();
    await revokeCurrentDeviceNotifications();
    await signOut(auth);
  };

  const triggerTestNotif = async (type: NotificationTestType) => {
    const sample = buildNotificationTestSample(shows, type);
    if (!sample) {
      showToast("🧪 Test · Aucun média du bon type n'est disponible.", "info");
      return;
    }

    try {
      const mediaVisual = await resolveNotificationMediaVisual(sample.posterUrl, sample.richImageUrl);
      const sent = await sendMediaReminderNotification(sample.notificationTitle, {
        body: sample.body,
        badge: 'https://seenit.app/icon-192.png',
        ...mediaVisual,
        summaryText: sample.summaryText,
        detailText: sample.detailText,
        allowMarkWatched: sample.allowMarkWatched,
        showId: sample.show.id,
        tmdbId: sample.show.tmdbId,
        mediaType: sample.show.mediaType,
        season: sample.season,
        episode: sample.episode,
        tag: `test_notification_${type}`,
        renotify: true,
        vibrate: [150, 80, 150, 80, 250],
        data: sample.data,
      });

      if (!sent) {
        showToast("🧪 Test · Échec d'envoi de la notification.", "error");
        return;
      }

      const hasVisual = Boolean(mediaVisual.icon || mediaVisual.image);
      const testMode = sample.isUpcoming ? 'prochain événement' : 'Aperçu';
      showToast(
        hasVisual
          ? `🧪 Test · ${testMode} avec visuel : ${sample.show.title}`
          : `🧪 Test · ${testMode} · fallback texte : ${sample.show.title}`,
        hasVisual ? 'success' : 'info'
      );
    } catch (error) {
      console.warn('[Settings] Notification test failed:', error);
      showToast("🧪 Test · Impossible d'envoyer la notification.", "error");
    }
  };

  const handleCheckUpdates = async () => {
    showToast("Vérification des mises à jour...", "info");
    try {
      const isNewer = await checkForUpdates(true);
      const state = useUpdateStore.getState();
      if (state.error) {
        showToast(`Erreur : ${state.error}`, "error");
        return;
      }
      if (isNewer && state.latestRelease) {
        showToast(`Mise à jour v${state.latestRelease.version} disponible !`, "success");
        setShowVersionNotesModal(true);
      } else {
        showToast(`Votre application est à jour (v${CURRENT_APP_VERSION}) !`, "success");
      }
    } catch {
      showToast("Impossible de contacter le serveur de mise à jour.", "error");
    }
  };

  const handleStartUpdate = async () => {
    if (!latestRelease?.apkDownloadUrl) {
      showToast("Lien de téléchargement indisponible.", "error");
      return;
    }

    setApkUpdateProgress({
      percent: 5,
      status: 'downloading',
      message: 'Initialisation du téléchargement...'
    });

    const result = await downloadAndInstallApk(
      latestRelease,
      (progress) => setApkUpdateProgress(progress)
    );

    if (!result.success) {
      setApkUpdateProgress({
        percent: 0,
        status: 'error',
        message: result.error || 'Erreur lors du téléchargement'
      });
    }
  };

  const isNative = Capacitor.isNativePlatform();
  const isAndroid = Capacitor.getPlatform() === 'android';
  const devicePlace = isNative ? 'ce téléphone' : 'ce navigateur';
  const avatarUrl = getProfileAvatarUrl(user);

  useEffect(() => { setAvatarFailed(false); }, [user?.uid, avatarUrl]);

  const [plexReport, setPlexReport] = useState<PlexSyncStatus | null>(null);
  useEffect(() => {
    const uid = user?.uid;
    const refresh = () => setPlexReport(readUserScopedJson<PlexSyncStatus | null>(uid, 'plex_last_sync_report_v1', null));
    refresh();
    return subscribeUserScopedStorageField(uid, 'plex_last_sync_report_v1', refresh);
  }, [user?.uid]);

  useEffect(() => {
    if (page !== 'plats') return;
    let active = true;
    void loadPlatformLogos(STREAMING_PLATFORMS.map(platform => platform.id)).then(logos => { if (active) setPlatformLogos(logos); });
    return () => { active = false; };
  }, [page]);

  // L'état réel de la permission n'est lu qu'à l'ouverture des écrans qui l'affichent.
  useEffect(() => {
    if (page !== 'notifs' && page !== 'devices') return;
    let active = true;
    void (async () => {
      try {
        if (Capacitor.isNativePlatform()) {
          const { receive } = await PushNotifications.checkPermissions();
          if (active) setNotificationPermission(receive === 'granted' ? 'granted' : receive === 'denied' ? 'denied' : 'prompt');
        } else if (typeof window !== 'undefined' && 'Notification' in window) {
          const permission = Notification.permission;
          if (active) setNotificationPermission(permission === 'granted' ? 'granted' : permission === 'denied' ? 'denied' : 'prompt');
        }
      } catch {
        if (active) setNotificationPermission('unknown');
      }
    })();
    return () => { active = false; };
  }, [page]);

  const handleRequestNotifications = async () => {
    const token = await requestNotificationPermission();
    if (token || (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted')) {
      setNotificationPermission('granted');
      showToast("Notifications activées avec succès !", "success");
    } else {
      showToast("Permission refusée par le système.", "error");
    }
  };

  const openVersionNotes = async () => {
    setShowVersionNotesModal(true);
    if (!latestRelease) {
      await checkForUpdates(false);
    }
    await loadReleaseHistory(false);
  };

  const selectedPlatformNames = STREAMING_PLATFORMS.filter(platform => userPlatforms.includes(platform.id)).map(platform => platform.name);
  const platformSummary = selectedPlatformNames.length ? selectedPlatformNames.join(', ') : 'Aucune choisie';
  const activeNotifications = Object.values(notificationPrefs).filter(Boolean).length;
  const notificationSummary = activeNotifications === 0 ? 'Aucune activée' : `${activeNotifications} ${activeNotifications > 1 ? 'activées' : 'activée'}`;

  const ownedPlexSync = plexSyncStatus && (!plexSyncStatus.progress || plexSyncStatus.progress.uid === user?.uid) ? plexSyncStatus : null;
  const plexBusy = Boolean(plexSyncMode) || Boolean(ownedPlexSync && !isPlexSyncTerminal(ownedPlexSync.progress?.phase, ownedPlexSync.message));
  const plexLastSync = getPlexLastSyncTimestamp(user?.uid);
  const plexState: { text: string; tone?: SettingsTone } = !user
    ? { text: 'Connecte-toi pour associer Plex' }
    : plexAuthSession
      ? { text: 'En attente de l’autorisation…', tone: 'busy' }
      : !plexToken
        ? { text: 'Non connecté' }
        : plexBusy
          ? { text: 'Synchro en cours…', tone: 'busy' }
          : plexLastSync
            ? {
              text: `Connecté · synchro ${formatSettingsAgo(plexLastSync)}`,
              tone: Date.now() - plexLastSync < PLEX_FRESH_MS ? 'ok' : 'warn',
            }
            : { text: 'Connecté · jamais synchronisé', tone: 'warn' };
  const plexServers = plexReport?.progress?.uid === user?.uid ? plexReport?.progress?.servers || [] : [];
  const plexLinkedCount = shows.filter(show => Boolean(show.plexGuid || show.plexSlug)).length;
  const accountCounts = {
    series: shows.filter(show => show.mediaType === 'tv').length,
    films: shows.filter(show => show.mediaType === 'movie').length,
    favorites: shows.filter(show => show.isFavorite).length,
    episodes: shows.reduce((sum, show) => sum + (show.mediaType === 'tv' ? (show.seenEpisodes || []).filter(episode => episode !== 'movie').length : 0), 0),
  };

  const updaterProgress = apkUpdateProgress && (
    <div className={cn(
      "p-4 border rounded-xl flex flex-col gap-3",
      apkUpdatePresentation?.tone === 'error'
        ? "bg-red-500/10 border-red-500/25"
        : apkUpdatePresentation?.tone === 'success'
          ? "bg-emerald-500/10 border-emerald-500/25"
          : "bg-[#E5A93D]/10 border-[#E5A93D]/20"
    )}>
      <div className={cn(
        "flex items-center justify-between text-xs font-bold",
        apkUpdatePresentation?.tone === 'error'
          ? "text-red-300"
          : apkUpdatePresentation?.tone === 'success'
            ? "text-emerald-300"
            : "text-[#E5A93D]"
      )}>
        <span className="flex items-center gap-2">
          {apkUpdateProgress.status === 'downloading' ? (
            <Loader2 size={14} className="animate-spin" />
          ) : apkUpdateProgress.status === 'done' ? (
            <CheckCircle2 size={14} />
          ) : (
            <Download size={14} />
          )}
          {apkUpdatePresentation?.label}
        </span>
        <span>{apkUpdateProgress.percent}%</span>
      </div>
      <div className="w-full bg-black/40 rounded-full h-1.5 overflow-hidden">
        <div
          className={cn(
            "h-full transition-all duration-300",
            apkUpdatePresentation?.tone === 'error'
              ? "bg-red-500"
              : apkUpdatePresentation?.tone === 'success'
                ? "bg-emerald-500"
                : "bg-[#E5A93D]"
          )}
          style={{ width: `${apkUpdateProgress.percent}%` }}
        />
      </div>
      {apkUpdateProgress.status === 'error' && (
        <p className="text-[10px] text-red-400 leading-tight">
          {apkUpdateProgress.message || "Une erreur est survenue."}
        </p>
      )}
    </div>
  );

  const logsPanel = (
    <div className="border border-zinc-800 rounded-xl bg-black/60 overflow-hidden flex flex-col">
      <div className="flex overflow-x-auto custom-scrollbar border-b border-zinc-800 bg-zinc-900">
        {['all', 'plex', 'sync', 'auth', 'system', 'network'].map(cat => (
          <button
            key={cat}
            onClick={() => setSelectedLogCategory(cat)}
            className={cn(
              "px-3 py-2 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap transition-colors",
              selectedLogCategory === cat
                ? "text-[#E5A93D] border-b-2 border-[#E5A93D] bg-black/40"
                : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
            )}
          >
            {cat}
          </button>
        ))}
      </div>

      <div className="p-3 max-h-64 overflow-y-auto custom-scrollbar font-mono text-[10px]">
        {logs.length === 0 ? (
          <div className="text-zinc-500 text-center py-4">Aucun log enregistré</div>
        ) : (
          logs.filter(l => selectedLogCategory === 'all' || l.category === selectedLogCategory).map(log => (
            <div key={log.id} className="mb-2 border-b border-zinc-800/50 pb-2 last:border-0">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-zinc-500 shrink-0">
                  {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute:'2-digit', second:'2-digit' })}
                </span>
                <span className={cn(
                  "px-1.5 py-0.5 rounded text-[8px] uppercase tracking-wider shrink-0",
                  log.level === 'info' ? "bg-blue-500/10 text-blue-400" :
                  log.level === 'warn' ? "bg-amber-500/10 text-amber-400" :
                  log.level === 'error' ? "bg-red-500/10 text-red-400" :
                  "bg-emerald-500/10 text-emerald-400"
                )}>
                  {log.level}
                </span>
                <span className="text-zinc-400 uppercase text-[9px] shrink-0">[{log.category}]</span>
              </div>
              <div className={cn(
                "break-words leading-relaxed pl-1",
                log.level === 'error' ? "text-red-300" :
                log.level === 'warn' ? "text-amber-300" : "text-zinc-300"
              )}>
                {log.message}
                {log.details && (
                  <pre className="mt-1 p-1.5 bg-black/50 rounded overflow-x-auto text-[9px] text-zinc-500">
                    {typeof log.details === 'object' ? JSON.stringify(log.details, null, 2) : String(log.details)}
                  </pre>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="flex items-center justify-between p-2 bg-zinc-900 border-t border-zinc-800">
        <button
          onClick={() => clearLogs()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] text-zinc-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
        >
          <Trash2 size={12} />
          Effacer
        </button>
        <button
          onClick={() => {
            navigator.clipboard.writeText(getLogsAsText());
            setCopiedLogs(true);
            setTimeout(() => setCopiedLogs(false), 2000);
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
        >
          {copiedLogs ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
          {copiedLogs ? "Copié !" : "Copier tout"}
        </button>
      </div>
    </div>
  );

  const avatar = avatarUrl && !avatarFailed
    ? <img src={avatarUrl} alt="" onError={() => setAvatarFailed(true)} />
    : <span aria-hidden="true">{getProfileInitials(user?.displayName, user?.email)}</span>;
  const accountName = user?.displayName || user?.email?.split('@')[0] || 'Compte';
  const accountState = isQuotaExceeded
    ? { text: 'Quota cloud atteint · synchro en pause', tone: 'error' as const }
    : { text: 'Synchronisation automatique', tone: 'ok' as const };

  const pages: Record<SettingsPage, { title: string; content: ReactNode }> = {
    plats: {
      title: 'Mes plateformes',
      content: (
        <>
          <p className="reg-intro">Sert pour « inclus dans ton abonnement », le filtre Mes plateformes et les notifications.</p>
          <div className="reg-plats">
            {STREAMING_PLATFORMS.map(platform => {
              const selected = userPlatforms.includes(platform.id);
              return (
                <button key={platform.id} type="button" className="reg-plat" aria-pressed={selected} onClick={() => handleTogglePlatform(platform.id)}>
                  {platformLogoUrl(platformLogos[platform.id]) && !brokenLogos.has(platform.id) ? (
                    <span className="reg-plat-logo" data-logo="true" aria-hidden="true">
                      <img src={platformLogoUrl(platformLogos[platform.id])!} alt="" loading="lazy" decoding="async"
                        onError={() => setBrokenLogos(current => new Set(current).add(platform.id))} />
                    </span>
                  ) : (
                    <span className="reg-plat-logo" style={{ background: platform.tile, color: platform.ink }} aria-hidden="true">{platform.short}</span>
                  )}
                  {platform.name}
                  {selected && <span className="reg-plat-check" aria-hidden="true"><Check size={11} strokeWidth={3.4} /></span>}
                </button>
              );
            })}
          </div>
        </>
      ),
    },
    notifs: {
      title: 'Notifications',
      content: (
        <>
          {notificationPermission === 'granted' ? (
            <SettingsCard tile={<Check size={20} strokeWidth={3} />} tone="ok" title={`Autorisées sur ${devicePlace}`}
              sub={isAndroid ? 'Son, vibration et masquage se règlent par type dans Android.' : 'Le navigateur affiche les rappels même app fermée.'}
              status="Rappels envoyés à 09:00" />
          ) : (
            <SettingsCard tile={<Bell size={20} />} tone={notificationPermission === 'denied' ? 'error' : undefined}
              title={notificationPermission === 'denied' ? `Bloquées sur ${devicePlace}` : 'Notifications à autoriser'}
              sub={notificationPermission === 'denied' ? 'Autorise SeenIt dans les réglages du système, puis reviens ici.' : 'Rappels envoyés à 09:00 pour tes séries et tes films.'}>
              {window.self !== window.top && <p className="reg-message">Chrome bloque les notifications dans cet aperçu.</p>}
              <button type="button" className="reg-primary" onClick={() => void handleRequestNotifications()}>Autoriser les notifications</button>
            </SettingsCard>
          )}
          <SettingsGroup title="Séries">
            <SettingsRow icon={Tv} label="Nouvel épisode" sub="Le jour de la diffusion" toggle={notificationPrefs.release_today_tv} onClick={() => void handleToggleNotif('release_today_tv', !notificationPrefs.release_today_tv)} />
            <SettingsRow icon={Clock} label="Nouvelle saison" sub="7 jours avant" toggle={notificationPrefs.season_d7} onClick={() => void handleToggleNotif('season_d7', !notificationPrefs.season_d7)} />
            <SettingsRow icon={Newspaper} label="Actualités" sub="Renouvellements, annulations, saisons annoncées" toggle={notificationPrefs.news} onClick={() => void handleToggleNotif('news', !notificationPrefs.news)} />
          </SettingsGroup>
          <SettingsGroup title="Films">
            <SettingsRow icon={Film} label="Sortie au cinéma" sub="Le jour J, en France" toggle={notificationPrefs.movie_theater} onClick={() => void handleToggleNotif('movie_theater', !notificationPrefs.movie_theater)} />
            <SettingsRow icon={Film} label="Sortie DVD / VOD" sub="Le jour J, si la date est connue" toggle={notificationPrefs.movie_dvd_vod} onClick={() => void handleToggleNotif('movie_dvd_vod', !notificationPrefs.movie_dvd_vod)} />
          </SettingsGroup>
          <SettingsGroup title="Autres alertes" foot={isAndroid ? 'Coupées ou réglées dans Android, type par type.' : 'Réglées par le navigateur.'}>
            {ANDROID_ALERTS.map(alert => (
              <SettingsRow key={alert.channelId} icon={alert.icon} label={alert.label} sub={alert.sub}
                onClick={isAndroid ? () => { void NotificationSettings.openChannel({ channelId: alert.channelId }).catch(() => showToast('Réglages Android indisponibles.', 'error')); } : undefined} />
            ))}
          </SettingsGroup>
          <SettingsGroup>
            {isAndroid && (
              <SettingsRow icon={Smartphone} label="Réglages Android" sub="Son et vibration par type"
                onClick={() => { void NotificationSettings.open().catch(() => showToast('Réglages Android indisponibles.', 'error')); }} />
            )}
            <SettingsRow icon={FlaskConical} label="Envoyer une notification test" sub="Avec un titre de ta liste" chevron={false}
              expanded={showNotificationTests} onClick={() => setShowNotificationTests(value => !value)} />
            {showNotificationTests && NOTIFICATION_TESTS.map(test => (
              <SettingsRow key={test.type} label={test.label} sub={test.sub} chevron={false} onClick={() => void triggerTestNotif(test.type)} />
            ))}
          </SettingsGroup>
        </>
      ),
    },
    plex: {
      title: 'Plex',
      content: !user ? (
        <SettingsCard tile="PX" title="Plex" sub="Connecte-toi à ton compte SeenIt pour associer Plex." />
      ) : !plexToken ? (
        <SettingsCard tile="PX" tone={plexAuthError ? 'error' : undefined} title="Plex non connecté"
          sub="Associe ton compte pour l’historique, les badges « Dans Plex » et les liens directs." spinning={Boolean(plexAuthSession)}
          status={plexAuthSession ? 'En attente de l’autorisation dans Plex…' : undefined} statusTone="busy">
          {plexAuthError && <p className="reg-message">{plexAuthError}</p>}
          <button type="button" className="reg-primary" onClick={handlePlexLogin} disabled={isStartingPlexAuth || Boolean(plexAuthSession)}>
            {isStartingPlexAuth ? 'Ouverture…' : plexAuthSession ? 'En attente…' : plexAuthError ? 'Réessayer l’association Plex' : 'Connecter Plex'}
          </button>
          {plexAuthSession && <button type="button" className="reg-secondary" onClick={handleCancelPlexLogin}>Annuler l’association</button>}
        </SettingsCard>
      ) : (
        <>
          <SettingsCard tile="PX" tone={plexState.tone === 'ok' ? 'ok' : undefined} title={getStoredPlexUsername(user.uid) || 'Compte Plex'}
            sub={`${plexLinkedCount.toLocaleString('fr-FR')} ${plexLinkedCount > 1 ? 'titres reconnus' : 'titre reconnu'} dans ta liste`}
            status={plexState.text} statusTone={plexState.tone} spinning={plexBusy}>
            {!plexBusy && <button type="button" className="reg-primary" onClick={() => void handlePlexSync(true)}>Synchroniser maintenant</button>}
          </SettingsCard>
          {plexServers.length > 0 && (
            <SettingsGroup title="État" foot="Un point vert : tout va bien. Orange : à vérifier.">
              {plexServers.map((server, index) => (
                <SettingsRow key={server.id || index} icon={Server} label={server.name}
                  sub={`${server.owned === undefined ? '' : server.owned ? 'Ton serveur · ' : 'Partagé · '}${server.reason || `${server.watchedItems ?? 0} vus · ${server.inventoryItems ?? 0} indexés`}`}
                  tone={server.reason ? 'warn' : 'ok'} dot />
              ))}
            </SettingsGroup>
          )}
          <SettingsGroup title="Actions">
            <SettingsRow icon={RefreshCw} label="Synchro complète" sub="Relit toute ta bibliothèque Plex, depuis le début" busy={plexSyncMode === 'full'}
              disabled={plexBusy} onClick={() => void handlePlexSync(false)} />
          </SettingsGroup>
          <button type="button" className="reg-danger" onClick={() => setConfirm('plexout')}>Déconnecter Plex</button>
        </>
      ),
    },
    devices: {
      title: 'Appareils',
      content: (
        <>
          <SettingsGroup title={isNative ? 'Ce téléphone' : 'Ce navigateur'}>
            <SettingsRow icon={Smartphone} label={isNative ? 'Ce téléphone' : 'Ce navigateur'}
              sub={notificationPermission === 'granted' ? 'Notifications autorisées' : notificationPermission === 'denied' ? 'Notifications bloquées' : 'Notifications à autoriser'}
              tone={notificationPermission === 'granted' ? 'ok' : notificationPermission === 'denied' ? 'error' : 'warn'} dot
              onClick={notificationPermission === 'granted' ? undefined : () => setPage('notifs')} />
          </SettingsGroup>
          <SettingsGroup title="SeenIt TV" foot="La dissociation se fait depuis la TV. Rien n’est effacé de ton compte.">
            <SettingsRow icon={Tv} label="Associer une TV" sub="Ouvre SeenIt TV, scanne le QR code affiché, puis confirme sur ce téléphone." />
          </SettingsGroup>
        </>
      ),
    },
    compte: {
      title: 'Compte',
      content: user ? (
        <>
          <SettingsCard tile={<span className="reg-avatar">{avatar}</span>} title={accountName} sub={`${user.email || ''} · Google`}
            status={accountState.text} statusTone={accountState.tone} />
          <SettingsGroup title="Dans ton compte">
            <SettingsRow icon={Cloud} label={`${accountCounts.series.toLocaleString('fr-FR')} séries · ${accountCounts.films.toLocaleString('fr-FR')} films`}
              sub={`${accountCounts.favorites.toLocaleString('fr-FR')} favoris · ${accountCounts.episodes.toLocaleString('fr-FR')} épisodes vus`} />
          </SettingsGroup>
          <SettingsGroup>
            <SettingsRow icon={UploadCloud} label="Sauvegarder maintenant" sub="La synchro est automatique, c’est un secours" onClick={() => void handleBackupToCloud()} />
            <SettingsRow icon={DownloadCloud} label="Recharger depuis le cloud" sub="Remplace ce qui est sur ce téléphone" onClick={() => void handleRestoreFromCloud()} />
          </SettingsGroup>
          <button type="button" className="reg-danger" onClick={() => setConfirm('logout')}>Se déconnecter</button>
        </>
      ) : (
        <SettingsCard tile={<LogIn size={20} />} title="Pas de compte connecté" sub="Connecte-toi pour retrouver ta bibliothèque sur tous tes appareils.">
          <button type="button" className="reg-primary" onClick={handleLogin}>Continuer avec Google</button>
        </SettingsCard>
      ),
    },
    app: {
      title: 'Application',
      content: (
        <>
          {hasUpdate && latestRelease ? (
            <SettingsCard tile={latestRelease.version.split('.').slice(0, 2).join('.')} tone="gold" title={`SeenIt ${latestRelease.version}`}
              sub={`Tu as la ${currentVersion}`} status="Mise à jour prête à installer" statusTone="busy">
              <button type="button" className="reg-primary" onClick={handleStartUpdate} disabled={apkUpdateProgress?.status === 'downloading'}>Installer la mise à jour</button>
              {updaterProgress}
            </SettingsCard>
          ) : (
            <SettingsCard tile={currentVersion.split('.').slice(0, 2).join('.')} title={`SeenIt ${currentVersion}`}
              sub={lastChecked ? `Vérifiée ${formatSettingsAgo(lastChecked) || ''}` : 'Version installée'}
              status={lastChecked ? 'À jour' : undefined} statusTone="ok" spinning={isCheckingUpdates}>
              <button type="button" className="reg-secondary" onClick={handleCheckUpdates} disabled={isCheckingUpdates}>Vérifier les mises à jour</button>
              {updaterProgress}
            </SettingsCard>
          )}
          <SettingsGroup>
            <SettingsRow icon={Sparkles} label="Nouveautés" sub="Toutes les versions et leurs changements" onClick={openVersionNotes} />
            <SettingsRow icon={Sun} label="Badges animés" sub="Les sorties du jour bougent dans À voir" toggle={animatedBadges} onClick={() => setAnimatedBadges(!animatedBadges)} />
          </SettingsGroup>
          <SettingsGroup title="Fonctionnalités">
            <DownloadFeatureSettingsRow />
          </SettingsGroup>
          <SettingsGroup title="Avancé">
            <SettingsRow icon={FileText} label="Importer depuis TV Time" sub="Fichier CSV" chevron={false} expanded={showCsvImport} onClick={() => setShowCsvImport(value => !value)} />
            {showCsvImport && <div className="reg-inline"><CsvImporter /></div>}
            <SettingsRow icon={RefreshCw} label="Forcer la synchro TMDB"
              sub={syncStatus ? `En cours · ${syncStatus.total - syncStatus.pending + 1} / ${syncStatus.total}` : 'Recharge les fiches et les dates'}
              tone={syncStatus ? 'busy' : undefined} busy={isSyncing || Boolean(syncStatus)} disabled={isSyncing || Boolean(syncStatus) || !user}
              chevron={false} onClick={() => void handleForceSync()} />
            <SettingsRow icon={Terminal} label="Journal de diagnostic"
              sub={diagnosticsEnabled ? 'Activé · pour un rapport de bug' : 'Désactivé · seules les alertes et erreurs sont gardées'}
              toggle={diagnosticsEnabled} onClick={() => setDiagnosticsEnabled(!diagnosticsEnabled)} />
            <SettingsRow icon={FileText} label="Voir le journal" sub="Copier ou vider" chevron={false}
              expanded={showLogsPanel} onClick={() => setShowLogsPanel(value => !value)} />
            {showLogsPanel && <div className="reg-inline">{logsPanel}</div>}
          </SettingsGroup>
        </>
      ),
    },
  };

  return (
    <div className="reg-root flex-1 overflow-y-auto pb-nav custom-scrollbar">
      <div className="reg-page">
        <SettingsHeader title="Réglages" onBack={onClose} backLabel="Fermer les réglages" />

        {user ? (
          <button type="button" className="reg-account" onClick={() => setPage('compte')}>
            <span className="reg-avatar">{avatar}</span>
            <span className="reg-account-text">
              <strong>{accountName}</strong>
              <small>{user.email}</small>
              <span className="reg-state" data-tone={accountState.tone}><span className="reg-dot" data-tone={accountState.tone} aria-hidden="true" />{accountState.text}</span>
            </span>
            <ChevronRight size={18} strokeWidth={2.4} className="reg-chev" aria-hidden="true" />
          </button>
        ) : (
          <SettingsCard tile={<LogIn size={20} />} title="Compte" sub="Connecte-toi pour retrouver ta bibliothèque sur tous tes appareils.">
            <button type="button" className="reg-primary" onClick={handleLogin}>Continuer avec Google</button>
          </SettingsCard>
        )}

        <SettingsGroup>
          <SettingsRow icon={LayoutGrid} label="Mes plateformes" sub={platformSummary} onClick={() => setPage('plats')} />
          <SettingsRow icon={Bell} label="Notifications" sub={`${notificationSummary} · rappels à 09:00`} onClick={() => setPage('notifs')} />
        </SettingsGroup>

        <SettingsGroup title="Connexions">
          <SettingsRow icon={Server} label="Plex" sub={plexState.text} tone={plexState.tone} dot={Boolean(plexState.tone)} onClick={() => setPage('plex')} />
          <SettingsRow icon={MonitorSmartphone} label="Appareils" sub={`${isNative ? 'Ce téléphone' : 'Ce navigateur'} · SeenIt TV par QR code`} onClick={() => setPage('devices')} />
        </SettingsGroup>

        <SettingsGroup>
          <SettingsRow icon={Package} label="Application"
            sub={hasUpdate && latestRelease ? `Version ${latestRelease.version} disponible` : `Version ${currentVersion}${lastChecked ? ' · à jour' : ''}`}
            badge={hasUpdate && latestRelease ? 'Mise à jour' : undefined} onClick={() => setPage('app')} />
        </SettingsGroup>

        {user && <button type="button" className="reg-danger" onClick={() => setConfirm('logout')}>Se déconnecter</button>}
        <span className="reg-version">SeenIt {currentVersion}</span>
      </div>

      {page && (
        <SettingsSubscreen title={pages[page].title} onClose={() => setPage(null)}>
          {pages[page].content}
        </SettingsSubscreen>
      )}

      {confirm === 'logout' && (
        <SettingsConfirm title="Se déconnecter ?" body="Tes séries et films restent dans le cloud. Tu les retrouves en te reconnectant."
          confirmLabel="Se déconnecter" onCancel={() => setConfirm(null)}
          onConfirm={() => { setConfirm(null); void handleLogout(); }} />
      )}
      {confirm === 'plexout' && (
        <SettingsConfirm title="Déconnecter Plex ?" body="Les badges et liens Plex disparaissent. Ton historique SeenIt ne bouge pas."
          confirmLabel="Déconnecter" onCancel={() => setConfirm(null)}
          onConfirm={() => { setConfirm(null); void handlePlexLogout(); }} />
      )}

      {/* Dedicated Version Notes Modal */}
      {showVersionNotesModal && createPortal(
        <DialogLayer onDismiss={() => { if (apkUpdateProgress?.status !== 'downloading') setShowVersionNotesModal(false); }} label="Notes de version" canDismiss={apkUpdateProgress?.status !== 'downloading'} historyMode="local" role="dialog"
          className="fixed inset-0 z-[99999] bg-black/85 backdrop-blur-md flex items-center justify-center p-2.5 pb-6 sm:p-4 animate-in fade-in duration-200"
          onClick={() => {
            if (apkUpdateProgress?.status !== 'downloading') {
              setShowVersionNotesModal(false);
            }
          }}
        >
          <div
            className="bg-[#121218] border border-white/10 rounded-3xl w-full max-w-lg sm:max-w-2xl overflow-hidden shadow-[0_25px_60px_-15px_rgba(0,0,0,0.95)] flex flex-col my-auto animate-in zoom-in-95 duration-200 shrink-0"
            onClick={(e) => e.stopPropagation()}
            style={{ maxHeight: 'min(94vh, calc(100dvh - 16px))' }}
          >
            {/* Header */}
            <div className="p-4 sm:p-5 pb-3 bg-gradient-to-b from-amber-500/10 to-transparent border-b border-white/5 flex items-start justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-amber-500 flex items-center justify-center text-black shadow-lg shadow-amber-500/30 shrink-0">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                    Historique des versions
                  </h3>
                  <p className="text-xs text-amber-400/90 font-medium">
                    Version installée : SeenIt v{currentVersion}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  if (apkUpdateProgress?.status !== 'downloading') {
                    setShowVersionNotesModal(false);
                  }
                }}
                className="text-zinc-400 hover:text-white p-1.5 rounded-full hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Body Content */}
            <div
              className="p-4 sm:p-5 overflow-y-auto min-h-0 space-y-4 flex-1 text-sm text-zinc-300 custom-scrollbar overscroll-contain touch-pan-y"
              style={{
                WebkitOverflowScrolling: 'touch',
                touchAction: 'pan-y',
                overscrollBehavior: 'contain'
              }}
            >
              <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                Tous les changelogs officiels
              </div>

              <div className="bg-black/40 border border-white/5 rounded-2xl p-4 max-h-80 sm:max-h-[28rem] md:max-h-[32rem] overflow-y-auto custom-scrollbar">
                {isLoadingReleaseHistory || (isCheckingUpdates && !latestRelease) ? (
                  <div className="py-8 flex flex-col items-center justify-center gap-2 text-zinc-400 text-xs">
                    <Loader2 className="w-5 h-5 animate-spin text-amber-400" />
                    <span>Chargement de l'historique des versions...</span>
                  </div>
                ) : releaseHistory.length > 0 ? (
                  <ReleaseHistoryViewer history={releaseHistory} />
                ) : (
                  <div className="py-6 text-center text-zinc-400 text-xs">
                    <p>{releaseHistoryError || 'Aucune note de version détaillée disponible pour le moment.'}</p>
                    <p className="text-[11px] text-zinc-500 mt-1">Version installée : v{currentVersion}</p>
                  </div>
                )}
              </div>

              {/* Download Progress Bar if updating */}
              {apkUpdateProgress && apkUpdateProgress.status !== 'idle' && (
                <div className={cn(
                  "border rounded-2xl p-3.5 space-y-2 animate-in fade-in duration-200",
                  apkUpdateProgress.status === 'error'
                    ? "bg-red-500/10 border-red-500/30"
                    : "bg-amber-500/10 border-amber-500/30"
                )}>
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span className={cn(
                      "flex items-center gap-2",
                      apkUpdateProgress.status === 'error' ? "text-red-300" : "text-amber-300"
                    )}>
                      {apkUpdateProgress.status === 'downloading' && (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400 shrink-0" />
                      )}
                      {apkUpdateProgress.status === 'installing' && (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      )}
                      {apkUpdateProgress.status === 'done' && (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      )}
                      {apkUpdateProgress.status === 'error' && (
                        <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                      )}
                      <span className="break-words line-clamp-2">{apkUpdateProgress.message}</span>
                    </span>
                    <span className={apkUpdateProgress.status === 'error' ? "text-red-400 font-mono" : "text-amber-400 font-mono"}>
                      {apkUpdateProgress.percent}%
                    </span>
                  </div>

                  <div className="w-full bg-zinc-800 rounded-full h-2 overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-300",
                        apkUpdateProgress.status === 'error' ? "bg-red-500" : "bg-gradient-to-r from-amber-400 to-amber-500"
                      )}
                      style={{ width: `${apkUpdateProgress.percent}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 sm:p-5 pt-3 bg-zinc-950/80 border-t border-white/5 flex items-center justify-end gap-2.5 shrink-0">
              <button
                onClick={() => setShowVersionNotesModal(false)}
                className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer"
              >
                Fermer
              </button>

              {hasUpdate && latestRelease && (
                <button
                  onClick={handleStartUpdate}
                  disabled={apkUpdateProgress?.status === 'downloading'}
                  className="px-4 py-2.5 bg-amber-500 hover:bg-amber-400 active:scale-95 text-black rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-amber-500/25 transition-all cursor-pointer disabled:opacity-50"
                >
                  <Download className="w-4 h-4" />
                  <span>Installer v{latestRelease.version}</span>
                </button>
              )}
            </div>
          </div>
        </DialogLayer>,
        document.body
      )}
    </div>
  );
}
