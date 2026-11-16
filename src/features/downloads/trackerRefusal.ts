/**
 * Retour terrain du 16/11 (« bloqué faute de ratio insuffisant, SeenIt montre seulement un téléchargement à 0 % sans
 * explication ») : qBittorrent garde le message renvoyé par chaque tracker (`/api/v2/torrents/trackers`). Un refus
 * du tracker est traduit en une phrase française affichée sur la carte, au lieu d'une attente muette.
 */
export interface QbitTrackerEntry { url?: unknown; status?: unknown; msg?: unknown }

/** Statut qBittorrent d'un tracker : 2 = fonctionne, 4 = ne fonctionne pas. */
const NOT_WORKING = 4;
const REFUSAL = /ratio|credit|crédit|not allowed|non autoris|interdit|bloqu|blocked|banned|unregistered|not registered|not found|introuvable|limit/i;

export function trackerRefusal(trackers: unknown): string | null {
  if (!Array.isArray(trackers)) return null;
  for (const entry of trackers as QbitTrackerEntry[]) {
    const url = String(entry?.url ?? '');
    // DHT, PeX et LSD (« ** [DHT] ** ») ne sont pas des trackers : leurs messages ne bloquent rien.
    if (!url || url.startsWith('**')) continue;
    const message = String(entry?.msg ?? '').trim();
    if (!message) continue;
    if (Number(entry?.status) !== NOT_WORKING && !REFUSAL.test(message)) continue;
    if (/ratio|credit|crédit/i.test(message)) return 'Bloqué par le tracker : ratio insuffisant.';
    if (/unregistered|not registered|not found|introuvable/i.test(message)) return 'Bloqué par le tracker : ce torrent n’y existe plus.';
    return `Bloqué par le tracker : « ${message.slice(0, 160)} ».`;
  }
  return null;
}

/** Explication et action proposées sur la carte « À régler ». */
export function trackerRefusalHint(message: string): string {
  if (/ratio insuffisant/.test(message)) return 'Ton ratio sur ce tracker est trop bas : le téléchargement reprendra quand tu auras assez partagé ou acheté du crédit de téléchargement. Tu peux aussi choisir une version d’un autre tracker.';
  if (/n’y existe plus/.test(message)) return 'Le tracker a retiré ce torrent : choisis une autre version.';
  return 'Le tracker refuse ce téléchargement : vérifie ton compte sur le tracker ou choisis une autre version.';
}
