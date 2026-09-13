import { appLogger } from './logStore';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Capacitor } from '@capacitor/core';
import {
  compareSemanticVersions,
  getUpdateMetadataEndpoints,
  parseSeenItRelease,
  resolveSeenItCompleteReleaseHistory,
  resolveSeenItReleaseHistory,
  type SeenItReleaseInfo,
  type SeenItReleaseNotesEntry
} from '../features/release/releasePolicy';

export const CURRENT_APP_VERSION = '1.4.147';
export type AppReleaseInfo = SeenItReleaseInfo;
let inFlightUpdateCheck: Promise<boolean> | null = null;
let inFlightReleaseHistory: Promise<SeenItReleaseNotesEntry[]> | null = null;

interface UpdateState {
  currentVersion: string;
  latestRelease: AppReleaseInfo | null;
  hasUpdate: boolean;
  isChecking: boolean;
  lastChecked: number | null;
  dismissedVersions: string[];
  updateModalRequestId: number;
  error: string | null;
  releaseHistory: SeenItReleaseNotesEntry[];
  isLoadingReleaseHistory: boolean;
  releaseHistoryError: string | null;

  checkForUpdates: (force?: boolean) => Promise<boolean>;
  loadReleaseHistory: (force?: boolean) => Promise<SeenItReleaseNotesEntry[]>;
  dismissUpdate: (version: string) => void;
  requestUpdateModal: () => void;
  resetDismissed: () => void;
}

export const useUpdateStore = create<UpdateState>()(
  persist(
    (set, get) => ({
      currentVersion: CURRENT_APP_VERSION,
      latestRelease: null,
      hasUpdate: false,
      isChecking: false,
      lastChecked: null,
      dismissedVersions: [],
      updateModalRequestId: 0,
      error: null,
      releaseHistory: [],
      isLoadingReleaseHistory: false,
      releaseHistoryError: null,

      checkForUpdates: async (force = false) => {
        const now = Date.now();
        const { lastChecked } = get();

        if (!force && lastChecked && now - lastChecked < 60 * 1000) {
          return get().hasUpdate;
        }

        if (inFlightUpdateCheck) return inFlightUpdateCheck;
        let completeSharedCheck: (result: boolean) => void = () => undefined;
        inFlightUpdateCheck = new Promise(resolve => {
          completeSharedCheck = resolve;
        });

        set({ isChecking: true, error: null });
        let result = false;
        try {
          let releaseInfo: AppReleaseInfo | null = null;
          const native = Capacitor.isNativePlatform();

          for (const endpoint of getUpdateMetadataEndpoints(native)) {
            try {
              const separator = endpoint.url.includes('?') ? '&' : '?';
              const response = await fetch(`${endpoint.url}${separator}_ts=${Date.now()}`, {
                headers: endpoint.kind === 'github'
                  ? { Accept: 'application/vnd.github.v3+json' }
                  : { Accept: 'application/json' }
              });
              const contentType = response.headers.get('content-type') || '';
              if (!response.ok || !contentType.includes('application/json')) continue;
              releaseInfo = parseSeenItRelease(await response.json());
              if (releaseInfo) break;
            } catch (error) {
              console.warn(`[UpdateCheck] Source ${endpoint.kind} indisponible:`, error);
            }
          }

          if (!releaseInfo) {
            throw new Error('Impossible de contacter le serveur de mise à jour.');
          }

          const remoteVersion = releaseInfo.version;
          const remoteIsNewer = compareSemanticVersions(remoteVersion, CURRENT_APP_VERSION) > 0;
          const isNewer = remoteIsNewer
            && (force || !get().dismissedVersions.includes(remoteVersion));

          if (force && remoteIsNewer) {
            set(state => ({
              dismissedVersions: state.dismissedVersions.filter(v => v !== remoteVersion)
            }));
          }

          set({
            latestRelease: releaseInfo,
            hasUpdate: isNewer,
            isChecking: false,
            lastChecked: now,
            error: null
          });

          if (remoteIsNewer) {
            const targetRelease = releaseInfo;
            void resolveSeenItReleaseHistory(CURRENT_APP_VERSION, targetRelease).then(releaseNotesHistory => {
              set(state => state.latestRelease?.version === remoteVersion
                ? { latestRelease: { ...state.latestRelease, releaseNotesHistory } }
                : state
              );
            });
          }

          result = isNewer;
          return result;
        } catch (err: any) {
          console.error('[UpdateCheck] Error checking for updates:', err);
          appLogger.error('system', `Erreur lors de la recherche de mise à jour: ${err.message || String(err)}`, err);
          set({
            isChecking: false,
            error: err?.message || 'Erreur de vérification des mises à jour'
          });
          return false;
        } finally {
          completeSharedCheck(result);
          inFlightUpdateCheck = null;
        }
      },

      loadReleaseHistory: async (force = false) => {
        if (!force && get().releaseHistory.length > 0) return get().releaseHistory;
        if (inFlightReleaseHistory) return inFlightReleaseHistory;

        inFlightReleaseHistory = (async () => {
          set({ isLoadingReleaseHistory: true, releaseHistoryError: null });
          try {
            const resolved = await resolveSeenItCompleteReleaseHistory();
            const latest = get().latestRelease;
            const fallback = latest ? [{
              version: latest.version,
              releaseNotes: latest.releaseNotes,
              publishedAt: latest.publishedAt,
              htmlUrl: latest.htmlUrl
            }] : [];
            const releaseHistory = resolved.length > 0 ? resolved : fallback;
            set({ releaseHistory, isLoadingReleaseHistory: false });
            return releaseHistory;
          } catch (err: any) {
            set({
              isLoadingReleaseHistory: false,
              releaseHistoryError: err?.message || 'Historique des versions indisponible.'
            });
            return get().releaseHistory;
          } finally {
            inFlightReleaseHistory = null;
          }
        })();

        return inFlightReleaseHistory;
      },

      dismissUpdate: (version: string) => {
        set(state => ({
          dismissedVersions: [...state.dismissedVersions, version],
          hasUpdate: false
        }));
      },

      requestUpdateModal: () => {
        set(state => ({ updateModalRequestId: state.updateModalRequestId + 1 }));
      },

      resetDismissed: () => {
        set({ dismissedVersions: [] });
      }
    }),
    {
      name: 'seenit-app-updates',
      partialize: state => ({
        dismissedVersions: state.dismissedVersions,
        lastChecked: state.lastChecked
      })
    }
  )
);
