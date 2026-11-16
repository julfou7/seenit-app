import { hasActiveDownloadInScope } from './downloadSearchGuard.ts';
import { samePhysicalDownload } from './downloadIdentity.ts';
import type { LiveDownloadItem } from '../../services/sonarrRadarrLive';

/**
 * #1078 — Choix des transferts que remplace une version choisie dans « Autre version » (retour terrain du 16/11 :
 * « fichier trop gros, je veux une version plus légère alors que le téléchargement a commencé »). Extrait du composant
 * pour être testé en exécution, avec les cas relevés par la revue Codex #1070 :
 * - seuls les transferts que la version couvre sont remplacés : un épisode seul n'annule jamais le pack de saison ni les
 *   autres épisodes ; une couverture inconnue n'annule rien ;
 * - la version choisie, si elle est déjà en cours, n'est jamais annulée ;
 * - une demande pas encore confiée à Sonarr, Radarr ou qBittorrent ne s'annule pas à distance de façon prouvée :
 *   le remplacement est alors refusé (même règle que `deleteLiveDownloadItem`).
 */
export interface ReplacementCandidate { episodes?: 'season' | number[]; infoHash?: string }
export interface ReplacementScope { mediaType: 'tv' | 'movie'; tmdbId?: number; seasonNumber?: number; episodeNumber?: number }
export type ReplacementPlan = { kind: 'none' } | { kind: 'replace'; replaced: LiveDownloadItem[] } | { kind: 'blocked'; reason: string };

export const NOT_YET_AT_CLIENT = 'La demande en cours n’est pas encore chez le client : attends qu’elle apparaisse dans « En cours » pour la remplacer.';
const REMOTELY_CANCELABLE = /^(sonarr|radarr|qbit)_/;

export function planReplacement(downloads: readonly LiveDownloadItem[], scope: ReplacementScope, candidate: ReplacementCandidate): ReplacementPlan {
  const covers = (download: LiveDownloadItem) => scope.mediaType === 'movie' || candidate.episodes === 'season'
    || (download.episodeNumber != null && Array.isArray(candidate.episodes) && candidate.episodes.includes(Number(download.episodeNumber)));
  const replaced = downloads.filter(download => hasActiveDownloadInScope([download], scope)
    && covers(download) && !(candidate.infoHash && samePhysicalDownload(download, { downloadId: candidate.infoHash })));
  if (!replaced.length) return { kind: 'none' };
  if (replaced.some(download => !REMOTELY_CANCELABLE.test(download.id))) return { kind: 'blocked', reason: NOT_YET_AT_CLIENT };
  return { kind: 'replace', replaced };
}
