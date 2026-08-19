import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { FileOpener } from '@capacitor-community/file-opener';
import { openExternalUrl } from '../lib/utils';
import { GITHUB_PAT } from '../store/updateStore';

export interface UpdateProgress {
  percent: number;
  status: 'idle' | 'downloading' | 'installing' | 'error' | 'done';
  message: string;
}

/**
 * Downloads APK directly inside the app using Capacitor's native Filesystem downloadFile
 * with GitHub PAT authentication to support private repositories, and launches Android Package Installer.
 */
export async function downloadAndInstallApk(
  apkUrl: string,
  onProgress?: (progress: UpdateProgress) => void
): Promise<{ success: boolean; error?: string }> {
  if (!apkUrl) {
    return { success: false, error: 'URL de téléchargement introuvable.' };
  }

  // If running on web / preview
  if (!Capacitor.isNativePlatform()) {
    onProgress?.({ percent: 100, status: 'done', message: 'Ouverture du lien de téléchargement...' });
    await openExternalUrl(apkUrl);
    return { success: true };
  }

  let progressListener: any = null;

  try {
    onProgress?.({ percent: 5, status: 'downloading', message: 'Connexion au serveur de mise à jour...' });

    const fileName = 'SeenIt-update.apk';

    // 1. Delete previous cache file if existing
    try {
      await Filesystem.deleteFile({
        path: fileName,
        directory: Directory.Cache
      });
    } catch {
      // Ignored if file does not exist
    }

    // 2. Attach native download progress listener
    try {
      progressListener = await Filesystem.addListener('progress', (progress: any) => {
        if (progress.bytes && progress.contentLength) {
          const percent = Math.min(98, Math.round((progress.bytes / progress.contentLength) * 100));
          const mbReceived = (progress.bytes / (1024 * 1024)).toFixed(1);
          const mbTotal = (progress.contentLength / (1024 * 1024)).toFixed(1);

          onProgress?.({
            percent,
            status: 'downloading',
            message: `Téléchargement : ${mbReceived} Mo / ${mbTotal} Mo (${percent}%)`
          });
        }
      });
    } catch (e) {
      console.warn('Progress listener unsupported, continuing download...', e);
    }

    onProgress?.({ percent: 15, status: 'downloading', message: 'Téléchargement de la mise à jour...' });

    // Prepare auth headers for GitHub (supports private repo release asset endpoints)
    const isGitHub = apkUrl.includes('github.com');
    const headers: Record<string, string> = {};
    if (isGitHub && GITHUB_PAT) {
      headers['Authorization'] = `Bearer ${GITHUB_PAT}`;
      headers['Accept'] = 'application/octet-stream';
    }

    // 3. Native Android HTTP download (executes in Java, bypasses browser CORS completely)
    const downloadRes = await Filesystem.downloadFile({
      url: apkUrl,
      path: fileName,
      directory: Directory.Cache,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      progress: true,
      recursive: true
    });

    if (progressListener) {
      try {
        await progressListener.remove();
      } catch {}
      progressListener = null;
    }

    onProgress?.({ percent: 99, status: 'installing', message: 'Ouverture de l\'installeur Android...' });

    // 4. Get file URI
    const fileUri = await Filesystem.getUri({
      path: fileName,
      directory: Directory.Cache
    });

    const targetPath = downloadRes.path || fileUri.uri;

    // 5. Open with Android package installer
    await FileOpener.open({
      filePath: targetPath,
      contentType: 'application/vnd.android.package-archive',
      openWithDefault: true
    });

    onProgress?.({ percent: 100, status: 'done', message: 'Installeur lancé !' });
    return { success: true };
  } catch (err: any) {
    if (progressListener) {
      try { await progressListener.remove(); } catch {}
    }
    console.error('Failed to download & install APK natively:', err);

    onProgress?.({
      percent: 0,
      status: 'error',
      message: err?.message || 'Erreur lors du téléchargement'
    });

    return {
      success: false,
      error: err?.message || 'Impossible de lancer l\'installeur automatique.'
    };
  }
}
