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

function unwrapPlexItem(rawItem: any): any {
  return rawItem?.raw ? { ...rawItem.raw, ...rawItem } : rawItem;
}

export function extractPlexExternalIds(rawItem: any): PlexExternalIds {
  let tmdbId: number | null = null;
  let imdbId: string | null = null;
  let tvdbId: number | null = null;
  let plexGuid: string | null = null;

  const item = unwrapPlexItem(rawItem);
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

    const plexMatch = value.match(/plex:\/\/(?:movie|show|season|episode)\/([a-z0-9_-]+)/i);
    if (plexMatch && !plexGuid) plexGuid = plexMatch[1];
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
  const unwrapped = unwrapPlexItem(item);
  const ids = extractPlexExternalIds(unwrapped);
  if (ids.tmdbId) return `tmdb:${ids.tmdbId}`;
  if (ids.imdbId) return `imdb:${ids.imdbId}`;
  if (ids.tvdbId) return `tvdb:${ids.tvdbId}`;
  if (ids.plexGuid) return `plex:${ids.plexGuid}`;

  const serverId = unwrapped?.serverId || unwrapped?.serverIdentifier;
  const ratingKey = unwrapped?.ratingKey || unwrapped?.key;
  if (serverId && ratingKey) return `server:${serverId}:rating:${ratingKey}`;
  return null;
}

export function buildPlexParentShowIdentityItem(rawItem: any): any {
  const item = unwrapPlexItem(rawItem);
  const rawType = String(item?.type || '').toLowerCase();
  const isEpisode = rawType === 'episode' || !!item?.grandparentTitle ||
    (item?.parentIndex !== undefined && item?.index !== undefined);

  // Un épisode appartient à une saison via parentGuid, mais à la série via grandparentGuid.
  // Ne jamais promouvoir parentGuid (season) au rang d'identité show.
  // Si grandparentGuid n'est pas disponible, conserver le GUID de l'épisode :
  // Plex Discover pourra charger cet épisode puis remonter vers son grandparentGuid.
  const showGuid = isEpisode
    ? (item?.grandparentGuid || item?.guid || null)
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
