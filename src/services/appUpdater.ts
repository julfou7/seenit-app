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
 * Downloads APK directly inside the app using Capacitor's native Filesystem downloadFile,
 * verifies the file integrity/size, and launches Android Package Installer.
 */
export async function downloadAndInstallApk(
  rawApkUrl: string,
  onProgress?: (progress: UpdateProgress) => void
): Promise<{ success: boolean; error?: string }> {
  if (!rawApkUrl) {
    return { success: false, error: 'URL de téléchargement introuvable.' };
  }

  // Normalisation de l'URL : s'assurer qu'on utilise le binaire direct et pas l'API REST metadata JSON
  let apkUrl = rawApkUrl;
  if (apkUrl.includes('api.github.com/repos/') && apkUrl.includes('/releases/assets/')) {
    // Remplacer par l'URL publique de téléchargement direct
    apkUrl = apkUrl.replace('api.github.com/repos/', 'github.com/').replace('/releases/assets/', '/releases/download/');
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

    // 1. Supprimer le fichier de cache précédent s'il existe
    try {
      await Filesystem.deleteFile({
        path: fileName,
        directory: Directory.Cache
      });
    } catch {
      // Ignoré si le fichier n'existe pas encore
    }

    // 2. Écouter la progression du téléchargement natif
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

    // 3. Téléchargement HTTP natif Android (exécuté en Java, sans restrictions CORS de WebView)
    const downloadRes = await Filesystem.downloadFile({
      url: apkUrl,
      path: fileName,
      directory: Directory.Cache,
      progress: true,
      recursive: true
    });

    if (progressListener) {
      try {
        await progressListener.remove();
      } catch {}
      progressListener = null;
    }

    // 4. Vérification de l'intégrité et de la taille du fichier téléchargé
    const stat = await Filesystem.stat({
      path: fileName,
      directory: Directory.Cache
    });

    if (!stat || stat.size < 1024 * 500) {
      throw new Error(`Le fichier téléchargé est invalide ou incomplet (${Math.round((stat?.size || 0) / 1024)} Ko). Veuillez réessayer.`);
    }

    onProgress?.({ percent: 99, status: 'installing', message: 'Ouverture de l\'installeur Android...' });

    // 5. Récupérer l'URI du fichier
    const fileUri = await Filesystem.getUri({
      path: fileName,
      directory: Directory.Cache
    });

    const targetPath = downloadRes.path || fileUri.uri;

    // 6. Ouvrir l'archive APK avec le Package Installer natif d'Android
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
