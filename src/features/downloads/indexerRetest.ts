import { cleanUrl, executeGet } from '../../services/sonarrRadarr';
import { executeArrInteractivePost } from '../../services/sonarrRadarrTransport';
import { indexerHealthProblem } from './downloadNoRelease';

/**
 * Retour du propriétaire du 15/11 (v1.4.318, « pour les erreurs d'indexers, impossible de fix depuis SeenIt ? ») :
 * SeenIt demande à Sonarr/Radarr de retester tous leurs indexers (un test réussi lève la pause), puis relit leur
 * état pour nommer ceux qui restent en échec. Réparer un indexer cassé (site, identifiants) reste dans Prowlarr ou
 * dans Sonarr/Radarr : SeenIt ne modifie aucun réglage d'indexer.
 */
/** problem : alerte d'indexers de Sonarr/Radarr, traduite, quand l'état détaillé n'est pas disponible. */
export interface IndexerRetestResult { service: 'Sonarr' | 'Radarr'; total: number; failing: string[]; problem?: string }
type RetestConfig = { sonarrUrl?: string; sonarrApiKey?: string; radarrUrl?: string; radarrApiKey?: string };
export interface RetestIo { get: (url: string, headers: Record<string, string>) => Promise<unknown>; post: (url: string, body: unknown, headers: Record<string, string>) => Promise<unknown> }
// Tester tous les indexers peut être long : même transport que la recherche des versions (jusqu'à 90 s).
const defaultIo: RetestIo = { get: executeGet, post: executeArrInteractivePost };

const invalidProblem = (service: string) => `Au moins un indexer a échoué au test. Vérifie-les dans Prowlarr ou dans ${service}, puis relance la recherche.`;
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
export async function retestIndexers(config: RetestConfig, mediaType: 'tv' | 'movie', io: RetestIo = defaultIo, now = Date.now(), { wait = sleep, healthDelayMs = 3000 }: { wait?: (ms: number) => Promise<void>; healthDelayMs?: number } = {}): Promise<IndexerRetestResult> {
  const service = mediaType === 'tv' ? 'Sonarr' : 'Radarr';
  const url = mediaType === 'tv' ? config.sonarrUrl : config.radarrUrl;
  const apiKey = mediaType === 'tv' ? config.sonarrApiKey : config.radarrApiKey;
  if (!url?.trim() || !apiKey?.trim()) throw new Error(`${service} n’est pas configuré.`);
  const base = cleanUrl(url);
  const headers = { 'X-Api-Key': apiKey, Accept: 'application/json' };
  // Revue Codex #1059 : un test terminé avec des indexers invalides répond 400 (résultat de validation) ; tout autre
  // refus (proxy, délai, droits) veut dire que le test n'a pas eu lieu — jamais présenté comme une réactivation.
  // Revue Codex #1060 : un 400 veut dire qu'au moins un indexer a échoué au test ; ce n'est jamais une réactivation.
  let invalid = false;
  try {
    await io.post(`${base}/api/v3/indexer/testall`, {}, headers);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '';
    invalid = /\b400\b/.test(message);
    if (!invalid) throw new Error(`Le test des indexers n’a pas pu être lancé${message ? ` (${message})` : ''}. Réessaie dans un instant ou vérifie ${service}.`);
  }
  const [indexers, statuses] = await Promise.all([io.get(`${base}/api/v3/indexer`, headers), io.get(`${base}/api/v3/indexerstatus`, headers).catch(() => null)]);
  if (!Array.isArray(indexers)) throw new Error(`${service} n’a pas rendu la liste de ses indexers.`);
  const names = new Map((indexers as Array<{ id?: number; name?: string }>).map(indexer => [Number(indexer.id), String(indexer.name || `Indexer ${indexer.id}`)]));
  if (Array.isArray(statuses)) {
    const failing = (statuses as Array<{ indexerId?: number; providerId?: number; disabledTill?: string }>)
      .filter(status => status.disabledTill && Date.parse(status.disabledTill) > now)
      .map(status => names.get(Number(status.indexerId ?? status.providerId)) || `Indexer ${status.indexerId ?? status.providerId}`);
    return { service, total: names.size, failing: [...new Set(failing)], ...(invalid && !failing.length ? { problem: invalidProblem(service) } : {}) };
  }
  // Retour du 15/11 (v1.4.319, « Erreur HTTP 404 ») : ce Sonarr n'expose pas `indexerstatus`. SeenIt lui demande de
  // revérifier sa santé (commande CheckHealth), puis lit ses alertes d'indexers, traduites.
  // Revue Codex #1060 : sans revérification réussie, les alertes lues pourraient être anciennes : rien n'est conclu.
  const rechecked = await io.post(`${base}/api/v3/command`, { name: 'CheckHealth' }, headers).then(() => true, () => false);
  if (!rechecked) throw new Error(`${service} n’a pas pu revérifier ses indexers. Réessaie dans un instant.`);
  await wait(healthDelayMs);
  const health = await io.get(`${base}/api/v3/health`, headers);
  if (!Array.isArray(health)) throw new Error(`${service} n’a pas rendu l’état de ses indexers.`);
  const problem = indexerHealthProblem(health) || (invalid ? invalidProblem(service) : null);
  return { service, total: names.size, failing: [], ...(problem ? { problem } : {}) };
}

export function describeIndexerRetest(result: IndexerRetestResult): { text: string; ok: boolean } {
  if (!result.total) return { text: `${result.service} n’a aucun indexer : ajoute-en dans Prowlarr ou dans ${result.service}.`, ok: false };
  if (result.problem) return { text: result.problem, ok: false };
  if (!result.failing.length) return { text: 'Indexers réactivés : relance la recherche.', ok: true };
  return { text: `Toujours en échec : ${result.failing.join(', ')}. À vérifier dans Prowlarr ou dans ${result.service}.`, ok: false };
}
