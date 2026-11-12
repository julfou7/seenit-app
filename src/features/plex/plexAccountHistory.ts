export interface PlexAccountHistoryNode {
  id?: string | null;
  /** #954 : date du visionnage dans le Watch History du compte (ISO ou secondes), si Plex la fournit. */
  date?: string | number | null;
  metadataItem?: any;
}

/** #954 : millisecondes du visionnage d'un nœud Watch History, ou null si Plex n'en fournit pas. */
export function readPlexAccountHistoryDate(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value < 10_000_000_000 ? value * 1000 : value;
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export const PLEX_ACCOUNT_HISTORY_QUERY = `
query GetWatchHistoryHub($uuid: ID = "", $first: PaginationInt!, $after: String) {
  user(id: $uuid) {
    watchHistory(first: $first, after: $after) {
      nodes {
        id
        metadataItem {
          id
          guid
          key
          type
          title
          index
          parent {
            id
            guid
            key
            type
            title
            index
          }
          grandparent {
            id
            guid
            key
            type
            title
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}`;

// #954 : même requête avec la date de chaque visionnage ; repli sur la requête riche si le schéma la refuse.
export const PLEX_ACCOUNT_HISTORY_DATED_QUERY = `
query GetWatchHistoryHub($uuid: ID = "", $first: PaginationInt!, $after: String) {
  user(id: $uuid) {
    watchHistory(first: $first, after: $after) {
      nodes {
        id
        date
        metadataItem {
          id
          guid
          key
          type
          title
          index
          parent {
            id
            guid
            key
            type
            title
            index
          }
          grandparent {
            id
            guid
            key
            type
            title
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}`;

// Fallback volontairement minimal si Plex fait évoluer son schéma GraphQL.
// Les GUID globaux restent suffisants pour résoudre films et séries sans titre.
export const PLEX_ACCOUNT_HISTORY_MINIMAL_QUERY = `
query GetWatchHistoryHub($uuid: ID = "", $first: PaginationInt!, $after: String) {
  user(id: $uuid) {
    watchHistory(first: $first, after: $after) {
      nodes {
        id
        metadataItem {
          id
          guid
          key
          type
          title
          parent {
            id
            guid
            key
            type
            title
          }
          grandparent {
            id
            guid
            key
            type
            title
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}`;

export function normalizePlexAccountHistoryNode(node: PlexAccountHistoryNode): any | null {
  const metadata = node?.metadataItem;
  if (!metadata || typeof metadata !== 'object') return null;

  const type = String(metadata.type || '').toLowerCase();
  if (!['movie', 'episode', 'show', 'season'].includes(type)) return null;

  const parent = metadata.parent && typeof metadata.parent === 'object' ? metadata.parent : null;
  const grandparent = metadata.grandparent && typeof metadata.grandparent === 'object'
    ? metadata.grandparent
    : null;
  const historyId = node?.id ? String(node.id) : null;

  return {
    type,
    title: metadata.title || '',
    guid: metadata.guid || null,
    key: metadata.key || null,
    // metadataItem.id est un ID GraphQL du compte Plex : ne jamais le confondre
    // avec un ratingKey LOCAL d'un Plex Media Server.
    accountMetadataId: metadata.id ? String(metadata.id) : null,
    index: metadata.index !== undefined && metadata.index !== null ? Number(metadata.index) : undefined,
    parentIndex: parent?.index !== undefined && parent?.index !== null ? Number(parent.index) : undefined,
    parentTitle: parent?.title || null,
    parentGuid: parent?.guid || null,
    parentKey: parent?.key || null,
    parentAccountMetadataId: parent?.id ? String(parent.id) : null,
    grandparentTitle: grandparent?.title || null,
    grandparentGuid: grandparent?.guid || null,
    grandparentKey: grandparent?.key || null,
    grandparentAccountMetadataId: grandparent?.id ? String(grandparent.id) : null,
    historyKey: historyId ? `community:${historyId}` : null,
    accountHistoryId: historyId,
    ...(readPlexAccountHistoryDate(node?.date) !== null ? { viewedAt: readPlexAccountHistoryDate(node?.date) } : {})
  };
}

export function isPlexLibraryItemWatched(item: { viewCount?: unknown; view_count?: unknown; [key: string]: unknown } | null | undefined): boolean {
  const viewCount = Number(item?.viewCount ?? item?.view_count ?? 0);
  return Number.isFinite(viewCount) && viewCount > 0;
}
