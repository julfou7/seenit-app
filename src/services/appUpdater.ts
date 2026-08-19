import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { FileOpener } from '@capacitor-community/file-opener';
import { Browser } from '@capacitor/browser';

export interface UpdateProgress {
  percent: number;
  status: 'idle' | 'downloading' | 'installing' | 'error' | 'done';
  message: string;
}

/**
 * Downloads APK directly inside the app and opens the native Android package installer.
 */
export async function downloadAndInstallApk(
  apkUrl: string,
  onProgress?: (progress: UpdateProgress) => void
): Promise<{ success: boolean; error?: string }> {
  if (!apkUrl) {
    return { success: false, error: 'URL de téléchargement introuvable.' };
  }

  // If running on web / non-native
  if (!Capacitor.isNativePlatform()) {
    onProgress?.({ percent: 100, status: 'done', message: 'Ouverture du lien de téléchargement...' });
    window.open(apkUrl, '_blank');
    return { success: true };
  }

  try {
    onProgress?.({ percent: 5, status: 'downloading', message: 'Connexion au serveur de mise à jour...' });

    const fileName = 'SeenIt-update.apk';

    // 1. Download file with progress using fetch + Filesystem or direct download
    const response = await fetch(apkUrl);
    if (!response.ok) {
      throw new Error(`Erreur lors du téléchargement (${response.status})`);
    }

    const contentLengthHeader = response.headers.get('content-length');
    const totalBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;

    let blob: Blob;

    if (response.body && totalBytes > 0) {
      const reader = response.body.getReader();
      let receivedBytes = 0;
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        receivedBytes += value.length;

        const percent = Math.min(95, Math.round((receivedBytes / totalBytes) * 90) + 5);
        const mbReceived = (receivedBytes / (1024 * 1024)).toFixed(1);
        const mbTotal = (totalBytes / (1024 * 1024)).toFixed(1);

        onProgress?.({
          percent,
          status: 'downloading',
          message: `Téléchargement : ${mbReceived} Mo / ${mbTotal} Mo (${percent}%)`
        });
      }

      blob = new Blob(chunks, { type: 'application/vnd.android.package-archive' });
    } else {
      onProgress?.({ percent: 50, status: 'downloading', message: 'Téléchargement de la mise à jour...' });
      blob = await response.blob();
    }

    onProgress?.({ percent: 95, status: 'installing', message: 'Préparation du paquet d\'installation...' });

    // 2. Convert blob to base64 to save with Filesystem
    const reader = new FileReader();
    const base64Promise = new Promise<string>((resolve, reject) => {
      reader.onloadend = () => {
        const base64data = reader.result as string;
        // remove the data:*/*;base64, header
        const base64 = base64data.split(',')[1] || '';
        resolve(base64);
      };
      reader.onerror = reject;
    });
    reader.readAsDataURL(blob);
    const base64Data = await base64Promise;

    // 3. Write APK to Cache directory
    await Filesystem.writeFile({
      path: fileName,
      data: base64Data,
      directory: Directory.Cache
    });

    // 4. Get native File URI
    const fileUri = await Filesystem.getUri({
      path: fileName,
      directory: Directory.Cache
    });

    onProgress?.({ percent: 100, status: 'installing', message: 'Lancement de l\'installeur Android...' });

    // 5. Open APK with Android Package Installer
    await FileOpener.open({
      filePath: fileUri.uri,
      contentType: 'application/vnd.android.package-archive',
      openWithDefault: true
    });

    onProgress?.({ percent: 100, status: 'done', message: 'Installeur prêt !' });
    return { success: true };
  } catch (err: any) {
    console.error('Failed to in-app update APK:', err);
    onProgress?.({
      percent: 0,
      status: 'error',
      message: 'Basculement vers le navigateur...'
    });

    // Fallback: Open URL in external browser
    try {
      await Browser.open({ url: apkUrl });
    } catch {
      window.open(apkUrl, '_system');
    }

    return {
      success: false,
      error: err?.message || 'Impossible de lancer l\'installeur automatique.'
    };
  }
}
