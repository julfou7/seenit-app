import { appLogger } from './logStore';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Capacitor } from '@capacitor/core';
import {
  compareSemanticVersions,
  getUpdateMetadataEndpoints,
  parseSeenItRelease,
  type SeenItReleaseInfo
} from '../features/release/releasePolicy';

export const CURRENT_APP_VERSION = '1.4.86';
export type AppReleaseInfo = SeenItReleaseInfo;

interface UpdateState {
  currentVersion: string;
  latestRelease: AppReleaseInfo | null;
  hasUpdate: boolean;
  isChecking: boolean;
  lastChecked: number | null;
  dismissedVersions: string[];
  error: string | null;

  checkForUpdates: (force?: boolean) => Promise<boolean>;
  dismissUpdate: (version: string) => void;
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
      error: null,

      checkForUpdates: async (force = false) => {
        const now = Date.now();
        const { lastChecked, isChecking } = get();

        if (!force && lastChecked && now - lastChecked < 60 * 1000) {
          return get().hasUpdate;
        }

        if (isChecking) return get().hasUpdate;

        set({ isChecking: true, error: null });

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
          const isNewer = compareSemanticVersions(remoteVersion, CURRENT_APP_VERSION) > 0
            && (force || !get().dismissedVersions.includes(remoteVersion));

          if (force && compareSemanticVersions(remoteVersion, CURRENT_APP_VERSION) > 0) {
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

          return isNewer;
        } catch (err: any) {
          console.error('[UpdateCheck] Error checking for updates:', err);
          appLogger.error('system', `Erreur lors de la recherche de mise à jour: ${err.message || String(err)}`, err);
          set({
            isChecking: false,
            error: err?.message || 'Erreur de vérification des mises à jour'
          });
          return false;
        }
      },

      dismissUpdate: (version: string) => {
        set(state => ({
          dismissedVersions: [...state.dismissedVersions, version],
          hasUpdate: false
        }));
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
