export interface PlexAccountHistoryNode {
  id?: string | null;
  metadataItem?: any;
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

// Fallback volontairement minimal si Plex fait évoluer son schéma GraphQL.
// Les champs d'identité restent suffisants pour résoudre films/séries par GUID.
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
    ratingKey: metadata.id || null,
    index: metadata.index !== undefined && metadata.index !== null ? Number(metadata.index) : undefined,
    parentIndex: parent?.index !== undefined && parent?.index !== null ? Number(parent.index) : undefined,
    parentTitle: parent?.title || null,
    parentGuid: parent?.guid || null,
    parentKey: parent?.key || null,
    parentRatingKey: parent?.id || null,
    grandparentTitle: grandparent?.title || null,
    grandparentGuid: grandparent?.guid || null,
    grandparentKey: grandparent?.key || null,
    grandparentRatingKey: grandparent?.id || null,
    historyKey: historyId ? `community:${historyId}` : null,
    accountHistoryId: historyId
  };
}

export function isPlexLibraryItemWatched(item: any): boolean {
  const viewCount = Number(item?.viewCount ?? item?.view_count ?? 0);
  return Number.isFinite(viewCount) && viewCount > 0;
}
