import { create } from 'zustand';
import { doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../lib/firebase';
import { invalidateQbitCache } from '../services/sonarrRadarr';
import { ensureDownloadNotificationWebhooks } from '../features/downloads/downloadWebhookProvisioning';
import { appLogger } from './logStore';
import {
  normalizeDownloadConfigPatch,
  parseDownloadConfigDocument,
  type DownloadClientConfig
} from '../features/downloads/downloadConfigBoundary';

export type { DownloadClientConfig } from '../features/downloads/downloadConfigBoundary';

interface DownloadConfigState extends DownloadClientConfig {
  scopeUid: string | null;
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
  downloadsEnabled: false,
  c411ApiKey: '',
  sonarrUrl: '',
  sonarrApiKey: '',
  sonarr1080pProfileId: null,
  sonarr4kProfileId: null,
  radarrUrl: '',
  radarrApiKey: '',
  radarr1080pProfileId: null,
  radarr4kProfileId: null,
  qbittorrentUrl: '',
  qbittorrentUsername: '',
  qbittorrentPassword: '',
  autoSendToDownloader: true
};

let downloadConfigEpoch = 0;
let lastWebhookProvisionFingerprint = '';
let activeWebhookProvisionFingerprint = '';
let activeWebhookProvisionPromise: Promise<boolean> | null = null;

function getWebhookProvisionFingerprint(config: DownloadClientConfig, uid: string): string {
  return JSON.stringify([
    uid,
    config.downloadsEnabled === true,
    config.sonarrUrl || '',
    config.sonarrApiKey || '',
    config.radarrUrl || '',
    config.radarrApiKey || ''
  ]);
}

function provisionDownloadWebhooks(
  config: DownloadClientConfig,
  uid: string,
  force = false
): Promise<boolean> {
  const hasArrConfig = Boolean(
    (config.sonarrUrl && config.sonarrApiKey) || (config.radarrUrl && config.radarrApiKey)
  );
  if (config.downloadsEnabled !== true || !hasArrConfig) return Promise.resolve(true);

  const fingerprint = getWebhookProvisionFingerprint(config, uid);
  if (!force && fingerprint === lastWebhookProvisionFingerprint) return Promise.resolve(true);
  if (fingerprint === activeWebhookProvisionFingerprint && activeWebhookProvisionPromise) {
    return activeWebhookProvisionPromise;
  }

  activeWebhookProvisionFingerprint = fingerprint;
  const promise = ensureDownloadNotificationWebhooks(config)
    .then(results => {
      const failedServices = results
        .filter(result => result.action === 'failed')
        .map(result => result.service);
      if (failedServices.length === 0) {
        lastWebhookProvisionFingerprint = fingerprint;
        return true;
      }
      appLogger.warn(
        'sync',
        `[DownloadConfig] Notifications Arr à réparer lorsque le service sera joignable : ${failedServices.join(', ')}.`
      );
      return false;
    })
    .catch(() => {
      appLogger.warn('sync', '[DownloadConfig] Provisioning automatique des notifications Arr indisponible.');
      return false;
    })
    .finally(() => {
      if (activeWebhookProvisionFingerprint === fingerprint) {
        activeWebhookProvisionFingerprint = '';
        activeWebhookProvisionPromise = null;
      }
    });
  activeWebhookProvisionPromise = promise;
  return promise;
}

export const useDownloadConfigStore = create<DownloadConfigState>()((set, get) => ({
  ...DEFAULT_CONFIG,
  scopeUid: null,
  isHydrated: false,
  isSaving: false,
  saveError: null,

  setConfig: (newConfig, shouldSave = true) => {
    set({ ...normalizeDownloadConfigPatch(newConfig), saveError: null });
    if (shouldSave) void get().saveToCloud();
  },

  saveConfig: async newConfig => {
    const previous = get();
    const normalized = normalizeDownloadConfigPatch(newConfig);
    const qbitScopeChanged =
      (normalized.qbittorrentUrl !== undefined && normalized.qbittorrentUrl !== previous.qbittorrentUrl)
      || (normalized.qbittorrentUsername !== undefined && normalized.qbittorrentUsername !== previous.qbittorrentUsername)
      || (normalized.qbittorrentPassword !== undefined && normalized.qbittorrentPassword !== previous.qbittorrentPassword);
    set({ ...normalized, saveError: null });
    if (qbitScopeChanged) invalidateQbitCache();
    return get().saveToCloud();
  },

  resetConfig: () => {
    set({ ...DEFAULT_CONFIG, saveError: null });
    void get().saveToCloud();
  },

  syncFromCloud: async () => {
    const user = auth.currentUser;
    const requestEpoch = downloadConfigEpoch;
    if (!user) {
      set({ isHydrated: true });
      return;
    }

    try {
      const docRef = doc(db, 'users', user.uid, 'settings', 'downloadConfig');
      const snap = await getDoc(docRef);
      if (requestEpoch !== downloadConfigEpoch || auth.currentUser?.uid !== user.uid) return;
      if (snap.exists()) {
        const parsed = parseDownloadConfigDocument(snap.data());
        set({
          ...parsed,
          isHydrated: true,
          saveError: null
        });
        void provisionDownloadWebhooks({ ...DEFAULT_CONFIG, ...parsed }, user.uid);
      } else {
        set({ isHydrated: true, saveError: null });
      }
    } catch (error) {
      if (requestEpoch !== downloadConfigEpoch || auth.currentUser?.uid !== user.uid) return;
      appLogger.warn('sync', '[DownloadConfig] Erreur syncFromCloud', error);
      set({
        isHydrated: true,
        saveError: error instanceof Error && error.message ? error.message : 'Impossible de charger la configuration.'
      });
    }
  },

  saveToCloud: async () => {
    const user = auth.currentUser;
    const requestEpoch = downloadConfigEpoch;
    if (!user) {
      set({ isSaving: false, saveError: 'Utilisateur non connecté.' });
      return false;
    }

    set({ isSaving: true, saveError: null });

    try {
      const current = get();
      const dataToSave: DownloadClientConfig = {
        downloadsEnabled: current.downloadsEnabled === true,
        c411ApiKey: current.c411ApiKey || '',
        sonarrUrl: current.sonarrUrl || '',
        sonarrApiKey: current.sonarrApiKey || '',
        sonarr1080pProfileId: current.sonarr1080pProfileId ?? null,
        sonarr4kProfileId: current.sonarr4kProfileId ?? null,
        radarrUrl: current.radarrUrl || '',
        radarrApiKey: current.radarrApiKey || '',
        radarr1080pProfileId: current.radarr1080pProfileId ?? null,
        radarr4kProfileId: current.radarr4kProfileId ?? null,
        qbittorrentUrl: current.qbittorrentUrl || '',
        qbittorrentUsername: current.qbittorrentUsername || '',
        qbittorrentPassword: current.qbittorrentPassword || '',
        autoSendToDownloader: current.autoSendToDownloader ?? true
      };

      const docRef = doc(db, 'users', user.uid, 'settings', 'downloadConfig');
      await setDoc(docRef, dataToSave, { merge: true });
      await provisionDownloadWebhooks(dataToSave, user.uid, true);
      if (requestEpoch !== downloadConfigEpoch || auth.currentUser?.uid !== user.uid) return true;
      set({ isSaving: false, saveError: null, isHydrated: true });
      return true;
    } catch (error) {
      if (requestEpoch !== downloadConfigEpoch || auth.currentUser?.uid !== user.uid) return false;
      appLogger.warn('sync', '[DownloadConfig] Erreur saveToCloud', error);
      set({
        isSaving: false,
        saveError: error instanceof Error && error.message ? error.message : 'Impossible de sauvegarder la configuration.'
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
    downloadConfigEpoch += 1;
    lastWebhookProvisionFingerprint = '';
    const listenerEpoch = downloadConfigEpoch;
    const listenerUid = user?.uid;
    invalidateQbitCache();
    if (unsubscribeSnapshot) {
      unsubscribeSnapshot();
      unsubscribeSnapshot = null;
    }

    useDownloadConfigStore.setState({
      ...DEFAULT_CONFIG,
      scopeUid: user?.uid || null,
      isHydrated: false,
      isSaving: false,
      saveError: null
    });

    if (!user) {
      useDownloadConfigStore.setState({ isHydrated: true });
      return;
    }

    try {
      const docRef = doc(db, 'users', user.uid, 'settings', 'downloadConfig');
      unsubscribeSnapshot = onSnapshot(
        docRef,
        snapshot => {
          if (listenerEpoch !== downloadConfigEpoch || auth.currentUser?.uid !== listenerUid) return;
          if (snapshot.exists()) {
            const parsed = parseDownloadConfigDocument(snapshot.data());
            useDownloadConfigStore.setState({
              ...parsed,
              isHydrated: true,
              saveError: null
            });
            if (listenerUid) {
              void provisionDownloadWebhooks({ ...DEFAULT_CONFIG, ...parsed }, listenerUid);
            }
          } else {
            useDownloadConfigStore.setState({ isHydrated: true });
          }
        },
        error => {
          if (listenerEpoch !== downloadConfigEpoch || auth.currentUser?.uid !== listenerUid) return;
          appLogger.warn('sync', '[DownloadConfig] Firestore snapshot warning', error);
          useDownloadConfigStore.setState({
            isHydrated: true,
            saveError: error?.message || 'Synchronisation des réglages indisponible.'
          });
        }
      );
    } catch (error) {
      appLogger.warn('sync', '[DownloadConfig] Impossible d’établir le snapshot Firestore', error);
      useDownloadConfigStore.setState({ isHydrated: true });
    }
  });
}
