import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const CURRENT_APP_VERSION = '1.0.5';
const GITHUB_REPO = 'julfou7/seenit-app';

export interface AppReleaseInfo {
  version: string;
  tagName: string;
  name: string;
  releaseNotes: string;
  publishedAt: string;
  apkDownloadUrl: string | null;
  htmlUrl: string;
}

interface UpdateState {
  currentVersion: string;
  latestRelease: AppReleaseInfo | null;
  hasUpdate: boolean;
  isChecking: boolean;
  lastChecked: number | null;
  dismissedVersion: string | null;
  error: string | null;
  
  checkForUpdates: (force?: boolean) => Promise<boolean>;
  dismissUpdate: (version: string) => void;
  clearDismissed: () => void;
}

/**
 * Compare two semver strings (e.g., "1.0.4" vs "1.0.3")
 * Returns > 0 if v1 > v2, < 0 if v1 < v2, 0 if equal
 */
export function compareVersions(v1: string, v2: string): number {
  const cleanV1 = v1.replace(/^v/i, '').trim();
  const cleanV2 = v2.replace(/^v/i, '').trim();

  const parts1 = cleanV1.split('.').map(n => parseInt(n, 10) || 0);
  const parts2 = cleanV2.split('.').map(n => parseInt(n, 10) || 0);

  const maxLen = Math.max(parts1.length, parts2.length);
  for (let i = 0; i < maxLen; i++) {
    const num1 = parts1[i] || 0;
    const num2 = parts2[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

export const useUpdateStore = create<UpdateState>()(
  persist(
    (set, get) => ({
      currentVersion: CURRENT_APP_VERSION,
      latestRelease: null,
      hasUpdate: false,
      isChecking: false,
      lastChecked: null,
      dismissedVersion: null,
      error: null,

      checkForUpdates: async (force = false) => {
        const state = get();
        const now = Date.now();
        
        // Don't check more than once every 15 minutes unless forced
        if (!force && state.lastChecked && (now - state.lastChecked < 15 * 60 * 1000)) {
          return state.hasUpdate;
        }

        set({ isChecking: true, error: null });

        try {
          const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
            headers: {
              'Accept': 'application/vnd.github.v3+json'
            }
          });

          if (!response.ok) {
            throw new Error(`GitHub API HTTP ${response.status}`);
          }

          const data = await response.json();
          const tagName = data.tag_name || '';
          const remoteVersion = tagName.replace(/^v/i, '');
          
          // Find APK asset
          const apkAsset = Array.isArray(data.assets) 
            ? data.assets.find((a: any) => a.name && a.name.toLowerCase().endsWith('.apk'))
            : null;

          const releaseInfo: AppReleaseInfo = {
            version: remoteVersion,
            tagName: tagName,
            name: data.name || tagName,
            releaseNotes: data.body || '',
            publishedAt: data.published_at || new Date().toISOString(),
            apkDownloadUrl: apkAsset ? apkAsset.browser_download_url : data.html_url,
            htmlUrl: data.html_url || `https://github.com/${GITHUB_REPO}/releases`
          };

          const isNewer = compareVersions(remoteVersion, CURRENT_APP_VERSION) > 0;

          set({
            latestRelease: releaseInfo,
            hasUpdate: isNewer,
            isChecking: false,
            lastChecked: now,
            error: null
          });

          return isNewer;
        } catch (err: any) {
          console.warn('Update check failed:', err);
          set({
            isChecking: false,
            error: err.message || 'Impossible de vérifier les mises à jour',
            lastChecked: now
          });
          return false;
        }
      },

      dismissUpdate: (version: string) => {
        set({ dismissedVersion: version });
      },

      clearDismissed: () => {
        set({ dismissedVersion: null });
      }
    }),
    {
      name: 'seenit_update_store',
      partialize: (state) => ({
        lastChecked: state.lastChecked,
        dismissedVersion: state.dismissedVersion
      })
    }
  )
);
