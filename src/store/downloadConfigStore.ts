import { create } from 'zustand';
import { db, auth } from '../lib/firebase';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';

export interface DownloadClientConfig {
  c411ApiKey: string;
  sonarrUrl: string;
  sonarrApiKey: string;
  radarrUrl: string;
  radarrApiKey: string;
  qbittorrentUrl: string;
  qbittorrentUsername: string;
  qbittorrentPassword: string;
  autoSendToDownloader: boolean;
}

interface DownloadConfigState extends DownloadClientConfig {
  setConfig: (config: Partial<DownloadClientConfig>, saveToCloud?: boolean) => void;
  resetConfig: () => void;
  syncFromCloud: () => Promise<void>;
  saveToCloud: () => Promise<void>;
}

const DEFAULT_CONFIG: DownloadClientConfig = {
  c411ApiKey: '',
  sonarrUrl: '',
  sonarrApiKey: '',
  radarrUrl: '',
  radarrApiKey: '',
  qbittorrentUrl: '',
  qbittorrentUsername: '',
  qbittorrentPassword: '',
  autoSendToDownloader: true,
};

export const useDownloadConfigStore = create<DownloadConfigState>()(
  (set, get) => ({
      ...DEFAULT_CONFIG,
      setConfig: (newConfig, saveToCloud = true) => {
        set((state) => ({ ...state, ...newConfig }));
        if (saveToCloud) {
          get().saveToCloud().catch((err) => {
            console.warn('[DownloadConfig] Impossible de sauvegarder dans Firestore:', err);
          });
        }
      },
      resetConfig: () => {
        set(DEFAULT_CONFIG);
        get().saveToCloud().catch(() => {});
      },
      syncFromCloud: async () => {
        const user = auth.currentUser;
        if (!user) return;
        try {
          const docRef = doc(db, 'users', user.uid, 'settings', 'downloadConfig');
          const snap = await getDoc(docRef);
          if (snap.exists()) {
            const data = snap.data() as Partial<DownloadClientConfig>;
            set((state) => ({ ...state, ...data }));
          } else {
            // Si rien dans le cloud mais qu'on a une config locale renseignée, on l'envoie au cloud
            const current = get();
            if (current.sonarrUrl || current.radarrUrl || current.qbittorrentUrl || (current.c411ApiKey && current.c411ApiKey !== DEFAULT_CONFIG.c411ApiKey)) {
              await get().saveToCloud();
            }
          }
        } catch (e) {
          console.warn('[DownloadConfig] Erreur syncFromCloud:', e);
        }
      },
      saveToCloud: async () => {
        const user = auth.currentUser;
        if (!user) return;
        try {
          const docRef = doc(db, 'users', user.uid, 'settings', 'downloadConfig');
          const current = get();
          const dataToSave: DownloadClientConfig = {
            c411ApiKey: current.c411ApiKey || '',
            sonarrUrl: current.sonarrUrl || '',
            sonarrApiKey: current.sonarrApiKey || '',
            radarrUrl: current.radarrUrl || '',
            radarrApiKey: current.radarrApiKey || '',
            qbittorrentUrl: current.qbittorrentUrl || '',
            qbittorrentUsername: current.qbittorrentUsername || '',
            qbittorrentPassword: current.qbittorrentPassword || '',
            autoSendToDownloader: current.autoSendToDownloader ?? true,
          };
          await setDoc(docRef, dataToSave, { merge: true });
        } catch (e) {
          console.warn('[DownloadConfig] Erreur saveToCloud:', e);
        }
      }
    })
);

// Listener automatique d'authentification pour synchroniser Firestore en temps réel
if (typeof window !== 'undefined') {
  // Supprime l'ancien cache global qui pouvait mélanger les identifiants entre deux comptes.
  try {
    localStorage.removeItem('seenit_download_config');
  } catch {}

  let unsubscribeSnapshot: (() => void) | null = null;

  onAuthStateChanged(auth, (user) => {
    if (unsubscribeSnapshot) {
      unsubscribeSnapshot();
      unsubscribeSnapshot = null;
    }

    // Toujours vider les identifiants en mémoire avant de charger le compte courant.
    useDownloadConfigStore.setState(DEFAULT_CONFIG);

    if (user) {
      // 1. Synchronisation initiale
      useDownloadConfigStore.getState().syncFromCloud();

      // 2. Écoute temps réel des modifications faites depuis un autre appareil (Web <-> APK)
      try {
        const docRef = doc(db, 'users', user.uid, 'settings', 'downloadConfig');
        unsubscribeSnapshot = onSnapshot(docRef, (docSnap) => {
          if (docSnap.exists()) {
            const remoteData = docSnap.data() as Partial<DownloadClientConfig>;
            // Ne pas écraser si les données sont identiques pour éviter les boucles
            useDownloadConfigStore.setState((prev) => ({
              ...prev,
              ...remoteData
            }));
          }
        }, (error) => {
          console.warn('[DownloadConfig] Firestore snapshot warning:', error);
        });
      } catch (e) {
        console.warn('[DownloadConfig] Impossible d\'établir le snapshot Firestore:', e);
      }
    }
  });
}
