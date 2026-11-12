export interface PlexAccountHistoryNode {
  id?: string | null;
  /** #954 : date du visionnage dans le Watch History du compte (ISO ou secondes), si Plex la fournit. */
  date?: string | number | null;
  metadataItem?: PlexAccountMetadataItem | null;
}

interface PlexAccountMetadataRef { id?: unknown; guid?: string | null; key?: string | null; type?: string | null; title?: string | null; index?: number | null }
interface PlexAccountMetadataItem extends PlexAccountMetadataRef { parent?: PlexAccountMetadataRef | null; grandparent?: PlexAccountMetadataRef | null }

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

export function normalizePlexAccountHistoryNode(node: PlexAccountHistoryNode): Record<string, unknown> & { guid?: string | null; viewedAt?: number } | null {
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

/**
 * #954 : l'historique `/status/sessions/history/all` d'un serveur dont on est titulaire contient les lectures de
 * tous ses utilisateurs. Seul le compte local 1 (le titulaire) est le sien ; sans `accountID`, l'entrée est gardée.
 * Sur un serveur partagé, Plex ne renvoie que l'historique du jeton utilisé.
 */
export function isOwnerPmsHistoryEntry(item: { accountID?: unknown } | null | undefined, owned: boolean): boolean {
  if (!owned) return true;
  const raw = item?.accountID;
  if (raw === undefined || raw === null || raw === '') return true;
  return Number(raw) === 1;
}

/**
 * #954 : fil « Activité » du compte Plex (celui de « Vous avez regardé … » sur le site Plex). Chaque visionnage y porte
 * sa date ; le rapprochement avec le Watch History se fait par GUID global exact.
 */
export const PLEX_ACTIVITY_FEED_QUERY = `
query GetActivityFeed($first: PaginationInt!, $after: String) {
  activityFeed(first: $first, after: $after, types: [WATCH_HISTORY]) {
    nodes {
      __typename
      ... on ActivityWatchHistory {
        id
        date
        metadataItem { id guid type }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}`;

export function readPlexActivityDates(payload: unknown): Array<{ guid: string; viewedAt: number }> {
  const nodes = (payload as { data?: { activityFeed?: { nodes?: unknown } } } | null)?.data?.activityFeed?.nodes;
  if (!Array.isArray(nodes)) return [];
  const out: Array<{ guid: string; viewedAt: number }> = [];
  for (const node of nodes) {
    const value = node as { date?: unknown; metadataItem?: { guid?: unknown } | null } | null;
    const guid = typeof value?.metadataItem?.guid === 'string' ? value.metadataItem.guid.trim() : '';
    const viewedAt = readPlexAccountHistoryDate(value?.date);
    if (guid && viewedAt !== null) out.push({ guid, viewedAt });
  }
  return out;
}

/**
 * SEENIT-PLEX-005 (#954, retour v1.4.300) : en synchro complète, un événement du Watch History du compte dont le GUID
 * est VU dans une bibliothèque actuelle fait double emploi (la bibliothèque porte sa date `lastViewedAt`) : il est retiré.
 * Présent mais non vu dans une bibliothèque — typiquement le serveur d'un ami, l'état de lecture n'étant pas synchronisé
 * entre serveurs —, l'événement reste la seule date de la lecture faite ailleurs : il est gardé en `datingOnly`, pour
 * dater un Vu déjà connu sans jamais en créer un que l'état non vu de cette bibliothèque retirerait.
 */
export function reconcileAccountHistoryWithLibraries<T extends { sourceKind?: string; raw?: { guid?: unknown } | null; datingOnly?: boolean }>(entries: readonly T[], libraryGuids: ReadonlySet<string>): { entries: T[]; removed: number; datingOnly: number } {
  const guidOf = (entry: T) => typeof entry?.raw?.guid === 'string' ? entry.raw.guid : '';
  const watched = new Set(entries.filter(entry => entry?.sourceKind === 'library-watched').map(guidOf).filter(Boolean));
  let removed = 0, datingOnly = 0;
  const out: T[] = [];
  for (const entry of entries) {
    const guid = entry?.sourceKind === 'account-history' ? guidOf(entry) : '';
    if (!guid || !libraryGuids.has(guid)) out.push(entry);
    else if (watched.has(guid)) removed++;
    else { datingOnly++; out.push({ ...entry, datingOnly: true }); }
  }
  return { entries: out, removed, datingOnly };
}
