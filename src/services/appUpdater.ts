import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { openExternalUrl } from '../lib/utils';
import {
  isTrustedSeenItApkUrl,
  normalizeSha256Digest,
  type SeenItReleaseInfo
} from '../features/release/releasePolicy';
import type { UpdateProgress } from '../features/release/updateProgress';
import { recordClientOperationalSignal } from '../features/logging/clientOperationalDiagnostics.ts';
import { notifyVerifiedUpdateDownload } from '../features/release/updateDownloadNotification.ts';

const localConsole = globalThis.console;

interface SeenItUpdateNativePlugin {
  installApk(options: { filePath: string }): Promise<{ sessionId: number }>;
}

const SeenItUpdate = registerPlugin<SeenItUpdateNativePlugin>('SeenItUpdate');

export { getUpdateProgressPresentation } from '../features/release/updateProgress';
export type { UpdateProgress } from '../features/release/updateProgress';

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function calculateCachedApkSha256(path: string): Promise<string> {
  const file = await Filesystem.readFile({ path, directory: Directory.Cache });
  if (typeof file.data !== 'string') {
    throw new Error('Le format du fichier APK téléchargé ne permet pas sa vérification.');
  }
  const binary = atob(file.data.replace(/^data:[^;]+;base64,/, ''));
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return bytesToHex(new Uint8Array(digest));
}

/**
 * Downloads APK directly inside the app using Capacitor's native Filesystem downloadFile,
 * verifies the file integrity/size, and launches Android Package Installer.
 */
export async function downloadAndInstallApk(
  release: Pick<SeenItReleaseInfo, 'version' | 'apkDownloadUrl' | 'apkSha256'>,
  onProgress?: (progress: UpdateProgress) => void
): Promise<{ success: boolean; error?: string }> {
  const apkUrl = release.apkDownloadUrl;
  if (!apkUrl || !isTrustedSeenItApkUrl(apkUrl, release.version)) {
    return { success: false, error: 'URL de téléchargement introuvable.' };
  }

  // If running on web / preview
  if (!Capacitor.isNativePlatform()) {
    onProgress?.({ percent: 100, status: 'done', message: 'Ouverture du lien de téléchargement...' });
    await openExternalUrl(apkUrl);
    return { success: true };
  }

  let progressListener: PluginListenerHandle | null = null;

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
      progressListener = await Filesystem.addListener('progress', (progress) => {
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
      localConsole.warn('Progress listener unsupported, continuing download...', e);
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

    const expectedSha256 = normalizeSha256Digest(release.apkSha256);
    if (expectedSha256) {
      onProgress?.({ percent: 98, status: 'downloading', message: 'Vérification de l’intégrité de l’APK...' });
      const actualSha256 = await calculateCachedApkSha256(fileName);
      if (actualSha256 !== expectedSha256) {
        await Filesystem.deleteFile({ path: fileName, directory: Directory.Cache }).catch(() => undefined);
        throw new Error('La signature SHA-256 de la mise à jour ne correspond pas à la release GitHub. Fichier supprimé.');
      }
    }

    await notifyVerifiedUpdateDownload(release.version);

    onProgress?.({ percent: 99, status: 'installing', message: 'Ouverture de l\'installeur Android...' });

    // 5. Récupérer l'URI du fichier
    const fileUri = await Filesystem.getUri({
      path: fileName,
      directory: Directory.Cache
    });

    const targetPath = downloadRes.path || fileUri.uri;

    // 6. Confier l'APK au handoff natif PackageInstaller. Android peut tuer
    // l'ancienne version pendant le remplacement ; le callback natif reprend
    // ensuite SeenIt sans laisser le launcher comme état terminal.
    await SeenItUpdate.installApk({ filePath: targetPath });

    onProgress?.({ percent: 100, status: 'done', message: 'Installeur lancé !' });
    return { success: true };
  } catch (err: unknown) {
    if (progressListener) {
      try { await progressListener.remove(); } catch {}
    }
    recordClientOperationalSignal('APP_UPDATE_CLIENT_FAILED');
    localConsole.error('Failed to download & install APK natively:', err);
    const errorMessage = err instanceof Error && err.message
      ? err.message
      : 'Erreur lors du téléchargement';

    onProgress?.({
      percent: 0,
      status: 'error',
      message: errorMessage
    });

    return {
      success: false,
      error: err instanceof Error && err.message
        ? err.message
        : 'Impossible de lancer l\'installeur automatique.'
    };
  }
}
