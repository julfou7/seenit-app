export interface PlexExternalIds {
  tmdbId: number | null;
  imdbId: string | null;
  tvdbId: number | null;
  plexGuid: string | null;
}

export interface ExpectedPlexIdentity {
  tmdbId?: number | string | null;
  imdbId?: string | null;
  tvdbId?: number | string | null;
  mediaType?: 'movie' | 'tv' | 'show';
}

export type PlexMetadataType = 'movie' | 'show' | 'season' | 'episode';

export interface ParsedPlexGuid {
  type: PlexMetadataType;
  id: string;
}

const PLEX_MEDIA_WRAPPER_KEYS = [
  'Metadata',
  'metadata',
  'media',
  'item',
  'metadataItem',
  'object',
  'target',
  'content',
  'video',
  'MediaContainer',
  'mediaContainer'
] as const;

function looksLikePlexMediaObject(value: any): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const type = String(value.type || '').toLowerCase();
  return ['movie', 'show', 'series', 'season', 'episode', 'video'].includes(type) ||
    !!(value.guid || value.Guid || value.guids || value.ratingKey || value.key ||
      value.grandparentGuid || value.parentGuid || value.grandparentRatingKey ||
      value.parentRatingKey || value.grandparentTitle || value.parentIndex);
}

export function parsePlexGuid(raw: unknown): ParsedPlexGuid | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value) return null;

  // Plex Metadata.md : {scheme}://{metadataType}/{ratingKey}
  // ratingKey provider = lettres ASCII, chiffres, tiret et underscore.
  const match = value.match(/^plex:\/\/(movie|show|season|episode)\/([A-Za-z0-9_-]+)$/i);
  if (!match) return null;

  return {
    type: match[1].toLowerCase() as PlexMetadataType,
    id: match[2]
  };
}

export function unwrapPlexMediaItem(rawItem: any): any {
  if (!rawItem) return rawItem;

  const root = rawItem?.raw ? { ...rawItem.raw, ...rawItem } : rawItem;
  if (typeof root !== 'object' || Array.isArray(root)) return root;

  const queue: Array<{ value: any; depth: number }> = [{ value: root, depth: 0 }];
  const visited = new Set<any>();
  const mediaLayers: any[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (!current.value || typeof current.value !== 'object' || visited.has(current.value)) continue;
    visited.add(current.value);

    if (current.value !== root && looksLikePlexMediaObject(current.value)) {
      mediaLayers.push(current.value);
    }
    if (current.depth >= 6) continue;

    for (const key of PLEX_MEDIA_WRAPPER_KEYS) {
      const nested = current.value[key];
      if (Array.isArray(nested)) {
        if (nested.length === 1 && nested[0] && typeof nested[0] === 'object') {
          queue.push({ value: nested[0], depth: current.depth + 1 });
        }
      } else if (nested && typeof nested === 'object') {
        queue.push({ value: nested, depth: current.depth + 1 });
      }
    }
  }

  return Object.assign({}, root, ...mediaLayers);
}

