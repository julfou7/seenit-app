export type PlexDeltaWatchedMediaType = 'movie' | 'episode';

export interface PlexLibrarySectionLike {
  key?: string | number | null;
  type?: string | null;
  title?: string | null;
}

export interface PlexDeltaWatchedSectionQuery {
  endpoint: string;
  mediaType: PlexDeltaWatchedMediaType;
  sourceName: string;
}

/**
 * Construit les lectures légères utilisées par la delta : uniquement les éléments
 * actuellement vus. La delta ne parcourt donc pas l'inventaire complet et ne
 * collecte aucun `watched=false` destructif.
 */
export function buildPlexDeltaWatchedSectionQueries(
  baseUri: string,
  serverName: string,
  sections: PlexLibrarySectionLike[]
): PlexDeltaWatchedSectionQuery[] {
  const cleanBaseUri = String(baseUri || '').replace(/\/+$/, '');
  if (!cleanBaseUri) return [];

  const queries: PlexDeltaWatchedSectionQuery[] = [];
  for (const section of sections || []) {
    const sectionKey = section?.key == null ? '' : String(section.key).trim();
    const sectionType = String(section?.type || '').toLowerCase();
    if (!sectionKey || !['movie', 'show'].includes(sectionType)) continue;

    const path = sectionType === 'movie' ? 'all' : 'allLeaves';
    const mediaType: PlexDeltaWatchedMediaType = sectionType === 'movie' ? 'movie' : 'episode';
    const url = new URL(`${cleanBaseUri}/library/sections/${encodeURIComponent(sectionKey)}/${path}`);
    url.searchParams.set('unwatched', '0');
    url.searchParams.set('sort', 'lastViewedAt:desc');
    url.searchParams.set('includeGuids', '1');

    queries.push({
      endpoint: url.toString(),
      mediaType,
      sourceName: `${serverName} - ${section?.title || 'Section'}`
    });
  }

  return queries;
}

/**
 * Un snapshot `library-watched` est un état courant, pas un événement historique :
 * il doit être transmis même si `lastViewedAt` est plus ancien que le curseur delta.
 */
export function shouldIncludePlexItemForDelta(
  sourceKind: unknown,
  viewedTimestamp: number,
  since?: number
): boolean {
  if (sourceKind === 'library-watched') return true;
  if (!Number.isFinite(Number(since))) return true;
  return viewedTimestamp > Number(since);
}
