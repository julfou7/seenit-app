import { cleanUrl } from '../../services/sonarrRadarr';
import { executeArrInteractivePost } from '../../services/sonarrRadarrTransport';
import type { LiveDownloadItem } from '../../services/sonarrRadarrLive';
import { downloadGroup } from './downloadGroups.ts';
import { formatFreeSpace } from './arrDiskSpace.ts';

/**
 * Retour terrain du 16/11 (Dexter S02E02 téléchargé, bloqué dans qBittorrent faute de place sur D:) : « je ne peux pas
 * relancer l'import Plex manuellement si je libère de la place ». Sonarr/Radarr réimportent un téléchargement terminé
 * sur demande (commande `DownloadedEpisodesScan` / `DownloadedMoviesScan`, dossier et identifiant exacts du
 * transfert). Proposé seulement pour un transfert terminé, en échec d'import faute de place, dont le dossier et
 * l'identifiant sont connus ; jamais de recherche ni de nouveau téléchargement.
 */
const DISK_FULL = /disque plein|espace de stockage insuffisant|not enough free space|disk is full|no space left/i;

export function canRetryImport(item: LiveDownloadItem): boolean {
  // Revue Codex #1064 : le pourcentage est arrondi (99,6 % → 100) ; un reste d'octets prime, le pourcentage ne sert
  // que si la taille est inconnue.
  const left = Number(item.sizeleft);
  const done = Number(item.size) > 0 && Number.isFinite(left) ? left <= 0 : Number(item.progress) >= 100;
  return downloadGroup(item) === 'attention' && done && Boolean(item.downloadId && item.transferPath)
    && DISK_FULL.test(`${item.errorMessage || ''} ${item.statusText || ''}`);
}

/** Sonarr range l'identifiant d'un torrent en majuscules (empreinte hexadécimale). */
const arrDownloadId = (id: string) => /^[0-9a-f]{40}$/i.test(id) ? id.toUpperCase() : id;

/** Espace manquant avant de relancer (octets), si le disque de destination est connu. */
export function missingSpace(item: LiveDownloadItem, freeSpace?: number): number {
  if (freeSpace === undefined || !(Number(item.size) > 0)) return 0;
  // Marge de 100 Mo, comme le minimum par défaut de Sonarr/Radarr à l'import.
  return Math.max(0, Number(item.size) + 100 * 1024 ** 2 - freeSpace);
}

export const missingSpaceMessage = (missing: number) => `Il manque encore ${formatFreeSpace(missing)} sur le disque : libère de la place puis relance l’import.`;

type RetryConfig = { sonarrUrl?: string; sonarrApiKey?: string; radarrUrl?: string; radarrApiKey?: string };
export async function retryImport(config: RetryConfig, item: LiveDownloadItem, post: (url: string, body: unknown, headers: Record<string, string>) => Promise<unknown> = executeArrInteractivePost): Promise<void> {
  if (!canRetryImport(item)) throw new Error('Cet import ne peut pas être relancé depuis SeenIt.');
  const isTv = item.mediaType === 'tv';
  const url = isTv ? config.sonarrUrl : config.radarrUrl;
  const apiKey = isTv ? config.sonarrApiKey : config.radarrApiKey;
  if (!url?.trim() || !apiKey?.trim()) throw new Error(`${isTv ? 'Sonarr' : 'Radarr'} n’est pas configuré.`);
  await post(`${cleanUrl(url)}/api/v3/command`, {
    name: isTv ? 'DownloadedEpisodesScan' : 'DownloadedMoviesScan',
    path: item.transferPath,
    downloadClientId: arrDownloadId(String(item.downloadId)),
    importMode: 'Auto',
  }, { 'X-Api-Key': apiKey, Accept: 'application/json' });
}
