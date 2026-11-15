import type { RecentImport } from './recentImports';

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * Retour terrain du 15/11 (v1.4.320) : « l'historique, pour les films ok, mais pour les séries on ne sait pas ce qui a
 * été téléchargé ». Épisodes exacts récupérés, par saison, sans trou masqué : « S02 · E01, E03 », « S01 · E09–E10 ».
 */
export function importedEpisodesLabel(item: RecentImport): string | null {
  if (item.kind !== 'series' || !item.episodes.length) return null;
  const seasons = new Map<number, number[]>();
  for (const entry of item.episodes) seasons.set(entry.season, [...(seasons.get(entry.season) || []), entry.episode]);
  return [...seasons.entries()].sort((a, b) => a[0] - b[0]).map(([season, list]) => {
    const sorted = [...new Set(list)].sort((a, b) => a - b);
    const runs: string[] = [];
    for (let index = 0; index < sorted.length; index++) {
      let end = index;
      while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) end++;
      runs.push(end === index ? `E${pad(sorted[index])}` : `E${pad(sorted[index])}–E${pad(sorted[end])}`);
      index = end;
    }
    return `S${pad(season)} · ${runs.join(', ')}`;
  }).join(' · ');
}
