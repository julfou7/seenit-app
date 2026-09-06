export interface TVDBFranchiseItem {
  id: number;
  media_type: 'tv' | 'movie';
}

interface TVDBAttachedList {
  id?: number | string;
  isOfficial?: boolean;
}

interface TVDBListEntity {
  seriesId?: number | string;
  movieId?: number | string;
  series?: { id?: number | string };
  movie?: { id?: number | string };
}

interface TVDBRemoteId {
  id?: number | string;
  type?: number | string;
  sourceName?: string;
}

const BASE_URL = 'https://api4.thetvdb.com/v4';
const TOKEN_TTL_MS = 23 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 7000;
const TMDB_REMOTE_SOURCE_NAMES = new Set(['themoviedb.com', 'themoviedb', 'tmdb']);

let cachedToken: { value: string; expiresAt: number } | null = null;

function getTVDBApiKey(): string {
  return String((import.meta.env.VITE_TVDB_API_KEY as string | undefined) || '').trim();
}

function toPositiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function selectSingleOfficialTVDBList(lists: unknown): TVDBAttachedList | null {
  if (!Array.isArray(lists)) return null;
  const official = lists.filter((list): list is TVDBAttachedList => {
    if (!list || typeof list !== 'object') return false;
    return (list as TVDBAttachedList).isOfficial === true
      && toPositiveInteger((list as TVDBAttachedList).id) !== null;
  });
  return official.length === 1 ? official[0] : null;
}

export function getTVDBEntityIdentity(entity: unknown): { id: number; media_type: 'tv' | 'movie' } | null {
  if (!entity || typeof entity !== 'object') return null;
  const candidate = entity as TVDBListEntity;
  const seriesId = toPositiveInteger(candidate.seriesId ?? candidate.series?.id);
  const movieId = toPositiveInteger(candidate.movieId ?? candidate.movie?.id);
  if ((seriesId === null) === (movieId === null)) return null;
  return seriesId !== null
    ? { id: seriesId, media_type: 'tv' }
    : { id: movieId as number, media_type: 'movie' };
}

export function extractExactTMDBRemoteId(remoteIds: unknown): number | null {
  if (!Array.isArray(remoteIds)) return null;
  const matches = new Set<number>();

  for (const remote of remoteIds as TVDBRemoteId[]) {
    if (!remote || typeof remote !== 'object') continue;
    const sourceType = Number(remote.type);
    const sourceName = String(remote.sourceName || '').trim().toLowerCase();
    if (sourceType !== 12 && !TMDB_REMOTE_SOURCE_NAMES.has(sourceName)) continue;
    const id = toPositiveInteger(remote.id);
    if (id !== null) matches.add(id);
  }

  return matches.size === 1 ? [...matches][0] : null;
}

async function getTVDBToken(): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  const apiKey = getTVDBApiKey();
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ apikey: apiKey }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const token = typeof payload?.data?.token === 'string' ? payload.data.token.trim() : '';
    if (!token) return null;
    cachedToken = { value: token, expiresAt: Date.now() + TOKEN_TTL_MS };
    return token;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchTVDB(path: string): Promise<any | null> {
  const token = await getTVDBToken();
  if (!token) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveTVDBEntityToTMDB(entity: unknown): Promise<TVDBFranchiseItem | null> {
  const identity = getTVDBEntityIdentity(entity);
  if (!identity) return null;
  const endpoint = identity.media_type === 'tv'
    ? `/series/${identity.id}/extended`
    : `/movies/${identity.id}/extended`;
  const payload = await fetchTVDB(endpoint);
  const tmdbId = extractExactTMDBRemoteId(payload?.data?.remoteIds);
  return tmdbId === null ? null : { id: tmdbId, media_type: identity.media_type };
}

async function resolveEntitiesInOrder(entities: unknown[]): Promise<TVDBFranchiseItem[]> {
  const resolved: TVDBFranchiseItem[] = [];
  const concurrency = 6;

  for (let index = 0; index < entities.length; index += concurrency) {
    const results = await Promise.all(entities.slice(index, index + concurrency).map(resolveTVDBEntityToTMDB));
    for (const item of results) if (item) resolved.push(item);
  }

  const seen = new Set<string>();
  return resolved.filter(item => {
    const key = `${item.media_type}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Résout une franchise/univers TVDB sans aucun rapprochement nominatif.
 * Contrat SEENIT-RELATION-001 : ID TVDB exact obligatoire, une seule liste officielle
 * attachée à l'œuvre, aucun score/mot-clé/fusion, puis remappage TMDB exact et typé.
 * Les paramètres historiques de titre/IMDb restent uniquement pour compatibilité de signature.
 */
export async function getTVDBFranchiseTimeline(
  tvdbId?: number | null,
  _mediaTitle?: string | null,
  _imdbId?: string | null,
  mediaType: 'tv' | 'movie' = 'tv',
): Promise<TVDBFranchiseItem[]> {
  const exactTvdbId = toPositiveInteger(tvdbId);
  if (exactTvdbId === null) return [];

  const mediaEndpoint = mediaType === 'movie'
    ? `/movies/${exactTvdbId}/extended`
    : `/series/${exactTvdbId}/extended`;
  const mediaPayload = await fetchTVDB(mediaEndpoint);
  const selectedList = selectSingleOfficialTVDBList(mediaPayload?.data?.lists);
  const listId = toPositiveInteger(selectedList?.id);
  if (listId === null) return [];

  const listPayload = await fetchTVDB(`/lists/${listId}/extended`);
  const entities = Array.isArray(listPayload?.data?.entities) ? listPayload.data.entities : [];
  if (entities.length < 2) return [];

  const containsCurrentMedia = entities.some((entity: unknown) => {
    const identity = getTVDBEntityIdentity(entity);
    return identity?.id === exactTvdbId && identity.media_type === mediaType;
  });
  if (!containsCurrentMedia) return [];

  const timeline = await resolveEntitiesInOrder(entities);
  return timeline.length > 1 ? timeline : [];
}
