import type { LiveDownloadItem } from '../../services/sonarrRadarrLive.ts';
import { downloadGroup } from './downloadGroups.ts';

export type EpisodeDownloadPresentation = { kind: 'present' | 'active' | 'attention' | 'available' | 'future'; label: string; disabled: boolean };

/** Une présence physique exacte prime sur l'historique de transfert, jamais sur le statut « vu ». */
export function episodeDownloadPresentation(episode: number, aired: boolean, hasFile: boolean, item?: LiveDownloadItem | null): EpisodeDownloadPresentation {
  if (hasFile) return { kind: 'present', label: `Épisode ${episode} disponible`, disabled: true };
  if (item && ['active', 'waiting'].includes(downloadGroup(item))) return { kind: 'active', label: `Téléchargement de l’épisode ${episode} : ${item.statusText}`, disabled: true };
  if (item && downloadGroup(item) === 'attention') return { kind: 'attention', label: `Réessayer le téléchargement de l’épisode ${episode}`, disabled: false };
  if (!aired) return { kind: 'future', label: `Épisode ${episode} à venir`, disabled: true };
  return { kind: 'available', label: `Télécharger l’épisode ${episode}`, disabled: false };
}
