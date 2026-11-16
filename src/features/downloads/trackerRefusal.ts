/**
 * Retour terrain du 16/11 (« bloqué faute de ratio insuffisant, SeenIt montre seulement un téléchargement à 0 % sans
 * explication ») : qBittorrent garde le message renvoyé par chaque tracker (`/api/v2/torrents/trackers`). Un refus
 * du tracker est traduit en une phrase française affichée sur la carte, au lieu d'une attente muette.
 */
export interface QbitTrackerEntry { url?: unknown; status?: unknown; msg?: unknown }

// Revue Codex #1072 : seul un message qui prouve un refus compte — une panne de connexion (« Connection timed out ») d'un
// tracker, même au statut « ne fonctionne pas », ne prouve pas que le téléchargement est interdit.
// Revue Codex #1072 : « ratio » et « credit » sont des mots entiers (« Operation timed out » n'est pas un refus).
const RATIO = /\bratio\b|\bcredits?\b|\bcrédits?\b/i;
// Revue Codex #1072 : suspensions et bannissements passent aussi le filtre (« Your account has been suspended »).
const REFUSAL = /\bratio\b|\bcredits?\b|\bcrédits?\b|bann|suspen|not allowed|non autoris|interdit|bloqu|blocked|banned|unregistered|not registered|torrent not found|introuvable/i;

export function trackerRefusal(trackers: unknown): string | null {
  if (!Array.isArray(trackers)) return null;
  for (const entry of trackers as QbitTrackerEntry[]) {
    const url = String(entry?.url ?? '');
    // DHT, PeX et LSD (« ** [DHT] ** ») ne sont pas des trackers : leurs messages ne bloquent rien.
    if (!url || url.startsWith('**')) continue;
    const message = String(entry?.msg ?? '').trim();
    if (!message) continue;
    if (!REFUSAL.test(message)) continue;
    if (RATIO.test(message)) return 'Bloqué par le tracker : ratio insuffisant.';
    if (/unregistered|not registered|not found|introuvable/i.test(message)) return 'Bloqué par le tracker : ce torrent n’y existe plus.';
    // Revue Codex #1072 : jamais le message brut (souvent anglais) du tracker — une phrase française reconnue ou générique.
    if (/banned|bann|suspen/i.test(message)) return 'Bloqué par le tracker : compte suspendu.';
    return 'Bloqué par le tracker : téléchargement refusé.';
  }
  return null;
}

/** Explication et action proposées sur la carte « À régler ». */
export function trackerRefusalHint(message: string): string {
  if (/ratio insuffisant/.test(message)) return 'Ton ratio sur ce tracker est trop bas : le téléchargement reprendra quand tu auras assez partagé ou acheté du crédit de téléchargement. Tu peux aussi choisir une version d’un autre tracker.';
  if (/n’y existe plus/.test(message)) return 'Le tracker a retiré ce torrent : choisis une autre version.';
  if (/compte suspendu/.test(message)) return 'Ton compte sur ce tracker est suspendu : vérifie-le sur le site du tracker ou choisis une version d’un autre tracker.';
  return 'Le tracker refuse ce téléchargement : vérifie ton compte sur le tracker ou choisis une autre version.';
}
