import { appLogger } from './logStore';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Capacitor } from '@capacitor/core';

export const CURRENT_APP_VERSION = '1.3.67';
export const GITHUB_REPO = 'julfou7/seenit-app';
export const GITHUB_PAT = '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';

export interface AppReleaseInfo {
  version: string;
  tagName: string;
  name: string;
  releaseNotes: string;
  publishedAt: string;
  apkDownloadUrl: string;
  browserDownloadUrl: string;
  htmlUrl: string;
}

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

// Semver compare: returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal
function compareVersions(v1: string, v2: string): number {
  const p1 = v1.replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  const p2 = v2.replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);

  for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
    const num1 = p1[i] || 0;
    const num2 = p2[i] || 0;
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
      dismissedVersions: [],
      error: null,

      checkForUpdates: async (force = false) => {
        const now = Date.now();
        const { lastChecked, isChecking } = get();

        // Avoid polling too frequently unless forced (min 1 min cache)
        if (!force && lastChecked && now - lastChecked < 60 * 1000) {
          return get().hasUpdate;
        }

        if (isChecking) return get().hasUpdate;

        set({ isChecking: true, error: null });

        try {
          let data: any = null;

          // 1. Direct GitHub Releases API fetch (use URL cache-busting param to avoid CORS preflight errors with custom headers)
          try {
            const ghUrl = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest?_ts=${Date.now()}`;
            const ghRes = await fetch(ghUrl, {
              headers: {
                'Accept': 'application/vnd.github.v3+json',
                'Authorization': `Bearer ${GITHUB_PAT}`
              }
            });
            const contentType = ghRes.headers.get('content-type') || '';
            if (ghRes.ok && contentType.includes('application/json')) {
              data = await ghRes.json();
            }
          } catch (e) {
            console.warn('[UpdateCheck] Direct GitHub API fetch failed:', e);
          }

          // 2. Fallback to backend /api/update (ONLY on web preview, NEVER on native Capacitor app where relative fetch hits local SPA index.html)
          if (!data && !Capacitor.isNativePlatform() && typeof window !== 'undefined' && window.location.protocol.startsWith('http')) {
            try {
              const proxyRes = await fetch('/api/update');
              const proxyContentType = proxyRes.headers.get('content-type') || '';
              if (proxyRes.ok && proxyContentType.includes('application/json')) {
                data = await proxyRes.json();
              }
            } catch (e) {
              console.warn('[UpdateCheck] Backend proxy fallback failed:', e);
            }
          }

          if (!data || !data.tag_name) {
            throw new Error('Impossible de contacter le serveur de mise à jour.');
          }

          const tagName = data.tag_name || '';
          const remoteVersion = tagName.replace(/^v/i, '');
          
          // Find APK asset
          const apkAsset = Array.isArray(data.assets) 
            ? data.assets.find((a: any) => a.name && a.name.toLowerCase().endsWith('.apk') && a.name.startsWith('SeenIt-')) ||
              data.assets.find((a: any) => a.name && a.name.toLowerCase().endsWith('.apk'))
            : null;

          const releaseInfo: AppReleaseInfo = {
            version: remoteVersion,
            tagName: tagName,
            name: data.name || tagName,
            releaseNotes: data.body || '',
            publishedAt: data.published_at || new Date().toISOString(),
            // Prefer authenticated API url for private repo native download
            apkDownloadUrl: apkAsset ? (apkAsset.url || apkAsset.browser_download_url) : `https://github.com/${GITHUB_REPO}/releases/download/${tagName}/SeenIt-${tagName}.apk`,
            browserDownloadUrl: apkAsset?.browser_download_url || `https://github.com/${GITHUB_REPO}/releases/download/${tagName}/SeenIt-${tagName}.apk`,
            htmlUrl: data.html_url || `https://github.com/${GITHUB_REPO}/releases`
          };

          const isNewer = compareVersions(remoteVersion, CURRENT_APP_VERSION) > 0 && (force || !get().dismissedVersions.includes(remoteVersion));

          // If forced check and there is a newer version, clean it from dismissedVersions so the banner shows up
          if (force && compareVersions(remoteVersion, CURRENT_APP_VERSION) > 0) {
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
      partialize: (state) => ({
        dismissedVersions: state.dismissedVersions,
        lastChecked: state.lastChecked
      })
    }
  )
);
