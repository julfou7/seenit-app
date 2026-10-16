export type DownloadFailureCode = 'no_release';
import type { DownloadAvailability } from './downloadAvailability.ts';

export interface ArrSearchOutcome {
  success: boolean;
  message: string;
  failureCode?: DownloadFailureCode;
  availability?: DownloadAvailability;
}

export interface ArrRelease {
  approved?: boolean;
  title?: string;
  quality?: { quality?: { name?: string; resolution?: number }; name?: string; resolution?: number };
  rejections?: unknown[];
  [key: string]: unknown;
}

export function requireArrReleaseArray(value: unknown): ArrRelease[] {
  if (!Array.isArray(value) || value.some(item => !item || typeof item !== 'object' || Array.isArray(item) || typeof item.approved !== 'boolean')) {
    throw new Error('Le service a renvoyé un résultat de recherche invalide.');
  }
  return value as ArrRelease[];
}

export function isCompatibleArrRelease(release: ArrRelease, preference?: '1080p' | '4k'): boolean {
  if (release.approved !== true) return false;
  if (!preference) return true;
  const quality = release.quality?.quality || release.quality;
  const text = `${quality?.name || ''} ${quality?.resolution || ''} ${release.title || ''}`;
  return preference === '4k' ? /2160|4k|uhd/i.test(text) : /1080/i.test(text) && !/2160|4k|uhd/i.test(text);
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** Un tableau vide peut aussi venir d'indexers désactivés ou en panne. */
export async function confirmNoArrRelease(read: (path: string) => Promise<unknown>): Promise<ArrSearchOutcome> {
  try {
    const [health, indexers] = await Promise.all([read('health'), read('indexer')]);
    if (!Array.isArray(health) || !Array.isArray(indexers)) throw new Error('Diagnostic du service indisponible.');
    if (health.length > 0) throw new Error('Le service signale un problème ; la recherche ne peut pas être confirmée.');
    const automatic = indexers.map(record).filter(item => item?.enableAutomaticSearch === true);
    if (!automatic.length || automatic.some(item => item?.enableInteractiveSearch !== true)) {
      throw new Error('Les indexers de recherche ne permettent pas de confirmer le résultat.');
    }
    return { success: false, failureCode: 'no_release', message: 'Aucune release compatible trouvée pour cette demande.' };
  } catch (error: unknown) {
    return { success: false, message: error instanceof Error ? error.message : 'Recherche indisponible.' };
  }
}

/** Ne lance jamais une commande concurrente avant la conclusion des recherches observables. */
export async function executeProvenArrSearch(options: {
  queries: string[];
  read: (path: string) => Promise<unknown>;
  launch: () => Promise<unknown>;
  preference?: '1080p' | '4k';
}): Promise<ArrSearchOutcome> {
  try {
    if (!options.queries.length) return { success: false, message: 'Aucun épisode diffusé à rechercher dans ce scope.' };
    for (const query of options.queries) {
      const releases = requireArrReleaseArray(await options.read(query));
      if (releases.some(release => isCompatibleArrRelease(release, options.preference))) {
        await options.launch();
        return { success: true, message: 'Release compatible trouvée • recherche lancée.' };
      }
    }
    return await confirmNoArrRelease(options.read);
  } catch (error: unknown) {
    return { success: false, message: `Recherche impossible : ${error instanceof Error ? error.message : 'service indisponible'}` };
  }
}

export function sonarrSeriesSearchQueries(seriesId: number, episodes: unknown, now = Date.now()): string[] {
  if (!Array.isArray(episodes)) throw new Error('Liste des épisodes Sonarr invalide.');
  const seasons = new Set<number>();
  for (const value of episodes) {
    const episode = record(value);
    const season = Number(episode?.seasonNumber);
    const airedAt = typeof episode?.airDateUtc === 'string' ? Date.parse(episode.airDateUtc) : NaN;
    if (Number.isInteger(season) && season > 0 && airedAt <= now && episode?.monitored !== false && !episode?.hasFile) {
      seasons.add(season);
    }
  }
  return [...seasons].sort((a, b) => a - b).map(season => `release?seriesId=${seriesId}&seasonNumber=${season}`);
}
