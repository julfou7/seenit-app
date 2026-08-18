import { useState, useEffect } from 'react';
import { Cloud, LogIn, LogOut, FileText, CheckCircle2, MonitorPlay, Bell, RefreshCw, Loader2, Terminal, Copy, Trash2, ChevronDown, ChevronUp, Check, AlertCircle, Info, Bug, Sparkles, Download } from 'lucide-react';
import { auth, db, googleAuthProvider, requestNotificationPermission, sendNativeNotification } from '../lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { Capacitor } from '@capacitor/core';
import { signInWithPopup, signInWithCredential, GoogleAuthProvider, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { cn } from '../lib/utils';
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

export function SettingsScreen() {
  const { showToast } = useToastStore();
  const syncStatus = useSyncStore(state => state.syncStatus);
  const shows = useShowsStore(state => state.shows);
  const { logs, clearLogs, getLogsAsText } = useLogStore();
  const { currentVersion, latestRelease, hasUpdate, isChecking: isCheckingUpdates, lastChecked, checkForUpdates } = useUpdateStore();
  const [user, setUser] = useState<User | null>(null);
  const [userPlatforms, setUserPlatforms] = useState<number[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  
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
            setPlexPin(null);
            showToast("Compte Plex connecté !", "success");
            appLogger.success('plex', 'Compte Plex authentifié avec succès');
            clearInterval(interval);
          }
        } catch (e: any) {
          console.error(e);
          appLogger.error('plex', 'Erreur lors du suivi du PIN Plex', e);
        }
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [plexPin, plexToken, showToast]);

  const handlePlexLogin = async () => {
    try {
      const pin = await getPlexPin();
      setPlexPin(pin);
      window.open(`https://app.plex.tv/auth#?clientID=${pin.clientIdentifier}&code=${pin.code}&context[device][product]=TV%20Time%20Sync`, '_blank');
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

  const handlePlexLogout = () => {
    setPlexToken(null);
    localStorage.removeItem('plex_auth_token');
    localStorage.removeItem('plex_token');
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
        } catch (e) {
          console.error('[Settings] Error syncing cloud streaming platforms', e);
        }
      }
    });

    return () => {
      window.removeEventListener('storage', handleStorage);
      unsubscribe();
    };
  }, []);

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
        try {
          const result = await FirebaseAuthentication.signInWithGoogle();
          if (result.credential?.idToken) {
            const credential = GoogleAuthProvider.credential(result.credential.idToken);
            await signInWithCredential(auth, credential);
            return;
          }
        } catch (nativeErr) {
          console.warn('Native Google sign-in in settings failed, trying popup fallback:', nativeErr);
        }
      }

      await signInWithPopup(auth, googleAuthProvider);
    } catch (err) {
      console.error(err);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
  };

  return (
    <div className="flex-1 overflow-y-auto bg-black text-white px-6 pt-12 pb-36 custom-scrollbar relative">
      <div className="max-w-md mx-auto w-full">
        <div className="absolute top-0 left-0 w-64 h-32 bg-[#E5A93D]/10 blur-[100px] -z-10 rounded-full mix-blend-screen pointer-events-none" />
        {/* Header Mobile Compact */}
        <div className="mb-6">
          <h1 className="text-3xl font-black tracking-tight text-white mb-1">Réglages</h1>
          <p className="text-zinc-400 text-xs font-medium">
            Mon Compte, Plateformes, Notifications & Import.
          </p>
        </div>

        <div className="space-y-4">
          {/* Mes Plateformes de Streaming */}

        <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-4 sm:p-5">
          <div className="flex items-center gap-2.5 mb-2.5">
            <MonitorPlay className="text-[#E5A93D]" size={18} />
            <h2 className="font-bold text-sm text-zinc-100">Mes Plateformes de Streaming (France)</h2>
          </div>
          <p className="text-xs text-zinc-400 mb-4 leading-relaxed font-medium">
            Sélectionnez vos abonnements pour les mettre en avant dans la section "Où regarder" et accéder directement aux épisodes.
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

        {/* Notifications & Rappels */}
        <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-4 sm:p-5">
          <div className="flex items-center gap-2.5 mb-2.5">
            <Bell className="text-[#E5A93D]" size={18} />
            <h2 className="font-bold text-sm text-zinc-100">Notifications & Rappels Android</h2>
          </div>
          <p className="text-xs text-zinc-400 mb-3 leading-relaxed font-medium">
            Activez les notifications système pour recevoir des rappels le jour de la sortie de vos séries.
          </p>

          {typeof window !== 'undefined' && window.self !== window.top && (
            <div className="mb-3.5 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-300 leading-relaxed font-medium">
              ⚠️ <strong>Note Android :</strong> Dans l'aperçu intégré (iframe), Chrome bloque les notifications. Pour les activer sur votre mobile, ouvrez l'app dans un <strong>nouvel onglet</strong>.
            </div>
          )}

          <div className="flex flex-col gap-2">
            <button
              onClick={async () => {
                const token = await requestNotificationPermission();
                if (token || (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted')) {
                  showToast("Notifications système activées avec succès !", "success");
                  sendNativeNotification("Notifications Activées", {
                    body: "Vous recevrez désormais un rappel lors des sorties de nouveaux épisodes !",
                    icon: "/icon-192.png"
                  });
                } else {
                  showToast("Permission refusée par le navigateur ou bloquée dans l'aperçu", "info");
                }
              }}
              className="w-full flex items-center justify-center gap-2 bg-[#E5A93D]/10 hover:bg-[#E5A93D]/20 active:scale-95 text-[#E5A93D] border border-[#E5A93D]/30 font-bold py-2.5 px-4 rounded-xl text-xs transition-all cursor-pointer"
            >
              <Bell size={15} />
              Activer les notifications
            </button>
            <button
              onClick={() => {
                showToast("🔔 Test envoyé à votre téléphone !", "info");

                // Préférer une série active actuellement suivie par l'utilisateur
                const activeShows = shows.filter(s => !s.isArchived && s.status !== 'dropped');
                const targetShow = activeShows.find(s => s.mediaType === 'tv' && s.nextEpisodeToWatch)
                  || activeShows.find(s => s.mediaType === 'tv')
                  || shows.find(s => !s.isArchived)
                  || shows[0];

                if (targetShow) {
                  const iconUrl = targetShow.posterPath 
                    ? (targetShow.posterPath.startsWith('http') ? targetShow.posterPath : `https://image.tmdb.org/t/p/w185${targetShow.posterPath}`)
                    : '/icon-192.png';
                  const imageUrl = targetShow.backdropPath 
                    ? (targetShow.backdropPath.startsWith('http') ? targetShow.backdropPath : `https://image.tmdb.org/t/p/w780${targetShow.backdropPath}`)
                    : undefined;

                  const sNum = targetShow.nextEpisodeToWatch?.season_number || 1;
                  const eNum = targetShow.nextEpisodeToWatch?.episode_number || 1;
                  const sStr = String(sNum).padStart(2, '0');
                  const eStr = String(eNum).padStart(2, '0');
                  const epName = targetShow.nextEpisodeToWatch?.name ? ` « ${targetShow.nextEpisodeToWatch.name} »` : '';

                  sendNativeNotification(targetShow.title, {
                    body: `L'épisode S${sStr}E${eStr}${epName} est disponible aujourd'hui !`,
                    icon: iconUrl,
                    badge: '/icon-192.png',
                    image: imageUrl,
                    tag: 'test_notification',
                    renotify: true,
                    vibrate: [150, 80, 150, 80, 250],
                    data: {
                      url: `/?showId=${targetShow.id}&tmdbId=${targetShow.tmdbId}&mediaType=${targetShow.mediaType || 'tv'}&season=${sNum}&episode=${eNum}&tab=watchlist`,
                      showId: targetShow.id,
                      tmdbId: targetShow.tmdbId,
                      mediaType: targetShow.mediaType || 'tv',
                      season: sNum,
                      episode: eNum
                    },
                    actions: [
                      {
                        action: 'mark_watched',
                        title: '✓ Marquer comme vu'
                      }
                    ]
                  } as any);
                } else {
                  sendNativeNotification("Daredevil: Born Again", {
                    body: "L'épisode S01E05 « Les Ombres d'Hell's Kitchen » est disponible aujourd'hui !",
                    icon: "https://image.tmdb.org/t/p/w185/7c9UVPPiTPltouxShY9gxagZ58i.jpg",
                    badge: "/icon-192.png",
                    image: "https://image.tmdb.org/t/p/w780/7c9UVPPiTPltouxShY9gxagZ58i.jpg",
                    tag: "test_notification",
                    renotify: true,
                    vibrate: [150, 80, 150, 80, 250],
                    data: {
                      url: "/?showId=108978&tmdbId=108978&mediaType=tv&season=1&episode=5&tab=watchlist",
                      showId: "108978",
                      tmdbId: 108978,
                      mediaType: "tv",
                      season: 1,
                      episode: 5
                    },
                    actions: [
                      {
                        action: 'mark_watched',
                        title: '✓ Marquer comme vu'
                      }
                    ]
                  } as any);
                }
              }}
              className="w-full flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 active:scale-95 text-zinc-200 font-bold py-2.5 px-4 rounded-xl text-xs transition-all cursor-pointer"
            >
              Tester la notification
            </button>
          </div>
        </div>

        {/* Mon Compte & Synchro */}
        <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-4 sm:p-5">
           <h2 className="font-bold text-sm text-zinc-100 mb-3 flex items-center gap-2.5">
             <Cloud className="text-emerald-500" size={18} />
             Mon Compte & Synchronisation
           </h2>
           
           {!user ? (
             <div className="flex flex-col items-center text-center p-2">
                <p className="text-xs text-zinc-400 mb-4 font-medium">
                  Connectez-vous pour synchroniser votre bibliothèque en temps réel entre tous vos appareils.
                </p>
                <button
                  onClick={handleLogin}
                  className="w-full flex items-center justify-center gap-2 bg-white text-zinc-950 font-bold py-2.5 px-4 rounded-xl hover:bg-zinc-200 active:scale-95 transition-all text-xs shadow-lg"
                >
                  <LogIn size={16} />
                  Continuer avec Google
                </button>
             </div>
           ) : (
             <div className="flex flex-col">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex flex-col min-w-0 pr-2">
                    <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">Connecté</span>
                    <span className="font-bold text-xs text-white truncate">{user.email}</span>
                  </div>
                  <div className="flex items-center gap-1.5 bg-emerald-500/10 text-emerald-400 px-2.5 py-1 rounded-full text-[10px] font-bold shrink-0 border border-emerald-500/20">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Synchro Active
                  </div>
                </div>
                
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center justify-center gap-2 text-zinc-400 hover:text-white font-semibold py-2 px-3 rounded-xl hover:bg-zinc-800/80 transition-colors text-xs border border-white/5"
                >
                  <LogOut size={14} />
                  Se déconnecter
                </button>

                <div className="pt-4 border-t border-zinc-800/80 mt-4 space-y-2">
                  <h3 className="text-xs font-bold text-zinc-200">Forcer la synchronisation</h3>
                  <p className="text-[11px] text-zinc-400 leading-relaxed font-medium">
                    Mettre à jour les prochains épisodes, dates de diffusion et statuts de vos séries depuis TMDB.
                  </p>

                  {syncStatus ? (
                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 flex flex-col gap-2">
                      <div className="flex items-center justify-between text-xs font-bold text-amber-400">
                        <span className="flex items-center gap-1.5">
                          <Loader2 size={13} className="animate-spin text-amber-400" />
                          Synchro en cours...
                        </span>
                        <span className="text-[11px]">{syncStatus.total - syncStatus.pending + 1} / {syncStatus.total}</span>
                      </div>
                      <p className="text-[11px] text-zinc-300 truncate">
                        Série : <strong className="text-white">{syncStatus.current}</strong>
                      </p>
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
                      disabled={isSyncing}
                      className="w-full flex items-center justify-center gap-2 bg-[#E5A93D]/10 hover:bg-[#E5A93D]/20 active:scale-95 text-[#E5A93D] border border-[#E5A93D]/30 font-bold py-2.5 px-4 rounded-xl text-xs transition-all cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw size={14} className={cn(isSyncing && "animate-spin")} />
                      {isSyncing ? 'Synchronisation...' : 'Forcer la synchronisation des séries'}
                    </button>
                  )}
                </div>
             </div>
           )}
        </div>

        {/* Import CSV TV Time */}
        <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-4 sm:p-5">
          <div className="flex items-center gap-2.5 mb-2.5">
            <FileText className="text-indigo-400" size={18} />
            <h2 className="font-bold text-sm text-zinc-100">Importer depuis TV Time</h2>
          </div>
          <p className="text-xs text-zinc-400 mb-3.5 leading-relaxed font-medium">
            Importez votre fichier CSV TV Time. Le système synchronisera automatiquement vos données en arrière-plan.
          </p>
          <CsvImporter />
        </div>

        {/* Intégration Plex */}
        <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-4 sm:p-5 mb-5">
          <div className="flex items-center gap-2.5 mb-2.5">
            <MonitorPlay className="text-orange-500" size={18} />
            <h2 className="font-bold text-sm text-zinc-100">Intégration Plex</h2>
          </div>
          <p className="text-xs text-zinc-400 mb-4 leading-relaxed font-medium">
            Connectez votre compte Plex pour synchroniser automatiquement votre historique de visionnage récent. La synchronisation vérifie également les nouveautés en tâche de fond (toutes les 15 minutes).
          </p>
          
          {!user ? (
            <div className="p-3 bg-zinc-800/50 rounded-xl text-center text-xs text-zinc-400 border border-white/5 font-medium">
              Connectez-vous d'abord à TV Time pour associer Plex.
            </div>
          ) : !plexToken ? (
            <div className="flex flex-col gap-2">
              <button
                onClick={handlePlexLogin}
                disabled={!!plexPin}
                className="w-full flex items-center justify-center gap-2 bg-orange-500/10 hover:bg-orange-500/20 active:scale-95 text-orange-500 font-bold py-2.5 px-4 rounded-xl text-xs transition-all cursor-pointer border border-orange-500/20 disabled:opacity-50"
              >
                {plexPin ? (
                  <>
                    <Loader2 size={15} className="animate-spin" />
                    En attente de connexion...
                  </>
                ) : (
                  'Connecter mon compte Plex'
                )}
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between p-3 bg-orange-500/10 rounded-xl border border-orange-500/20">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-xs font-bold text-orange-400">Compte Plex connecté</span>
                </div>
                <button onClick={handlePlexLogout} className="text-zinc-400 hover:text-white transition-colors" title="Déconnecter Plex">
                  <LogOut size={14} />
                </button>
              </div>

              {/* Action 1: Delta / Quick Sync */}
              <button
                onClick={() => handlePlexSync(true)}
                disabled={plexSyncMode !== null}
                className="w-full flex items-center justify-center gap-2 bg-orange-500/20 hover:bg-orange-500/30 active:scale-95 text-orange-300 font-bold py-2.5 px-4 rounded-xl text-xs transition-all cursor-pointer border border-orange-500/30 disabled:opacity-50"
              >
                <RefreshCw size={14} className={cn(plexSyncMode === 'delta' && "animate-spin")} />
                {plexSyncMode === 'delta' ? 'Synchronisation rapide en cours...' : 'Synchronisation rapide (Nouveautés / Delta)'}
              </button>

              {/* Action 2: Full Sync */}
              <button
                onClick={() => handlePlexSync(false)}
                disabled={plexSyncMode !== null}
                className="w-full flex items-center justify-center gap-2 bg-zinc-800/80 hover:bg-zinc-700 active:scale-95 text-zinc-300 hover:text-white font-semibold py-2 px-4 rounded-xl text-xs transition-all cursor-pointer border border-white/5 disabled:opacity-50"
              >
                <RefreshCw size={13} className={cn(plexSyncMode === 'full' && "animate-spin")} />
                {plexSyncMode === 'full' ? 'Scan complet en cours...' : 'Scan complet de tout l\'historique'}
              </button>
            </div>
          )}
        </div>

        {/* Activity Logs & Debug Panel */}
        <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-4 sm:p-5 mb-8">
          <div 
            onClick={() => setShowLogsPanel(prev => !prev)}
            className="flex items-center justify-between cursor-pointer select-none"
          >
            <div className="flex items-center gap-2.5">
              <Terminal className="text-zinc-400" size={18} />
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-bold text-sm text-zinc-100">Journaux d'activité & Debug</h2>
                  <span className="px-2 py-0.5 text-[10px] font-semibold bg-zinc-800 text-zinc-400 rounded-full border border-white/5">
                    {logs.length}
                  </span>
                </div>
                <p className="text-[11px] text-zinc-400 font-medium">Historique des synchronisations Plex, TMDB et système</p>
              </div>
            </div>
            <div className="text-zinc-400 hover:text-white transition-colors">
              {showLogsPanel ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </div>
          </div>

          {showLogsPanel && (
            <div className="mt-4 pt-4 border-t border-white/5 flex flex-col gap-3">
              {/* Category filters & Action buttons */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {[
                    { id: 'all', label: 'Tous' },
                    { id: 'plex', label: 'Plex' },
                    { id: 'tmdb', label: 'TMDB' },
                    { id: 'sync', label: 'Sync' },
                    { id: 'system', label: 'Système' }
                  ].map(cat => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setSelectedLogCategory(cat.id)}
                      className={cn(
                        "px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer",
                        selectedLogCategory === cat.id
                          ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                          : "bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-transparent"
                      )}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const txt = getLogsAsText();
                      navigator.clipboard.writeText(txt || 'Aucun log enregistré.');
                      setCopiedLogs(true);
                      setTimeout(() => setCopiedLogs(false), 2000);
                    }}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 active:scale-95 text-xs text-zinc-200 font-medium border border-white/5 transition-all cursor-pointer"
                    title="Copier tous les logs dans le presse-papier"
                  >
                    {copiedLogs ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                    <span>{copiedLogs ? 'Copié !' : 'Copier'}</span>
                  </button>
                  {logs.length > 0 && (
                    <button
                      type="button"
                      onClick={() => clearLogs()}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-rose-500/20 active:scale-95 text-xs text-zinc-400 hover:text-rose-300 font-medium border border-white/5 transition-all cursor-pointer"
                      title="Effacer les logs"
                    >
                      <Trash2 size={13} />
                      <span>Effacer</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Terminal Viewer */}
              <div className="bg-black/60 rounded-xl p-3 border border-white/10 font-mono text-[11px] max-h-72 overflow-y-auto flex flex-col gap-1.5 custom-scrollbar">
                {logs.length === 0 ? (
                  <div className="text-center py-6 text-zinc-500 font-sans text-xs">
                    Aucun journal d'activité enregistré pour le moment.
                  </div>
                ) : (
                  logs
                    .filter(l => selectedLogCategory === 'all' || l.category === selectedLogCategory)
                    .map(log => {
                      const timeStr = new Date(log.timestamp).toLocaleTimeString('fr-FR');
                      const isError = log.level === 'error';
                      const isSuccess = log.level === 'success';
                      const isWarn = log.level === 'warn';

                      return (
                        <div 
                          key={log.id}
                          className={cn(
                            "p-2 rounded-lg border transition-colors leading-relaxed",
                            isError && "bg-rose-500/10 border-rose-500/20 text-rose-300",
                            isSuccess && "bg-emerald-500/10 border-emerald-500/20 text-emerald-300",
                            isWarn && "bg-amber-500/10 border-amber-500/20 text-amber-300",
                            !isError && !isSuccess && !isWarn && "bg-white/[0.02] border-white/5 text-zinc-300"
                          )}
                        >
                          <div className="flex items-center gap-2 flex-wrap text-[10px] text-zinc-400 mb-0.5">
                            <span>{timeStr}</span>
                            <span className={cn(
                              "px-1.5 py-0.2 rounded font-bold uppercase text-[9px]",
                              log.category === 'plex' && "bg-orange-500/20 text-orange-400",
                              log.category === 'tmdb' && "bg-blue-500/20 text-blue-400",
                              log.category === 'sync' && "bg-purple-500/20 text-purple-400",
                              log.category === 'system' && "bg-zinc-800 text-zinc-400"
                            )}>
                              {log.category}
                            </span>
                            <span className={cn(
                              "font-bold uppercase text-[9px]",
                              isError && "text-rose-400",
                              isSuccess && "text-emerald-400",
                              isWarn && "text-amber-400",
                              !isError && !isSuccess && !isWarn && "text-zinc-500"
                            )}>
                              {log.level}
                            </span>
                          </div>
                          <div className="text-zinc-100 font-sans text-xs whitespace-pre-wrap break-words">
                            {log.message}
                          </div>
                          {log.details && (
                            <pre className="mt-1 text-[10px] text-zinc-400 bg-black/40 p-1.5 rounded overflow-x-auto">
                              {typeof log.details === 'object' ? JSON.stringify(log.details, null, 2) : String(log.details)}
                            </pre>
                          )}
                        </div>
                      );
                    })
                )}
              </div>
            </div>
          )}
        </div>

        {/* Application Updates & Version Section */}
        <div className="bg-zinc-900/60 border border-white/10 rounded-2xl p-5 space-y-4 shadow-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                <Sparkles size={20} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  Mises à jour de l'application
                </h3>
                <p className="text-xs text-zinc-400">
                  Version installée : <span className="font-semibold text-zinc-200">v{currentVersion}</span>
                </p>
              </div>
            </div>

            <button
              onClick={async () => {
                const isNewer = await checkForUpdates(true);
                const storeError = useUpdateStore.getState().error;
                const release = useUpdateStore.getState().latestRelease;
                if (isNewer && release) {
                  showToast(`🎉 Version v${release.version} disponible !`, 'success');
                } else if (storeError) {
                  showToast(`Erreur : ${storeError}`, 'error');
                } else {
                  showToast(`Votre application est à jour (v${CURRENT_APP_VERSION})`, 'info');
                }
              }}
              disabled={isCheckingUpdates}
              className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 active:scale-95 text-zinc-300 hover:text-white border border-white/5 transition-all disabled:opacity-50 flex items-center gap-1.5 text-xs font-medium cursor-pointer"
              title="Vérifier maintenant"
            >
              <RefreshCw size={13} className={cn(isCheckingUpdates && "animate-spin text-amber-400")} />
              <span>{isCheckingUpdates ? 'Recherche...' : 'Vérifier'}</span>
            </button>
          </div>

          {/* Status Display */}
          {hasUpdate && latestRelease ? (
            <div className="bg-gradient-to-r from-amber-500/15 via-amber-600/10 to-transparent border border-amber-500/30 rounded-xl p-3.5 space-y-3 animate-in fade-in duration-200">
              <div>
                <div className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                  <Sparkles size={14} className="text-amber-400" />
                  <span>Nouvelle version v{latestRelease.version} disponible !</span>
                </div>
                <div className="text-[11px] text-zinc-300 mt-1 whitespace-pre-wrap leading-relaxed">
                  {latestRelease.releaseNotes || 'Améliorations générales et corrections de bugs.'}
                </div>
              </div>
              <button
                onClick={() => {
                  if (latestRelease.apkDownloadUrl) {
                    window.open(latestRelease.apkDownloadUrl, '_system');
                  }
                }}
                className="w-full py-2.5 bg-amber-500 hover:bg-amber-400 active:scale-[0.99] text-black font-bold text-xs rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 transition-all cursor-pointer"
              >
                <Download size={15} />
                <span>Télécharger et installer l'APK v{latestRelease.version}</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between bg-white/[0.02] border border-white/5 rounded-xl px-3.5 py-2.5 text-xs text-zinc-400">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />
                <span>Votre application est à jour</span>
              </div>
              {lastChecked && (
                <span className="text-[10px] text-zinc-500 font-mono">
                  {new Date(lastChecked).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Branding Footer */}
        <div className="pt-8 pb-4 flex flex-col items-center justify-center text-center space-y-3">
          <SeenItLogo variant="horizontal" size={160} className="opacity-90 hover:opacity-100 transition-opacity" />
          <div className="text-[11px] text-zinc-500 font-medium">
            SeenIt • v2.0 Premium Cinema Experience
          </div>
        </div>

      </div>
    </div>
    </div>
  );
}
