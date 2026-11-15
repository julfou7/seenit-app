export type DownloadFailureCode = 'no_release';
import type { DownloadAvailability } from './downloadAvailability.ts';
import { selectArrSeasonReleases } from './seasonReleaseSelection.ts';

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

/**
 * Retour terrain du 08/11 (« Le Chat Chapeauté », v1.4.275) : n'importe quel avertissement de santé (mise à
 * jour disponible, dossier, client de téléchargement…) rendait une recherche vide non concluante, et un
 * film pas encore sorti finissait en « Une intervention est nécessaire » au lieu d'être surveillé. Seule une
 * alerte d'indexer peut fausser une absence de release ; elle est alors nommée telle que le service la donne.
 */
export function indexerHealthProblem(health: readonly unknown[]): string | null {
  const blocking = health.map(record).filter((item): item is Record<string, unknown> => item !== null
    && (/indexer/i.test(String(item.source ?? '')) || (!item.source && item.type === 'error')));
  if (!blocking.length) return null;
  const detail = blocking.map(item => String(item.message ?? '').trim()).find(Boolean);
  return detail ? indexerHealthMessage(detail) : 'Les indexers signalent un problème ; la recherche ne peut pas être confirmée.';
}

/**
 * Retour terrain du 15/11 (v1.4.317, Dexter S02E03) : le message de santé de Sonarr/Radarr s'affichait en anglais
 * (« All search-capable indexers are temporarily unavailable… »). Les alertes d'indexer connues sont traduites avec
 * ce qu'il faut faire ; une alerte inconnue reste citée telle quelle, jamais réinterprétée.
 */
export function indexerHealthMessage(detail: string): string {
  if (/all indexers are unavailable due to failures/i.test(detail)) return 'Tous les indexers sont en échec : Sonarr/Radarr ne peuvent trouver aucune version. Vérifie-les dans Prowlarr ou dans Sonarr/Radarr (Indexers), puis relance la recherche.';
  if (/all (?:search|rss)-capable indexers are temporarily unavailable/i.test(detail)) return 'Tous les indexers sont en pause après des erreurs récentes. Vérifie-les dans Prowlarr ou dans Sonarr/Radarr, puis relance la recherche : ils sont aussi réessayés automatiquement.';
  const named = /indexers unavailable due to failures(?: for more than (\d+) hours)?:\s*(.+)$/i.exec(detail);
  if (named) return `Indexers en échec${named[1] ? ` depuis plus de ${named[1]} h` : ''} : ${named[2].trim()}. Vérifie-les dans Prowlarr ou dans Sonarr/Radarr, puis relance la recherche.`;
  if (/no indexers available with (?:automatic|interactive) search enabled/i.test(detail)) return 'Aucun indexer n’a la recherche activée dans Sonarr/Radarr : active-la, puis relance la recherche.';
  return `Indexers en défaut : ${detail}`;
}

/** Un tableau vide peut aussi venir d'indexers désactivés ou en panne. */
export async function confirmNoArrRelease(read: (path: string) => Promise<unknown>): Promise<ArrSearchOutcome> {
  try {
    const [health, indexers] = await Promise.all([read('health'), read('indexer')]);
    if (!Array.isArray(health) || !Array.isArray(indexers)) throw new Error('Diagnostic du service indisponible.');
    const problem = indexerHealthProblem(health);
    if (problem) throw new Error(problem);
    const automatic = indexers.map(record).filter(item => item?.enableAutomaticSearch === true);
    if (!automatic.length || automatic.some(item => item?.enableInteractiveSearch !== true)) {
      throw new Error('Les indexers de recherche ne permettent pas de confirmer le résultat.');
    }
    return { success: false, failureCode: 'no_release', message: 'Aucune release compatible trouvée pour cette demande.' };
  } catch (error: unknown) {
    return { success: false, message: error instanceof Error ? error.message : 'Recherche indisponible.' };
  }
}

const DISK_FULL = /disk is full|not enough free space|no space left|space left on device/i;

/**
 * Retour terrain du 15/11 (« La Guerre des mondes ») : Radarr trouvait des versions mais les refusait toutes
 * faute de place sur le disque ; SeenIt concluait « Aucune release compatible trouvée ». Une version de la
 * qualité demandée refusée seulement pour l'espace disque prouve que le blocage est le disque, pas l'offre.
 */
export function diskFullRejection(releases: readonly ArrRelease[], preference?: '1080p' | '4k'): boolean {
  return releases.some(release => {
    const reasons = Array.isArray(release.rejections) ? release.rejections.map(String) : [];
    // Revue Codex #1043 : seul le disque doit bloquer ; un autre refus (langue, profil) resterait bloquant.
    return release.approved !== true && reasons.length > 0 && reasons.every(reason => DISK_FULL.test(reason))
      && isCompatibleArrRelease({ ...release, approved: true }, preference);
  });
}

export const DISK_FULL_MESSAGE = 'Disque plein : plus assez de place pour ce téléchargement. Libère de l’espace puis relance.';

/** Ne lance jamais une commande concurrente avant la conclusion des recherches observables. */
export async function executeProvenArrSearch(options: {
  queries: string[];
  read: (path: string) => Promise<unknown>;
  launch: (release: ArrRelease) => Promise<unknown>;
  preference?: '1080p' | '4k';
  allScopes?: boolean;
  coverSeason?: boolean;
}): Promise<ArrSearchOutcome> {
  try {
    if (!options.queries.length) return { success: false, message: 'Aucun épisode diffusé à rechercher dans ce scope.' };
    let launched = 0;
    let diskFull = false;
    for (const query of options.queries) {
      const releases = requireArrReleaseArray(await options.read(query));
      diskFull ||= diskFullRejection(releases, options.preference);
      const compatible = releases.filter(release => isCompatibleArrRelease(release, options.preference)).sort((a, b) => {
        const weightA = Number(a.releaseWeight ?? Number.MAX_SAFE_INTEGER), weightB = Number(b.releaseWeight ?? Number.MAX_SAFE_INTEGER);
        if (weightA !== weightB) return weightA - weightB;
        return Number(b.customFormatScore || 0) - Number(a.customFormatScore || 0) || Number(b.seeders || 0) - Number(a.seeders || 0);
      });
      const selected = options.coverSeason ? selectArrSeasonReleases(compatible) : compatible.slice(0, 1);
      if (selected.length) {
        for (const release of selected) {
          await options.launch(release);
          launched++;
        }
        if (!options.allScopes) return { success: true, message: 'Release compatible envoyée au client.' };
      }
    }
    if (launched) return { success: true, message: `${launched} release(s) vérifiée(s) envoyée(s) au client.` };
    // Une panne réelle, jamais « aucune release » : la demande passe dans « À régler » avec sa cause.
    if (diskFull) return { success: false, message: DISK_FULL_MESSAGE };
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
