import type { LiveDownloadItem } from '../../services/sonarrRadarrLive';

export type DownloadEntry =
  | { kind: 'single'; item: LiveDownloadItem }
  | { kind: 'season'; key: string; tmdbId?: number; tvdbId?: number; seasonNumber: number; items: LiveDownloadItem[] };

/**
 * Identité de regroupement : TMDB exact, sinon TVDB exact (`SEENIT-DOWNLOAD-*`, AGENTS §5.1).
 * Le titre ou le nom de release ne regroupent jamais deux transferts.
 */
function seasonKey(item: LiveDownloadItem): string | null {
  if (item.mediaType !== 'tv' || !Number.isInteger(item.seasonNumber) || !Number.isInteger(item.episodeNumber)) return null;
  if (Number(item.tmdbId) > 0) return `tmdb:${Number(item.tmdbId)}:s${item.seasonNumber}`;
  if (Number(item.tvdbId) > 0) return `tvdb:${Number(item.tvdbId)}:s${item.seasonNumber}`;
  return null;
}

/**
 * #879 — Onglet Télécharger : les épisodes d'une même saison d'une même série forment une seule carte
 * (maquette DlOngletSuivi), à la place de la première occurrence ; une saison isolée garde sa carte.
 * L'ordre de la section est conservé ; les épisodes sont rangés par numéro.
 */
export function groupSeasonDownloads(items: readonly LiveDownloadItem[]): DownloadEntry[] {
  const groups = new Map<string, LiveDownloadItem[]>();
  for (const item of items) {
    const key = seasonKey(item);
    if (key) groups.set(key, [...(groups.get(key) || []), item]);
  }
  const emitted = new Set<string>();
  const entries: DownloadEntry[] = [];
  for (const item of items) {
    const key = seasonKey(item);
    const members = key ? groups.get(key) || [] : [];
    if (!key || members.length < 2) { entries.push({ kind: 'single', item }); continue; }
    if (emitted.has(key)) continue;
    emitted.add(key);
    const first = members[0];
    entries.push({
      kind: 'season', key,
      tmdbId: Number(first.tmdbId) > 0 ? Number(first.tmdbId) : undefined,
      tvdbId: Number(first.tvdbId) > 0 ? Number(first.tvdbId) : undefined,
      seasonNumber: Number(first.seasonNumber),
      items: [...members].sort((a, b) => Number(a.episodeNumber) - Number(b.episodeNumber))
    });
  }
  return entries;
}
