import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Cloud, LogIn, LogOut, FileText, CheckCircle2, MonitorPlay, Bell, RefreshCw, Loader2, Terminal, Copy, Trash2, ChevronDown, ChevronUp, ChevronRight, Check, AlertCircle, Info, Bug, Sparkles, Download, X, UploadCloud, DownloadCloud } from 'lucide-react';
import { auth, db, googleAuthProvider, requestNotificationPermission, sendNativeNotification } from '../lib/firebase';
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { signInWithPopup, signInWithCredential, GoogleAuthProvider, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { GoogleAuth } from '@codetrix-studio/capacitor-google-auth';
import { cn, openExternalUrl } from '../lib/utils';
import { CsvImporter } from '../components/CsvImporter';
import { useToastStore } from '../store/toastStore';
import { useSyncStore } from '../store/syncStore';
import { useShowsStore } from '../store/showsStore';
import { useLogStore, appLogger, LogCategory } from '../store/logStore';
import { useUpdateStore, CURRENT_APP_VERSION } from '../store/updateStore';
import { performDetailsSync } from '../hooks/useDetailsSyncWorker';
import { getPlexPin, checkPlexPin } from '../services/plex';
import { performPlexSync } from '../features/plex/syncPlex';
import { SeenItLogo } from '../components/SeenItLogo';
import { ChangelogViewer } from '../components/ChangelogViewer';
import { DownloadConfigSection } from '../components/DownloadConfigSection';
import { downloadAndInstallApk, UpdateProgress } from '../services/appUpdater';

const STREAMING_PLATFORMS = [
  { id: 8, name: 'Netflix' },
  { id: 119, name: 'Prime Video' },
  { id: 337, name: 'Disney+' },
  { id: 381, name: 'Canal+ / MyCanal' },
  { id: 350, name: 'Apple TV+' },
  { id: 531, name: 'Paramount+' },
  { id: 1899, name: 'Max' },
  { id: 234, name: 'France TV' },
  { id: 239, name: 'Arte' }
];

function PlexLogSection() {
  const [showLogs, setShowLogs] = useState(false);
  const plexStatus = useSyncStore(state => state.plexSyncStatus);
  const logs = useLogStore(state => state.logs);
  const plexLogs = logs.filter(l => l.category === 'plex').slice(0, 30);

  return (
    <div className="mt-1.5 flex flex-col gap-2">
      {plexStatus?.message && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-2.5 flex items-center gap-2 text-xs text-amber-300 font-medium animate-pulse">
          <Loader2 size={13} className="animate-spin text-amber-400 shrink-0" />
          <span>{plexStatus.message}</span>
        </div>
      )}

      <button
        onClick={() => setShowLogs(!showLogs)}
        className="flex items-center justify-between text-[11px] text-zinc-400 hover:text-zinc-200 bg-zinc-900/80 p-2 rounded-lg border border-white/5 font-mono cursor-pointer"
      >
        <span className="flex items-center gap-1.5">
          <Terminal size={12} className="text-amber-400 shrink-0" />
          Journaux de synchro Plex ({plexLogs.length})
        </span>
        {showLogs ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>

      {showLogs && (
        <div className="bg-black/90 border border-zinc-800 rounded-xl p-2.5 max-h-48 overflow-y-auto font-mono text-[10px] space-y-1.5 shadow-inner">
          {plexLogs.length === 0 ? (
            <p className="text-zinc-600 italic">Aucun journal Plex pour le moment. Lancez une synchro.</p>
          ) : (
            plexLogs.map(log => {
              const timeStr = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
              return (
                <div key={log.id} className="flex gap-2 items-start leading-tight">
                  <span className="text-zinc-600 shrink-0">[{timeStr}]</span>
                  <span className={cn(
                    "break-all",
                    log.level === 'error' && "text-red-400 font-semibold",
                    log.level === 'warn' && "text-amber-400",
                    log.level === 'success' && "text-emerald-400 font-semibold",
                    log.level === 'info' && "text-zinc-300"
                  )}>
                    {log.message}
                  </span>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

export function SettingsScreen() {
  const { showToast } = useToastStore();
  const syncStatus = useSyncStore(state => state.syncStatus);
  const shows = useShowsStore(state => state.shows);
  const { logs, clearLogs, getLogsAsText } = useLogStore();
  const { currentVersion, latestRelease, hasUpdate, isChecking: isCheckingUpdates, lastChecked, checkForUpdates } = useUpdateStore();
  const [apkUpdateProgress, setApkUpdateProgress] = useState<UpdateProgress | null>(null);
  const [showVersionNotesModal, setShowVersionNotesModal] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [userPlatforms, setUserPlatforms] = useState<number[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  
  const [notificationPrefs, setNotificationPrefs] = useState(() => {
    const saved = localStorage.getItem('user_notifications');
    return saved ? JSON.parse(saved) : {
      release_today_tv: true,
      season_d7: true,
      movie_theater: true,
      movie_dvd_vod: true
    };
  });

  const handleToggleNotif = async (key: string, value: boolean) => {
    const newPrefs = { ...notificationPrefs, [key]: value };
    setNotificationPrefs(newPrefs);
    localStorage.setItem('user_notifications', JSON.stringify(newPrefs));
    if (auth.currentUser) {
      try {
        const notifRef = doc(db, 'users', auth.currentUser.uid, 'settings', 'notifications');
        await setDoc(notifRef, newPrefs, { merge: true });
      } catch (e) {
        console.error('[Settings] Error saving notification prefs to Firestore', e);
      }
    }
  };

  // Plex Auth State
  const [plexPin, setPlexPin] = useState<any>(null);
  const [plexToken, setPlexToken] = useState<string | null>(
    localStorage.getItem('plex_auth_token') || localStorage.getItem('plex_token') || null
  );
  const [plexSyncMode, setPlexSyncMode] = useState<'delta' | 'full' | null>(null);

  // App Logs state
  const [showLogsPanel, setShowLogsPanel] = useState(false);
  const [selectedLogCategory, setSelectedLogCategory] = useState<string>('all');
  const [copiedLogs, setCopiedLogs] = useState(false);

  useEffect(() => {
    let interval: any;
    if (plexPin && !plexToken) {
      interval = setInterval(async () => {
        try {
          const res = await checkPlexPin(plexPin.id);
          if (res.authToken) {
            setPlexToken(res.authToken);
            localStorage.setItem('plex_auth_token', res.authToken);
            localStorage.setItem('plex_token', res.authToken);
            if (res.username) {
              localStorage.setItem('plex_username', res.username);
            }
            if (user) {
              try {
                const plexRef = doc(db, 'users', user.uid, 'settings', 'plex');
                await setDoc(plexRef, { authToken: res.authToken, username: res.username || '' }, { merge: true });
              } catch (err) {
                console.error('[Settings] Erreur sauvegarde Plex dans Firestore:', err);
              }
            }
            setPlexPin(null);
            showToast("Compte Plex connecté !", "success");
            appLogger.success('plex', 'Compte Plex authentifié avec succès');
            clearInterval(interval);
            // Déclencher automatiquement une synchronisation complète pour peupler la bibliothèque
            performPlexSync({ delta: false, silent: false, ignoreCooldown: true });
          }
        } catch (e: any) {
          console.error(e);
          appLogger.error('plex', 'Erreur lors du suivi du PIN Plex', e);
        }
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [plexPin, plexToken, user, showToast]);

  const handlePlexLogin = async () => {
    try {
      const pin = await getPlexPin();
      setPlexPin(pin);
      const authUrl = `https://app.plex.tv/auth#?clientID=${pin.clientIdentifier}&code=${pin.code}&context[device][product]=TV%20Time%20Sync`;
      await openExternalUrl(authUrl);
    } catch (e: any) {
      showToast("Erreur de connexion à Plex", "error");
      appLogger.error('plex', 'Erreur génération PIN Plex', e);
    }
  };

  const handlePlexSync = async (delta: boolean = true) => {
    if (!plexToken || !user) return;
    setPlexSyncMode(delta ? 'delta' : 'full');
    try {
      await performPlexSync({ delta, silent: false, ignoreCooldown: true });
    } catch (e: any) {
      showToast(`Erreur système: ${e?.message || e}`, "error");
    } finally {
      setPlexSyncMode(null);
    }
  };

  const handlePlexLogout = async () => {
    setPlexToken(null);
    localStorage.removeItem('plex_auth_token');
    localStorage.removeItem('plex_token');
    localStorage.removeItem('plex_username');
    if (user) {
      try {
        const plexRef = doc(db, 'users', user.uid, 'settings', 'plex');
        await deleteDoc(plexRef);
      } catch (err) {
        console.error('[Settings] Erreur suppression Plex Firestore:', err);
      }
    }
    showToast("Compte Plex déconnecté.", "info");
    appLogger.info('plex', 'Compte Plex déconnecté');
  };

  useEffect(() => {
    const savedPlatforms = localStorage.getItem('user_platforms');
    if (savedPlatforms) {
      try {
        setUserPlatforms(JSON.parse(savedPlatforms));
      } catch (e) {}
    }
    
    const handleStorage = () => {
      const platforms = localStorage.getItem('user_platforms');
      if (platforms) {
        try {
          setUserPlatforms(JSON.parse(platforms));
        } catch (e) {}
      }
    };
    window.addEventListener('storage', handleStorage);
        
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        try {
          // 1. Plateformes de streaming
          const prefRef = doc(db, 'users', currentUser.uid, 'settings', 'preferences');
          const snap = await getDoc(prefRef);
          const localStr = localStorage.getItem('user_platforms');
          const localPlatforms = localStr ? JSON.parse(localStr) : [];

          if (snap.exists() && Array.isArray(snap.data()?.platforms)) {
            const cloudPlatforms: number[] = snap.data().platforms;
            setUserPlatforms(cloudPlatforms);
            localStorage.setItem('user_platforms', JSON.stringify(cloudPlatforms));
          } else if (localPlatforms.length > 0) {
            await setDoc(prefRef, { platforms: localPlatforms }, { merge: true });
          }

          // 2. Préférences de notifications
          const notifRef = doc(db, 'users', currentUser.uid, 'settings', 'notifications');
          const snapNotif = await getDoc(notifRef);
          const localNotifStr = localStorage.getItem('user_notifications');
          const localNotifs = localNotifStr ? JSON.parse(localNotifStr) : null;

          if (snapNotif.exists()) {
            const cloudNotifs = snapNotif.data();
            setNotificationPrefs(cloudNotifs);
            localStorage.setItem('user_notifications', JSON.stringify(cloudNotifs));
          } else if (localNotifs) {
            await setDoc(notifRef, localNotifs, { merge: true });
          }

          // 3. Configuration Plex synchronisée
          const plexRef = doc(db, 'users', currentUser.uid, 'settings', 'plex');
          const snapPlex = await getDoc(plexRef);
          const localPlexToken = localStorage.getItem('plex_auth_token') || localStorage.getItem('plex_token');

          if (snapPlex.exists() && snapPlex.data()?.authToken) {
            const cloudPlexToken = snapPlex.data().authToken;
            setPlexToken(cloudPlexToken);
            localStorage.setItem('plex_auth_token', cloudPlexToken);
            localStorage.setItem('plex_token', cloudPlexToken);
            if (snapPlex.data()?.username) {
              localStorage.setItem('plex_username', snapPlex.data().username);
            }
          } else if (localPlexToken) {
            await setDoc(plexRef, { 
              authToken: localPlexToken, 
              username: localStorage.getItem('plex_username') || '' 
            }, { merge: true });
          }
        } catch (e: any) {
          const errorMessage = e?.message || String(e);
          const isOffline = !navigator.onLine || 
                            errorMessage.toLowerCase().includes('offline') || 
                            e?.code === 'unavailable';
          if (isOffline) {
            console.warn('[Settings] Client is offline, using local cached settings:', errorMessage);
          } else {
            console.error('[Settings] Error syncing cloud settings', e);
          }
        }
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

        const plexTokenLocal = localStorage.getItem('plex_auth_token') || localStorage.getItem('plex_token');
        if (plexTokenLocal) {
          const plexRef = doc(db, 'users', user.uid, 'settings', 'plex');
          await setDoc(plexRef, { authToken: plexTokenLocal, username: localStorage.getItem('plex_username') || '' }, { merge: true });
        }

        showToast(`✅ ${res.count} série(s) & vos réglages synchronisés avec le Cloud !`, "success");
      } else {
        showToast(`Erreur : ${res.error || 'Erreur inconnue'}`, "error");
      }
    } catch (e: any) {
      showToast(`Erreur : ${e?.message || e}`, "error");
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
        localStorage.setItem('user_platforms', JSON.stringify(snap.data().platforms));
      }

      // Recharger notifications
      const notifRef = doc(db, 'users', user.uid, 'settings', 'notifications');
      const snapNotif = await getDoc(notifRef);
      if (snapNotif.exists()) {
        setNotificationPrefs(snapNotif.data());
        localStorage.setItem('user_notifications', JSON.stringify(snapNotif.data()));
      }

      // Recharger Plex
      const plexRef = doc(db, 'users', user.uid, 'settings', 'plex');
      const snapPlex = await getDoc(plexRef);
      if (snapPlex.exists() && snapPlex.data()?.authToken) {
        setPlexToken(snapPlex.data().authToken);
        localStorage.setItem('plex_auth_token', snapPlex.data().authToken);
        localStorage.setItem('plex_token', snapPlex.data().authToken);
        if (snapPlex.data()?.username) {
          localStorage.setItem('plex_username', snapPlex.data().username);
        }
      }

      showToast("✅ Données Cloud rechargées avec succès !", "success");
    } catch (e: any) {
      showToast(`Erreur : ${e?.message || e}`, "error");
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
      console.error(err);
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
    localStorage.setItem('user_platforms', JSON.stringify(newPlatforms));
    window.dispatchEvent(new Event('storage'));

    if (auth.currentUser) {
      try {
        const prefRef = doc(db, 'users', auth.currentUser.uid, 'settings', 'preferences');
        await setDoc(prefRef, { platforms: newPlatforms }, { merge: true });
      } catch (e) {
        console.error('[Settings] Error saving streaming platforms to Firestore', e);
      }
    }
  };

  const handleLogin = async () => {
    try {
      if (Capacitor.isNativePlatform()) {
        await GoogleAuth.initialize({
          clientId: '799043440232-i9s1l0jaerljg58v3oooleuemnhnim4o.apps.googleusercontent.com',
          scopes: ['profile', 'email'],
          grantOfflineAccess: true,
        });
        const googleUser = await GoogleAuth.signIn();
        const idToken = googleUser.authentication?.idToken || (googleUser as any)?.idToken;
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
    localStorage.setItem('explicit_logout', 'true');
    await signOut(auth);
  };

  const triggerTestNotif = (type: string) => {
    showToast("🔔 Test envoyé à votre téléphone !", "info");

    const activeShows = shows.filter(s => !s.isArchived && s.status !== 'dropped');
    const targetShow = activeShows.find(s => s.mediaType === 'tv' && s.nextEpisodeToWatch)
      || activeShows.find(s => s.mediaType === 'tv')
      || shows.find(s => !s.isArchived)
      || shows[0];
      
    let notifBody = "L'alerte a bien été déclenchée !";
    if (type === 'release_today_tv') notifBody = "L'épisode S01E01 est disponible aujourd'hui !";
    if (type === 'season_d7') notifBody = "La nouvelle saison sort dans 7 jours ! Préparez-vous !";
    if (type === 'movie_theater') notifBody = "Sortie Cinéma : Le film est dans les salles aujourd'hui !";
    if (type === 'movie_dvd_vod') notifBody = "Sortie DVD / VOD : Le film est désormais disponible !";

    if (targetShow) {
      const iconUrl = targetShow.posterPath 
        ? (targetShow.posterPath.startsWith('http') ? targetShow.posterPath : `https://image.tmdb.org/t/p/w185${targetShow.posterPath}`)
        : '/icon-192.png';
      const imageUrl = targetShow.backdropPath 
        ? (targetShow.backdropPath.startsWith('http') ? targetShow.backdropPath : `https://image.tmdb.org/t/p/w780${targetShow.backdropPath}`)
        : undefined;

      sendNativeNotification(targetShow.title, {
        body: notifBody,
        icon: iconUrl,
        badge: '/icon-192.png',
        image: imageUrl,
        tag: 'test_notification_' + type,
        renotify: true,
        vibrate: [150, 80, 150, 80, 250]
      } as any);
    } else {
      sendNativeNotification("Test Notification", {
        body: notifBody,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        tag: "test_notification_" + type,
        renotify: true,
        vibrate: [150, 80, 150, 80, 250]
      } as any);
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
    } catch (err: any) {
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
      latestRelease.apkDownloadUrl,
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

  return (
    <div className="flex-1 overflow-y-auto bg-black text-white px-4 sm:px-6 pt-4 sm:pt-5 pb-nav custom-scrollbar relative">
      <div className="max-w-md mx-auto w-full">
        <div className="absolute top-0 left-0 w-64 h-32 bg-[#E5A93D]/10 blur-[100px] -z-10 rounded-full mix-blend-screen pointer-events-none" />
        
        {/* Header Mobile Compact */}
        <div className="mb-4">
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white mb-0.5">Réglages</h1>
          <p className="text-zinc-400 text-[11px] font-medium">
            Profil, Plateformes, Notifications & Intégrations.
          </p>
        </div>

        <div className="space-y-3 sm:space-y-4">
          
          {/* SECTION 1: MON COMPTE */}
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-4 sm:p-5">
            <h2 className="font-bold text-sm text-zinc-100 mb-3 flex items-center gap-2.5">
              <Cloud className="text-emerald-500" size={18} />
              Mon Profil
            </h2>
            {!user ? (
              <div className="flex flex-col items-center text-center p-2">
                <p className="text-xs text-zinc-400 mb-4 font-medium">
                  Connectez-vous pour synchroniser votre bibliothèque en temps réel entre tous vos appareils.
                </p>
                <button
                  onClick={handleLogin}
                  className="w-full flex items-center justify-center gap-2 bg-white text-zinc-950 font-bold py-2.5 px-4 rounded-xl hover:bg-zinc-200 active:scale-95 transition-all text-xs shadow-lg cursor-pointer"
                >
                  <LogIn size={16} />
                  Continuer avec Google
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col min-w-0 bg-zinc-950/50 p-2.5 rounded-xl border border-white/5">
                  <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">Connecté avec</span>
                  <span className="font-bold text-xs text-white truncate">{user.email}</span>
                </div>

                {/* Multi-appareils & Synchronisation Cloud */}
                <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-indigo-300 flex items-center gap-1.5">
                      <Cloud size={14} className="text-indigo-400" />
                      Synchronisation Cloud
                    </span>
                    <span className="text-[10px] font-semibold px-2 py-0.5 bg-indigo-500/20 text-indigo-200 rounded-full">
                      {shows.length} série(s) en mémoire
                    </span>
                  </div>
                  <p className="text-[10px] text-zinc-400 leading-relaxed">
                    Sauvegardez vos séries et réglages sur le Cloud pour y accéder instantanément sur votre téléphone ou votre ordinateur.
                  </p>
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    <button
                      onClick={handleBackupToCloud}
                      className="flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white font-bold py-2 px-2.5 rounded-lg text-[11px] transition-all cursor-pointer shadow"
                    >
                      <UploadCloud size={14} />
                      Sauvegarder
                    </button>
                    <button
                      onClick={handleRestoreFromCloud}
                      className="flex items-center justify-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 active:scale-95 text-zinc-200 font-bold py-2 px-2.5 rounded-lg text-[11px] border border-white/10 transition-all cursor-pointer"
                    >
                      <DownloadCloud size={14} />
                      Recharger
                    </button>
                  </div>
                </div>
                
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center justify-center gap-2 bg-red-500/10 text-red-500 hover:bg-red-500/20 active:scale-95 font-bold py-2 px-4 rounded-xl transition-all text-xs border border-red-500/20 cursor-pointer"
                >
                  <LogOut size={14} />
                  Se déconnecter
                </button>
              </div>
            )}
          </div>

          {/* SECTION 2: PLATEFORMES */}
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-4 sm:p-5">
            <div className="flex items-center gap-2.5 mb-2.5">
              <MonitorPlay className="text-[#E5A93D]" size={18} />
              <h2 className="font-bold text-sm text-zinc-100">Plateformes de Streaming</h2>
            </div>
            <p className="text-xs text-zinc-400 mb-4 leading-relaxed font-medium">
              Sélectionnez vos abonnements pour y accéder directement.
            </p>
            
            <div className="grid grid-cols-2 gap-2">
              {STREAMING_PLATFORMS.map(platform => {
                const isSelected = userPlatforms.includes(platform.id);
                return (
                  <button
                    key={platform.id}
                    onClick={() => handleTogglePlatform(platform.id)}
                    className={cn(
                      "flex items-center justify-between px-3 py-2.5 rounded-xl border text-left transition-all active:scale-95 touch-manipulation",
                      isSelected 
                        ? "bg-[#E5A93D]/10 border-[#E5A93D]/40 text-[#E5A93D]" 
                        : "bg-black/40 border-white/5 text-zinc-400 hover:bg-zinc-800/60"
                    )}
                  >
                    <span className="font-semibold text-xs truncate mr-1">{platform.name}</span>
                    <div className={cn(
                      "w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-colors",
                      isSelected ? "bg-[#E5A93D] border-[#E5A93D]" : "border-zinc-600"
                    )}>
                      {isSelected && <CheckCircle2 size={10} className="text-black stroke-[3]" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* SECTION 3: NOTIFICATIONS */}
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-4 sm:p-5">
            <div className="flex items-center gap-2.5 mb-2.5">
              <Bell className="text-[#E5A93D]" size={18} />
              <h2 className="font-bold text-sm text-zinc-100">Notifications & Rappels</h2>
            </div>
            <p className="text-xs text-zinc-400 mb-3 leading-relaxed font-medium">
              Alertes quotidiennes envoyées à <strong>09h00</strong>.
            </p>

            {typeof window !== 'undefined' && window.self !== window.top && (
              <div className="mb-3.5 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-300 leading-relaxed font-medium">
                ⚠️ <strong>Note Android :</strong> Chrome bloque les notifications dans cet aperçu.
              </div>
            )}

            <div className="flex flex-col gap-4 mb-5">
              <div className="flex items-center justify-between group">
                <div className="flex flex-col">
                  <span className="text-xs text-zinc-200 font-bold group-hover:text-white transition-colors">Nouvel épisode (Séries)</span>
                  <span className="text-[10px] text-zinc-500">Le jour de la diffusion</span>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => triggerTestNotif('release_today_tv')} className="text-[10px] font-bold text-zinc-400 hover:text-white px-2 py-1 bg-zinc-800 rounded-md transition-colors">Tester</button>
                  <input 
                    type="checkbox" 
                    className="w-4 h-4 rounded text-[#E5A93D] focus:ring-[#E5A93D] bg-zinc-800 border-zinc-700 cursor-pointer"
                    checked={notificationPrefs.release_today_tv}
                    onChange={(e) => handleToggleNotif('release_today_tv', e.target.checked)}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between group">
                <div className="flex flex-col">
                  <span className="text-xs text-zinc-200 font-bold group-hover:text-white transition-colors">Nouvelle saison (Séries)</span>
                  <span className="text-[10px] text-zinc-500">Rappel J-7</span>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => triggerTestNotif('season_d7')} className="text-[10px] font-bold text-zinc-400 hover:text-white px-2 py-1 bg-zinc-800 rounded-md transition-colors">Tester</button>
                  <input 
                    type="checkbox" 
                    className="w-4 h-4 rounded text-[#E5A93D] focus:ring-[#E5A93D] bg-zinc-800 border-zinc-700 cursor-pointer"
                    checked={notificationPrefs.season_d7}
                    onChange={(e) => handleToggleNotif('season_d7', e.target.checked)}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between group">
                <div className="flex flex-col">
                  <span className="text-xs text-zinc-200 font-bold group-hover:text-white transition-colors">Sortie au cinéma (Films)</span>
                  <span className="text-[10px] text-zinc-500">Le jour J</span>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => triggerTestNotif('movie_theater')} className="text-[10px] font-bold text-zinc-400 hover:text-white px-2 py-1 bg-zinc-800 rounded-md transition-colors">Tester</button>
                  <input 
                    type="checkbox" 
                    className="w-4 h-4 rounded text-[#E5A93D] focus:ring-[#E5A93D] bg-zinc-800 border-zinc-700 cursor-pointer"
                    checked={notificationPrefs.movie_theater}
                    onChange={(e) => handleToggleNotif('movie_theater', e.target.checked)}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between group">
                <div className="flex flex-col">
                  <span className="text-xs text-zinc-200 font-bold group-hover:text-white transition-colors">Sortie DVD / VOD (Films)</span>
                  <span className="text-[10px] text-zinc-500">~4 mois après le cinéma</span>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => triggerTestNotif('movie_dvd_vod')} className="text-[10px] font-bold text-zinc-400 hover:text-white px-2 py-1 bg-zinc-800 rounded-md transition-colors">Tester</button>
                  <input 
                    type="checkbox" 
                    className="w-4 h-4 rounded text-[#E5A93D] focus:ring-[#E5A93D] bg-zinc-800 border-zinc-700 cursor-pointer"
                    checked={notificationPrefs.movie_dvd_vod}
                    onChange={(e) => handleToggleNotif('movie_dvd_vod', e.target.checked)}
                  />
                </div>
              </div>
            </div>

            <button
              onClick={async () => {
                const token = await requestNotificationPermission();
                if (token || (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted')) {
                  showToast("Notifications activées avec succès !", "success");
                } else {
                  showToast("Permission refusée par le système.", "error");
                }
              }}
              className="w-full flex items-center justify-center gap-2 bg-[#E5A93D]/10 hover:bg-[#E5A93D]/20 active:scale-95 text-[#E5A93D] border border-[#E5A93D]/30 font-bold py-2.5 px-4 rounded-xl text-xs transition-all cursor-pointer"
            >
              <Bell size={15} />
              Autoriser le système Android/Web
            </button>
          </div>

          {/* SECTION 4: INTÉGRATIONS & SYNCHRO */}
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-4 sm:p-5">
            <h2 className="font-bold text-sm text-zinc-100 mb-4 flex items-center gap-2.5">
              <RefreshCw className="text-indigo-400" size={18} />
              Données & Synchronisation
            </h2>

            {/* Plex */}
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <MonitorPlay className="text-orange-500" size={14} />
                <h3 className="font-bold text-xs text-zinc-200">Intégration Plex</h3>
              </div>
              <p className="text-[11px] text-zinc-400 mb-3 leading-relaxed font-medium">
                Synchronisez votre historique automatiquement.
              </p>
              {!user ? (
                <div className="p-2 bg-zinc-800/50 rounded-xl text-center text-[11px] text-zinc-400 border border-white/5 font-medium">
                  Connectez-vous pour associer Plex.
                </div>
              ) : !plexToken ? (
                <button
                  onClick={handlePlexLogin}
                  disabled={!!plexPin}
                  className="w-full flex items-center justify-center gap-2 bg-orange-500/10 hover:bg-orange-500/20 active:scale-95 text-orange-500 font-bold py-2 px-4 rounded-xl text-xs transition-all cursor-pointer border border-orange-500/20 disabled:opacity-50"
                >
                  {plexPin ? "En attente..." : "Associer mon compte Plex"}
                </button>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex gap-2">
                    <button
                      onClick={() => handlePlexSync(true)}
                      disabled={!!plexSyncMode}
                      className="flex-1 flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold py-2 px-3 rounded-xl text-xs transition-colors border border-white/5 disabled:opacity-50"
                    >
                      {plexSyncMode === 'delta' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                      Rapide
                    </button>
                    <button
                      onClick={() => handlePlexSync(false)}
                      disabled={!!plexSyncMode}
                      className="flex-1 flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold py-2 px-3 rounded-xl text-xs transition-colors border border-white/5 disabled:opacity-50"
                    >
                      {plexSyncMode === 'full' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                      Complète
                    </button>
                  </div>
                  <PlexLogSection />
                  <button onClick={handlePlexLogout} className="text-[10px] text-zinc-500 font-medium hover:text-zinc-300 underline text-center mt-1">
                    Déconnecter Plex
                  </button>
                </div>
              )}
            </div>

            <div className="h-px w-full bg-zinc-800/80 mb-4" />

            {/* Téléchargement C411 */}
            <DownloadConfigSection />

            <div className="h-px w-full bg-zinc-800/80 mb-4" />

            {/* CSV Import */}
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <FileText className="text-indigo-400" size={14} />
                <h3 className="font-bold text-xs text-zinc-200">Importer TV Time (CSV)</h3>
              </div>
              <CsvImporter />
            </div>

            <div className="h-px w-full bg-zinc-800/80 mb-4" />

            {/* Force Sync TMDB */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Cloud className="text-emerald-500" size={14} />
                <h3 className="font-bold text-xs text-zinc-200">Forcer la synchro (TMDB)</h3>
              </div>
              <p className="text-[11px] text-zinc-400 mb-3 leading-relaxed font-medium">
                Mettre à jour les données TMDB de toutes vos séries manuellement.
              </p>
              {syncStatus ? (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs font-bold text-amber-400">
                    <span className="flex items-center gap-1.5">
                      <Loader2 size={13} className="animate-spin text-amber-400" />
                      En cours...
                    </span>
                    <span className="text-[11px]">{syncStatus.total - syncStatus.pending + 1} / {syncStatus.total}</span>
                  </div>
                  <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                    <div 
                      className="bg-[#E5A93D] h-full transition-all duration-300"
                      style={{ width: `${Math.round(((syncStatus.total - syncStatus.pending + 1) / Math.max(1, syncStatus.total)) * 100)}%` }}
                    />
                  </div>
                </div>
              ) : (
                <button
                  onClick={handleForceSync}
                  disabled={isSyncing || !user}
                  className="w-full flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 active:scale-95 text-zinc-200 font-bold py-2 px-4 rounded-xl text-xs transition-all cursor-pointer border border-white/5 disabled:opacity-50"
                >
                  <RefreshCw size={14} className={cn(isSyncing && "animate-spin")} />
                  {isSyncing ? 'Synchronisation...' : 'Actualiser les séries'}
                </button>
              )}
            </div>
          </div>

          {/* SECTION 5: AVANCÉ & LOGS */}
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-4 sm:p-5">
            <h2 className="font-bold text-sm text-zinc-100 mb-4 flex items-center gap-2.5">
              <Terminal className="text-zinc-400" size={18} />
              À propos & Avancé
            </h2>

            <div className="flex flex-col gap-3">
              {/* Interactive Version Card / Button */}
              <button
                type="button"
                onClick={async () => {
                  setShowVersionNotesModal(true);
                  if (!latestRelease) {
                    await checkForUpdates(false);
                  }
                }}
                className="w-full flex items-center justify-between bg-zinc-800/40 hover:bg-zinc-800/80 active:scale-[0.99] p-3 rounded-xl border border-zinc-800 transition-all cursor-pointer group text-left"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center border border-amber-500/20 group-hover:scale-105 transition-transform">
                    <FileText size={15} />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs text-zinc-200 font-bold group-hover:text-white transition-colors">Version installée</span>
                    <span className="text-[10px] text-zinc-400">Appuyez pour voir les notes de version</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-amber-400 font-mono bg-amber-500/10 px-2.5 py-1 rounded-lg border border-amber-500/20">
                    v{currentVersion}
                  </span>
                  <ChevronRight size={15} className="text-zinc-500 group-hover:text-zinc-300 transition-colors" />
                </div>
              </button>

              {/* Update Available In-Place Card */}
              {hasUpdate && latestRelease && (
                <div className="p-3.5 bg-gradient-to-r from-amber-500/15 via-amber-500/10 to-transparent border border-amber-500/30 rounded-xl flex flex-col gap-2.5 shadow-lg shadow-amber-500/5 animate-in fade-in duration-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-amber-500 flex items-center justify-center text-black shadow-md shadow-amber-500/20 shrink-0">
                        <Sparkles size={14} />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-white flex items-center gap-1.5">
                          <span>Nouvelle version v{latestRelease.version}</span>
                          <span className="px-1.5 py-0.5 text-[9px] bg-amber-500 text-black font-extrabold rounded-full">
                            DISPONIBLE
                          </span>
                        </div>
                        <p className="text-[11px] text-zinc-300">Une mise à jour de SeenIt est prête à être installée.</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={() => setShowVersionNotesModal(true)}
                      className="flex-1 py-2 px-3 bg-zinc-800 hover:bg-zinc-700 active:scale-95 text-zinc-200 text-xs font-bold rounded-xl transition-all cursor-pointer text-center border border-white/5"
                    >
                      Voir les notes
                    </button>
                    <button
                      onClick={handleStartUpdate}
                      disabled={apkUpdateProgress?.status === 'downloading'}
                      className="flex-1 py-2 px-3 bg-amber-500 hover:bg-amber-400 active:scale-95 text-black text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 shadow-md shadow-amber-500/20 transition-all cursor-pointer disabled:opacity-50"
                    >
                      <Download size={13} />
                      Installer
                    </button>
                  </div>
                </div>
              )}
              
              <div className="flex gap-2">
                <button
                  onClick={handleCheckUpdates}
                  disabled={isCheckingUpdates}
                  className="flex-1 flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 active:scale-95 text-zinc-200 font-bold py-2 px-3 rounded-xl text-xs transition-colors border border-white/5 disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw size={14} className={cn(isCheckingUpdates && "animate-spin text-amber-400")} />
                  Vérifier les M.A.J
                </button>
                <button
                  onClick={() => setShowLogsPanel(!showLogsPanel)}
                  className="flex-1 flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 active:scale-95 text-zinc-200 font-bold py-2 px-3 rounded-xl text-xs transition-colors border border-white/5 cursor-pointer"
                >
                  <Bug size={14} />
                  Logs Système
                </button>
              </div>

              {/* Updater Progress */}
              {apkUpdateProgress && (
                <div className="mt-3 p-4 bg-[#E5A93D]/10 border border-[#E5A93D]/20 rounded-xl flex flex-col gap-3">
                  <div className="flex items-center justify-between text-xs font-bold text-[#E5A93D]">
                    <span className="flex items-center gap-2">
                      {apkUpdateProgress.status === 'downloading' ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Download size={14} />
                      )}
                      {apkUpdateProgress.status === 'downloading' ? 'Téléchargement...' : 
                       apkUpdateProgress.status === 'installing' ? 'Installation prête...' : 
                       'Erreur'}
                    </span>
                    <span>{apkUpdateProgress.percent}%</span>
                  </div>
                  <div className="w-full bg-black/40 rounded-full h-1.5 overflow-hidden">
                    <div 
                      className={cn(
                        "h-full transition-all duration-300",
                        apkUpdateProgress.status === 'error' ? "bg-red-500" : "bg-[#E5A93D]"
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
              )}

              {/* Logs Panel */}
              {showLogsPanel && (
                <div className="mt-3 border border-zinc-800 rounded-xl bg-black/60 overflow-hidden flex flex-col">
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
              )}
            </div>
          </div>

          <div className="flex flex-col items-center justify-center pt-8 pb-4 text-center">
            <SeenItLogo className="w-16 h-16 opacity-30 mb-4 grayscale" />
            <p className="text-xs text-zinc-500 font-medium">SeenIt — Made in Paris.</p>
          </div>
        </div>
      </div>

      {/* Dedicated Version Notes Modal */}
      {showVersionNotesModal && createPortal(
        <div 
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
                    Notes de version
                  </h3>
                  <p className="text-xs text-amber-400/90 font-medium">
                    SeenIt v{latestRelease?.version || currentVersion}
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
                Changelog & Nouveautés
              </div>
              
              <div className="bg-black/40 border border-white/5 rounded-2xl p-4 max-h-80 sm:max-h-[28rem] md:max-h-[32rem] overflow-y-auto custom-scrollbar">
                {isCheckingUpdates && !latestRelease ? (
                  <div className="py-8 flex flex-col items-center justify-center gap-2 text-zinc-400 text-xs">
                    <Loader2 className="w-5 h-5 animate-spin text-amber-400" />
                    <span>Chargement des notes de version...</span>
                  </div>
                ) : latestRelease?.releaseNotes ? (
                  <ChangelogViewer content={latestRelease.releaseNotes} />
                ) : (
                  <div className="py-6 text-center text-zinc-400 text-xs">
                    <p>Aucune note de version détaillée disponible pour le moment.</p>
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
        </div>,
        document.body
      )}
    </div>
  );
}
