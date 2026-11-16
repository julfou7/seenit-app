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

export type TrackerNoteCache = Map<string, { at: number; note: string | null }>;
export const TRACKER_NOTE_TTL_MS = 60_000;
export const TRACKER_NOTE_MAX_AGE_MS = 3 * TRACKER_NOTE_TTL_MS;
export const TRACKER_READS_PER_PASS = 5;
const STOPPED_STATES = new Set(['stalledDL', 'metaDL', 'downloading', 'forcedDL', 'queuedDL']);

/**
 * Notes de refus des torrents à l'arrêt, par hash (#1078 : extrait du suivi qBittorrent pour être testé en exécution).
 * Règles de la revue Codex #1072 :
 * - une note appartient à une connexion (`scope` : UID, URL, utilisateur), jamais réutilisée pour une autre ;
 * - une note de moins d'une minute est rendue sans relecture ; au plus 5 relectures par passage, les plus anciennes
 *   (jamais lues d'abord) : au-delà de 5 torrents, chacun finit par être relu ;
 * - une note que les relectures n'ont pas pu confirmer depuis 3 minutes n'est plus rendue.
 */
export async function collectTrackerRefusals(cache: TrackerNoteCache, torrents: readonly unknown[], scope: string,
  readTrackers: (hash: string) => Promise<unknown>, now = Date.now()): Promise<Map<string, string>> {
  const stopped = torrents.map(torrent => torrent as { hash?: string; state?: string; dlspeed?: number; progress?: number })
    .filter(torrent => torrent.hash && STOPPED_STATES.has(String(torrent.state)) && !(Number(torrent.dlspeed) > 0) && Number(torrent.progress || 0) < 0.995)
    .map(torrent => ({ hash: String(torrent.hash), key: `${scope}|${String(torrent.hash)}` }));
  const stale = stopped.filter(({ key }) => { const cached = cache.get(key); return !cached || now - cached.at > TRACKER_NOTE_TTL_MS; })
    // Un torrent jamais lu passe toujours avant un torrent déjà lu, quelle que soit la date de lecture (#1078).
    .sort((a, b) => (cache.get(a.key)?.at ?? -Infinity) - (cache.get(b.key)?.at ?? -Infinity)).slice(0, TRACKER_READS_PER_PASS);
  await Promise.allSettled(stale.map(async ({ hash, key }) => { cache.set(key, { at: now, note: trackerRefusal(await readTrackers(hash)) }); }));
  const notes = new Map<string, string>();
  for (const { hash, key } of stopped) {
    const cached = cache.get(key);
    if (cached?.note && now - cached.at <= TRACKER_NOTE_MAX_AGE_MS) notes.set(hash, cached.note);
  }
  return notes;
}

/** Explication et action proposées sur la carte « À régler ». */
export function trackerRefusalHint(message: string): string {
  if (/ratio insuffisant/.test(message)) return 'Ton ratio sur ce tracker est trop bas : le téléchargement reprendra quand tu auras assez partagé ou acheté du crédit de téléchargement. Tu peux aussi choisir une version d’un autre tracker.';
  if (/n’y existe plus/.test(message)) return 'Le tracker a retiré ce torrent : choisis une autre version.';
  if (/compte suspendu/.test(message)) return 'Ton compte sur ce tracker est suspendu : vérifie-le sur le site du tracker ou choisis une version d’un autre tracker.';
  return 'Le tracker refuse ce téléchargement : vérifie ton compte sur le tracker ou choisis une autre version.';
}
