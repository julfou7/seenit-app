/**
 * #1077 (audit téléchargements du 16/11) : un transfert sans aucune source (torrent mort, tracker muet) restait
 * « En attente de sources » sans limite ni action. qBittorrent dit combien de sources sont connectées (`num_seeds`)
 * et connues de l'essaim (`num_complete`), et depuis quand rien n'a bougé (`last_activity`, sinon `added_on`).
 * Sans aucune source depuis 30 minutes, le transfert passe dans « À régler » avec une durée et la marche à suivre.
 */
export const NO_SOURCE_AFTER_SECONDS = 30 * 60;

type QbitStallFields = { state?: unknown; num_seeds?: unknown; num_complete?: unknown; last_activity?: unknown; added_on?: unknown };
const WAITING_STATES = new Set(['stalledDL', 'metaDL']);

/** Secondes depuis lesquelles le transfert n'a aucune source, ou `null` s'il en a, avance, ou n'attend pas encore assez. */
export function noSourceSeconds(torrent: QbitStallFields, nowSeconds = Math.floor(Date.now() / 1000)): number | null {
  if (!WAITING_STATES.has(String(torrent.state))) return null;
  if (Number(torrent.num_seeds) > 0 || Number(torrent.num_complete) > 0) return null;
  const since = Math.max(Number(torrent.last_activity) || 0, Number(torrent.added_on) || 0);
  if (!(since > 0)) return null;
  const waited = nowSeconds - since;
  return waited >= NO_SOURCE_AFTER_SECONDS ? waited : null;
}

/** « 45 min », « 2 h », « 3 j » */
export function formatStallDuration(seconds: number): string {
  if (seconds < 3600) return `${Math.max(1, Math.floor(seconds / 60))} min`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h`;
  return `${Math.floor(seconds / 86_400)} j`;
}

export const noSourceMessage = (seconds: number) => `Aucune source depuis ${formatStallDuration(seconds)}`;

export const NO_SOURCE_HINT = 'Personne ne partage ce fichier en ce moment : choisis une autre version, ou attends qu’une source revienne.';