export function getPlexMetadataLookupKey(rawItem: any): string | null {
  const item = unwrapPlexMediaItem(rawItem);
  if (!item) return null;

  for (const rawValue of [
    item.ratingKey,
    item.key,
    item.metadataKey,
    item.metadata_key,
    item.metadataUri,
    item.metadataURI
  ]) {
    if (rawValue === null || rawValue === undefined) continue;
    const value = String(rawValue).trim();
    if (!value) continue;

    if (/^[a-zA-Z0-9_-]+$/.test(value) ||
        /^\/library\/metadata\/[a-zA-Z0-9_-]+(?:[/?#].*)?$/.test(value) ||
        parsePlexGuid(value)) {
      return value;
    }

    try {
      const url = new URL(value);
      if (['metadata.provider.plex.tv', 'discover.provider.plex.tv'].includes(url.hostname) &&
          /^\/library\/metadata\/[a-zA-Z0-9_-]+/.test(url.pathname)) {
        return url.pathname;
      }
    } catch {
      // Ce champ n'est simplement pas une URL absolue.
    }
  }

  return null;
}

export function extractPlexExternalIds(rawItem: any): PlexExternalIds {
  let tmdbId: number | null = null;
  let imdbId: string | null = null;
  let tvdbId: number | null = null;
  let plexGuid: string | null = null;

  const item = unwrapPlexMediaItem(rawItem);
  if (!item) return { tmdbId, imdbId, tvdbId, plexGuid };

  const processGuid = (raw: unknown) => {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) return;

    const tmdbMatch = value.match(/(?:themoviedb|tmdb|com\.plexapp\.agents\.themoviedb):\/\/(\d+)/i);
    if (tmdbMatch && !tmdbId) tmdbId = Number(tmdbMatch[1]);

    const imdbMatch = value.match(/(?:imdb|com\.plexapp\.agents\.imdb):\/\/(tt\d+)/i);
    if (imdbMatch && !imdbId) imdbId = imdbMatch[1].toLowerCase();

    const tvdbMatch = value.match(/(?:tvdb|thetvdb|com\.plexapp\.agents\.thetvdb):\/\/(\d+)/i);
    if (tvdbMatch && !tvdbId) tvdbId = Number(tvdbMatch[1]);

    const parsedPlexGuid = parsePlexGuid(value);
    if (parsedPlexGuid && !plexGuid) plexGuid = parsedPlexGuid.id;
  };

  for (const list of [
    item.Guid,
    item.guids,
    item.grandparentGuids,
    item.parentGuids
  ]) {
    if (!Array.isArray(list)) continue;
    for (const guid of list) {
      processGuid(typeof guid === 'string' ? guid : guid?.id);
    }
  }

  for (const field of [
    item.guid,
    item.grandparentGuid,
    item.parentGuid,
    item.metadataGuid,
    item.metadataKey,
    item.grandparentKey,
    item.parentKey,
    item.ratingKey,
    item.key
  ]) {
    processGuid(field);
  }

  if (!plexGuid && typeof item.sourceIdentity === 'string') {
    const sourcePlexMatch = item.sourceIdentity.trim().match(/^plex:([a-z0-9_-]+)$/i);
    if (sourcePlexMatch) plexGuid = sourcePlexMatch[1];
  }

  return { tmdbId, imdbId, tvdbId, plexGuid };
}

export function isStrictPlexIdentityMatch(
  item: any,
  expected: ExpectedPlexIdentity
): boolean {
  if (!item) return false;

  const itemType = String(item.type || '').toLowerCase();
  const expectedType = expected.mediaType === 'tv' ? 'show' : expected.mediaType;
  if (expectedType === 'movie' && itemType && itemType !== 'movie') return false;
  if (expectedType === 'show' && itemType && !['show', 'series'].includes(itemType)) return false;

  const ids = extractPlexExternalIds(item);
  const expectedTmdb = expected.tmdbId ? Number(expected.tmdbId) : null;
  const expectedImdb = expected.imdbId?.toLowerCase() || null;
  const expectedTvdb = expected.tvdbId ? Number(expected.tvdbId) : null;

  if (expectedTmdb && ids.tmdbId === expectedTmdb) return true;
  if (expectedImdb && ids.imdbId === expectedImdb) return true;
  if (expectedTvdb && ids.tvdbId === expectedTvdb) return true;
  return false;
}

export function buildResolvedPlexIdentity(
  mediaType: 'movie' | 'tv',
  tmdbId: number,
  seasonNumber?: number,
  episodeNumber?: number
): string {
  if (mediaType === 'tv' && seasonNumber !== undefined && episodeNumber !== undefined) {
    return `tv:${tmdbId}:S${seasonNumber}:E${episodeNumber}`;
  }
  return `${mediaType}:${tmdbId}`;
}

export function normalizePlexEpisodeKey(rawKey: unknown): string | null {
  if (typeof rawKey !== 'string') return null;

  const match = rawKey.trim().match(/^(?:s\s*)?(\d+)\s*(?:x|e)\s*(\d+)$/i);
  if (!match) return null;

  return `${Number(match[1])}x${Number(match[2])}`;
}

export function isPlexEpisodeAlreadyWatched(
  show: { seenEpisodes?: string[]; episodeRecords?: Record<string, unknown> } | null | undefined,
  seasonNumber: number,
  episodeNumber: number
): boolean {
  if (!show) return false;

  const expectedKey = `${Number(seasonNumber)}x${Number(episodeNumber)}`;
  const seenEpisodeKeys = Array.isArray(show.seenEpisodes) ? show.seenEpisodes : [];
  const recordKeys = show.episodeRecords ? Object.keys(show.episodeRecords) : [];

  return [...seenEpisodeKeys, ...recordKeys].some(
    (key) => normalizePlexEpisodeKey(key) === expectedKey
  );
}

export function isPlexMovieAlreadyWatched(
  show: {
    seenEpisodes?: string[];
    episodeRecords?: Record<string, unknown>;
    status?: string;
  } | null | undefined
): boolean {
  if (!show) return false;

  return show.seenEpisodes?.includes('movie') === true ||
    show.status === 'completed' ||
    Object.prototype.hasOwnProperty.call(show.episodeRecords || {}, 'movie');
}

export function getStrongPlexSourceIdentity(item: any): string | null {
  const unwrapped = unwrapPlexMediaItem(item);
  const ids = extractPlexExternalIds(unwrapped);
  if (ids.tmdbId) return `tmdb:${ids.tmdbId}`;
  if (ids.imdbId) return `imdb:${ids.imdbId}`;
  if (ids.tvdbId) return `tvdb:${ids.tvdbId}`;
  if (ids.plexGuid) return `plex:${ids.plexGuid}`;

  const serverId = unwrapped?.serverId || unwrapped?.serverIdentifier;
  const ratingKey = getPlexMetadataLookupKey(unwrapped);
  if (serverId && ratingKey) return `server:${serverId}:rating:${ratingKey}`;
  return null;
}

export function buildPlexParentShowIdentityItem(rawItem: any): any {
  const item = unwrapPlexMediaItem(rawItem);
  const rawType = String(item?.type || '').toLowerCase();
  const isEpisode = rawType === 'episode' || !!item?.grandparentTitle ||
    (item?.parentIndex !== undefined && item?.index !== undefined);

  // Un épisode appartient à une saison via parentGuid, mais à la série via grandparentGuid.
  // Ne jamais promouvoir parentGuid (season) au rang d'identité show.
  // Si grandparentGuid n'est pas disponible, conserver le GUID de l'épisode :
  // Plex Discover pourra charger cet épisode puis remonter vers son grandparentGuid.
  const episodePlexGuid = [
    item?.guid,
    ...(Array.isArray(item?.Guid) ? item.Guid.map((guid: any) => typeof guid === 'string' ? guid : guid?.id) : []),
    ...(Array.isArray(item?.guids) ? item.guids.map((guid: any) => typeof guid === 'string' ? guid : guid?.id) : [])
  ].find(
    (guid) => parsePlexGuid(guid)?.type === 'episode'
  ) || null;

  const showGuid = isEpisode
    ? (item?.grandparentGuid || episodePlexGuid || item?.grandparentKey || null)
    : (item?.parentGuid || item?.guid || null);

  const showGuids = isEpisode
    ? (item?.grandparentGuids || [])
    : (item?.parentGuids || item?.Guid || item?.guids || []);

  return {
    type: 'show',
    guid: showGuid,
    Guid: showGuids,
    guids: showGuids,
    serverId: item?.serverId,
    ratingKey: isEpisode
      ? (item?.grandparentRatingKey || null)
      : (item?.parentRatingKey || item?.ratingKey || null),
    sourceIdentity: item?.sourceIdentity || null
  };
}
