import { create } from 'zustand';
import { doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../lib/firebase';

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
  isHydrated: boolean;
  isSaving: boolean;
  saveError: string | null;
  setConfig: (config: Partial<DownloadClientConfig>, saveToCloud?: boolean) => void;
  saveConfig: (config: Partial<DownloadClientConfig>) => Promise<boolean>;
  resetConfig: () => void;
  syncFromCloud: () => Promise<void>;
  saveToCloud: () => Promise<boolean>;
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
  autoSendToDownloader: true
};

function normalizeConfig(input: Partial<DownloadClientConfig>): Partial<DownloadClientConfig> {
  const output: Partial<DownloadClientConfig> = {};

  for (const [rawKey, rawValue] of Object.entries(input)) {
    if (rawValue === undefined) continue;
    const key = rawKey as keyof DownloadClientConfig;
    (output as any)[key] = typeof rawValue === 'string' ? rawValue.trim() : rawValue;
  }

  return output;
}

export const useDownloadConfigStore = create<DownloadConfigState>()((set, get) => ({
  ...DEFAULT_CONFIG,
  isHydrated: false,
  isSaving: false,
  saveError: null,

  setConfig: (newConfig, shouldSave = true) => {
    set({ ...normalizeConfig(newConfig), saveError: null });
    if (shouldSave) void get().saveToCloud();
  },

  saveConfig: async newConfig => {
    set({ ...normalizeConfig(newConfig), saveError: null });
    return get().saveToCloud();
  },

  resetConfig: () => {
    set({ ...DEFAULT_CONFIG, saveError: null });
    void get().saveToCloud();
  },

  syncFromCloud: async () => {
    const user = auth.currentUser;
    if (!user) {
      set({ isHydrated: true });
      return;
    }

    try {
      const docRef = doc(db, 'users', user.uid, 'settings', 'downloadConfig');
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        set({
          ...(snap.data() as Partial<DownloadClientConfig>),
          isHydrated: true,
          saveError: null
        });
      } else {
        set({ isHydrated: true, saveError: null });
      }
    } catch (error: any) {
      console.warn('[DownloadConfig] Erreur syncFromCloud:', error);
      set({
        isHydrated: true,
        saveError: error?.message || 'Impossible de charger la configuration.'
      });
    }
  },

  saveToCloud: async () => {
    const user = auth.currentUser;
    if (!user) {
      set({ isSaving: false, saveError: 'Utilisateur non connecté.' });
      return false;
    }

    set({ isSaving: true, saveError: null });

    try {
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
        autoSendToDownloader: current.autoSendToDownloader ?? true
      };

      const docRef = doc(db, 'users', user.uid, 'settings', 'downloadConfig');
      await setDoc(docRef, dataToSave, { merge: true });
      set({ isSaving: false, saveError: null, isHydrated: true });
      return true;
    } catch (error: any) {
      console.warn('[DownloadConfig] Erreur saveToCloud:', error);
      set({
        isSaving: false,
        saveError: error?.message || 'Impossible de sauvegarder la configuration.'
      });
      return false;
    }
  }
}));

if (typeof window !== 'undefined') {
  try {
    localStorage.removeItem('seenit_download_config');
  } catch {}

  let unsubscribeSnapshot: (() => void) | null = null;

  onAuthStateChanged(auth, user => {
    if (unsubscribeSnapshot) {
      unsubscribeSnapshot();
      unsubscribeSnapshot = null;
    }

    useDownloadConfigStore.setState({
      ...DEFAULT_CONFIG,
      isHydrated: false,
      isSaving: false,
      saveError: null
    });

    if (!user) {
      useDownloadConfigStore.setState({ isHydrated: true });
      return;
    }

    void useDownloadConfigStore.getState().syncFromCloud();

    try {
      const docRef = doc(db, 'users', user.uid, 'settings', 'downloadConfig');
      unsubscribeSnapshot = onSnapshot(
        docRef,
        snapshot => {
          if (snapshot.exists()) {
            useDownloadConfigStore.setState({
              ...(snapshot.data() as Partial<DownloadClientConfig>),
              isHydrated: true,
              saveError: null
            });
          } else {
            useDownloadConfigStore.setState({ isHydrated: true });
          }
        },
        error => {
          console.warn('[DownloadConfig] Firestore snapshot warning:', error);
          useDownloadConfigStore.setState({
            isHydrated: true,
            saveError: error?.message || 'Synchronisation des réglages indisponible.'
          });
        }
      );
    } catch (error) {
      console.warn('[DownloadConfig] Impossible d’établir le snapshot Firestore:', error);
      useDownloadConfigStore.setState({ isHydrated: true });
    }
  });
}
