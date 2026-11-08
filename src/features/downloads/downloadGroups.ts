import type { LiveDownloadItem } from '../../services/sonarrRadarrLive';
import { hasExplicitDownloadError, isDownloadCompleted } from './downloadStatePolicy.ts';

export type DownloadGroup = 'attention' | 'active' | 'waiting' | 'completed' | 'cancelled';
/** Une carte unique ; une panne ou un import en attente ne disparaît jamais derrière 100 %. */
export function downloadGroup(item: Pick<LiveDownloadItem, 'status' | 'progress' | 'errorMessage' | 'importState'>): DownloadGroup {
  if (hasExplicitDownloadError(item) || item.status === 'warning') return 'attention';
  if (item.status === 'cancelled') return 'cancelled';
  if (item.status === 'waiting') return 'waiting';
  if (isDownloadCompleted(item)) return 'completed';
  return 'active';
}

/**
 * Retour terrain du 08/11 : une demande pas encore confiée au client (recherche ou envoi sans progression)
 * s'affiche dans « En attente » avec les releases introuvables, pas dans « En cours ».
 */
export function isPreTransferRequest(item: Pick<LiveDownloadItem, 'status' | 'progress'>): boolean {
  return (item.status === 'searching' || item.status === 'submitting') && !(Number(item.progress) > 0);
}

/**
 * Retour terrain du 08/11 (« Le Chat Chapeauté ») : une demande sans release dont la surveillance Sonarr/Radarr
 * est confirmée est un titre programmé — il partira seul dès qu'une version sortira. Elle s'affiche dans
 * « Programmés », jamais comme une erreur. Une attente non confirmée reste un problème à régler.
 */
export function isWatchedWaitingRequest(item: Pick<LiveDownloadItem, 'status' | 'progress' | 'errorMessage' | 'importState' | 'availability'>): boolean {
  return downloadGroup(item) === 'waiting' && item.availability?.reason === 'no_release' && item.availability.automatic === true;
}

export function downloadProblem(message: string): { title: string; hint: string } {
  if (/manual import|import manuel/i.test(message)) return { title: 'Import manuel requis', hint: 'Le fichier est arrivé, mais le client n’a pas confirmé son import. Choisis une autre version ou vérifie l’import dans le client.' };
  if (/not an upgrade/i.test(message)) return { title: 'Une version équivalente existe déjà', hint: 'Choisis une autre qualité pour chercher une amélioration. Aucun remplacement n’a été confirmé.' };
  return { title: 'Une intervention est nécessaire', hint: message || 'Vérifie le client de téléchargement ou cherche une autre version.' };
}
