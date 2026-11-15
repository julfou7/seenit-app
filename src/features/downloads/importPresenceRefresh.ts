import type { RecentImport } from './recentImports';

/**
 * Retour terrain du 15/11 (v1.4.320, Dexter S02) : E01 et E03 avaient leur fichier dans Sonarr, mais la fiche les
 * montrait encore à télécharger et la carte de saison proposait « Ajouter E1 » — la présence restait en cache après
 * l'import. Un import nouveau ou modifié (autres épisodes, nouvelle date) désigne les titres dont la présence doit
 * être relue.
 * Revues Codex #1063 : la référence est tenue par source (Sonarr pour les séries, Radarr pour les films) et n'avance
 * que pour une source lue avec succès — une panne de l'une ne fait ni passer toute sa bibliothèque pour « nouvelle »,
 * ni perdre un import de l'autre. Sans référence pour une source (premier lancement), rien n'est relu en masse. Au
 * plus `MAX_PRESENCE_REFRESH` titres par synchronisation ; les suivants restent « non vus » et seront relus ensuite.
 */
export const MAX_PRESENCE_REFRESH = 5;
type ImportsCopy = { items: readonly RecentImport[]; failures: readonly string[] };
type Source = 'tv' | 'movie';
export type ImportsReference = Partial<Record<Source, ReadonlyMap<string, string>>>;
const signature = (item: RecentImport) => item.kind === 'series'
  ? item.episodes.map(entry => `${entry.season}x${entry.episode}`).sort().join(',')
  : String(item.date);
const sourceOf = (item: RecentImport): Source => item.kind === 'series' ? 'tv' : 'movie';
const failed = (copy: ImportsCopy, source: Source) => copy.failures.some(failure => (source === 'tv' ? /sonarr/i : /radarr/i).test(failure));

/** Référence initiale tirée d'une copie gardée : seulement les sources lues avec succès. */
export function importsReferenceFrom(copy: ImportsCopy | null | undefined): ImportsReference {
  const reference: ImportsReference = {};
  if (!copy) return reference;
  for (const source of ['tv', 'movie'] as const) {
    if (!failed(copy, source)) reference[source] = new Map(copy.items.filter(item => sourceOf(item) === source).map(item => [item.key, signature(item)]));
  }
  return reference;
}

export function importsNeedingPresence(reference: ImportsReference, next: ImportsCopy): { targets: Array<{ tmdbId: number; mediaType: Source }>; reference: ImportsReference } {
  const targets = new Map<string, { tmdbId: number; mediaType: Source }>();
  const updated: ImportsReference = { ...reference };
  for (const source of ['tv', 'movie'] as const) {
    if (failed(next, source)) continue;
    const before = reference[source];
    const after = new Map<string, string>();
    for (const item of next.items.filter(entry => sourceOf(entry) === source)) {
      const current = signature(item);
      const changed = before !== undefined && before.get(item.key) !== current && Number(item.tmdbId) > 0;
      if (changed && targets.size >= MAX_PRESENCE_REFRESH) {
        // Au-delà de la limite : gardé « non vu » pour la prochaine synchronisation.
        const previous = before.get(item.key);
        if (previous !== undefined) after.set(item.key, previous);
        continue;
      }
      if (changed) targets.set(`${source}:${item.tmdbId}`, { tmdbId: Number(item.tmdbId), mediaType: source });
      after.set(item.key, current);
    }
    updated[source] = after;
  }
  return { targets: [...targets.values()], reference: updated };
}
