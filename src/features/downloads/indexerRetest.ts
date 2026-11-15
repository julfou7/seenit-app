import { cleanUrl, executeGet } from '../../services/sonarrRadarr';
import { executePost } from '../../services/sonarrRadarrTransport';

/**
 * Retour du propriétaire du 15/11 (v1.4.318, « pour les erreurs d'indexers, impossible de fix depuis SeenIt ? ») :
 * SeenIt demande à Sonarr/Radarr de retester tous leurs indexers (un test réussi lève la pause), puis relit leur
 * état pour nommer ceux qui restent en échec. Réparer un indexer cassé (site, identifiants) reste dans Prowlarr ou
 * dans Sonarr/Radarr : SeenIt ne modifie aucun réglage d'indexer.
 */
export interface IndexerRetestResult { service: 'Sonarr' | 'Radarr'; total: number; failing: string[] }
type RetestConfig = { sonarrUrl?: string; sonarrApiKey?: string; radarrUrl?: string; radarrApiKey?: string };
export interface RetestIo { get: (url: string, headers: Record<string, string>) => Promise<unknown>; post: (url: string, body: unknown, headers: Record<string, string>) => Promise<unknown> }
const defaultIo: RetestIo = { get: executeGet, post: executePost };

export async function retestIndexers(config: RetestConfig, mediaType: 'tv' | 'movie', io: RetestIo = defaultIo, now = Date.now()): Promise<IndexerRetestResult> {
  const service = mediaType === 'tv' ? 'Sonarr' : 'Radarr';
  const url = mediaType === 'tv' ? config.sonarrUrl : config.radarrUrl;
  const apiKey = mediaType === 'tv' ? config.sonarrApiKey : config.radarrApiKey;
  if (!url?.trim() || !apiKey?.trim()) throw new Error(`${service} n’est pas configuré.`);
  const base = cleanUrl(url);
  const headers = { 'X-Api-Key': apiKey, Accept: 'application/json' };
  // Un test en échec répond une erreur : seul l'état relu ensuite fait foi.
  await io.post(`${base}/api/v3/indexer/testall`, {}, headers).catch(() => undefined);
  const [indexers, statuses] = await Promise.all([io.get(`${base}/api/v3/indexer`, headers), io.get(`${base}/api/v3/indexerstatus`, headers)]);
  if (!Array.isArray(indexers) || !Array.isArray(statuses)) throw new Error(`${service} n’a pas rendu l’état de ses indexers.`);
  const names = new Map((indexers as Array<{ id?: number; name?: string }>).map(indexer => [Number(indexer.id), String(indexer.name || `Indexer ${indexer.id}`)]));
  const failing = (statuses as Array<{ indexerId?: number; providerId?: number; disabledTill?: string }>)
    .filter(status => status.disabledTill && Date.parse(status.disabledTill) > now)
    .map(status => names.get(Number(status.indexerId ?? status.providerId)) || `Indexer ${status.indexerId ?? status.providerId}`);
  return { service, total: names.size, failing: [...new Set(failing)] };
}

export function describeIndexerRetest(result: IndexerRetestResult): { text: string; ok: boolean } {
  if (!result.total) return { text: `${result.service} n’a aucun indexer : ajoute-en dans Prowlarr ou dans ${result.service}.`, ok: false };
  if (!result.failing.length) return { text: 'Indexers réactivés : relance la recherche.', ok: true };
  return { text: `Toujours en échec : ${result.failing.join(', ')}. À vérifier dans Prowlarr ou dans ${result.service}.`, ok: false };
}
