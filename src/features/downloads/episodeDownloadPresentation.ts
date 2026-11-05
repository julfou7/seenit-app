import type { LiveDownloadItem } from '../../services/sonarrRadarrLive.ts';
import { hasExplicitDownloadError, isDownloadCompleted } from './downloadStatePolicy.ts';

export type EpisodeDownloadPresentation = { kind: 'present' | 'active' | 'attention' | 'available' | 'future'; label: string; disabled: boolean };

/** Une présence physique exacte prime sur l'historique de transfert, jamais sur le statut « vu ». */
export function episodeDownloadPresentation(episode: number, aired: boolean, hasFile: boolean, item?: LiveDownloadItem | null): EpisodeDownloadPresentation {
  if (hasFile) return { kind: 'present', label: `Épisode ${episode} disponible`, disabled: true };
  if (item && (hasExplicitDownloadError(item) || item.status === 'warning')) return { kind: 'attention', label: `Réessayer le téléchargement de l’épisode ${episode}`, disabled: false };
  if (item && item.status !== 'cancelled' && !isDownloadCompleted(item)) return { kind: 'active', label: `Téléchargement de l’épisode ${episode} : ${item.statusText}`, disabled: true };
  if (!aired) return { kind: 'future', label: `Épisode ${episode} à venir`, disabled: true };
  return { kind: 'available', label: `Télécharger l’épisode ${episode}`, disabled: false };
}
