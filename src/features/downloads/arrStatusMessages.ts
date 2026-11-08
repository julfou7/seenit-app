/**
 * Retour terrain du 08/11 : « en cas d'erreur, ne pas mélanger anglais et français ». Les messages de Sonarr,
 * Radarr et du client arrivent en anglais ; les cas connus sont traduits, un message anglais inconnu devient
 * un message français générique (jamais une phrase anglaise dans l'interface), un message déjà français est
 * gardé tel quel.
 */
const KNOWN: ReadonlyArray<readonly [RegExp, string]> = [
  [/stalled with no connections/i, 'Aucune source connectée pour l’instant'],
  [/disk is full|not enough free space|no space left|space left on device/i, 'Disque plein : espace de stockage insuffisant'],
  [/access (?:to the path .* )?(?:is )?denied|permission denied/i, 'Erreur d’accès ou de permissions sur le disque'],
  [/download client is unavailable|client unavailable|could not connect|unable to connect/i, 'Client de téléchargement injoignable'],
  [/automatic import is not possible|manual import/i, 'Import manuel requis'],
  [/not an upgrade/i, 'Pas une amélioration de la version déjà présente'],
  [/no files found are eligible for import/i, 'Aucun fichier importable dans ce téléchargement'],
  [/episodes? expected in this release (?:were|was) not imported|missing from the release/i, 'Des épisodes attendus manquent dans cette version'],
  [/unable to determine if file is a sample|\bsample\b/i, 'Extrait (sample) ignoré'],
  [/unpack/i, 'Échec de la décompression de l’archive'],
  [/password protected|encrypted/i, 'Archive protégée par un mot de passe'],
  [/already imported/i, 'Déjà importé'],
  [/invalid season or episode/i, 'Saison ou épisode non reconnu'],
  [/unable to parse|could not parse|unknown series|unknown movie|matched to (?:series|movie) by id/i, 'Version non reconnue par Sonarr ou Radarr'],
  [/download (?:has )?failed|failed to download/i, 'Le téléchargement a échoué'],
];
const ENGLISH = /\b(?:the|is|was|were|with|not|no|found|unable|could|file|files|download|release|error|failed|warning|series|movie|episode|connections?)\b/i;

/** Message *Arr ou client présentable en français. */
export function frenchArrMessage(message: string | undefined | null): string {
  const text = String(message || '').trim();
  if (!text) return '';
  const known = KNOWN.find(([pattern]) => pattern.test(text));
  if (known) return known[1];
  return ENGLISH.test(text) && !/[àâçéèêëîïôûùüÿœ’]/i.test(text) ? 'Le client de téléchargement signale un problème' : text;
}

/** Plusieurs messages traduits, sans doublon (« • » entre eux). */
export function frenchArrMessages(messages: readonly string[]): string {
  return [...new Set(messages.map(frenchArrMessage).filter(Boolean))].join(' • ');
}

/**
 * Un transfert bloqué faute de source connectée est une attente, pas une panne : il repart souvent seul (retour
 * terrain du 08/11 : « surtout que le dl a fini par se lancer seul »). Il reste dans « En cours ».
 */
export const isStalledWithoutSources = (messages: readonly string[]) => messages.length > 0 && messages.every(message => /stalled with no connections/i.test(message));
