import type { RecentImport } from './recentImports';

/**
 * Retour terrain du 15/11 (v1.4.320, Dexter S02) : E01 et E03 avaient leur fichier dans Sonarr, mais la fiche les
 * montrait encore à télécharger et la carte de saison proposait « Ajouter E1 » — la présence restait en cache après
 * l'import. Un import nouveau ou modifié (autres épisodes, nouvelle date) depuis la copie précédente désigne les
 * titres dont la présence doit être relue. Sans copie précédente (premier lancement), rien n'est relu en masse.
 */
const signature = (item: RecentImport) => item.kind === 'series'
  ? item.episodes.map(entry => `${entry.season}x${entry.episode}`).sort().join(',')
  : String(item.date);

export function importsNeedingPresence(previous: readonly RecentImport[] | null | undefined, next: readonly RecentImport[]): Array<{ tmdbId: number; mediaType: 'tv' | 'movie' }> {
  if (!previous) return [];
  const before = new Map(previous.map(item => [item.key, signature(item)]));
  const targets = new Map<string, { tmdbId: number; mediaType: 'tv' | 'movie' }>();
  for (const item of next) {
    if (!(Number(item.tmdbId) > 0) || before.get(item.key) === signature(item)) continue;
    const mediaType = item.kind === 'series' ? 'tv' : 'movie';
    targets.set(`${mediaType}:${item.tmdbId}`, { tmdbId: Number(item.tmdbId), mediaType });
  }
  return [...targets.values()];
}
