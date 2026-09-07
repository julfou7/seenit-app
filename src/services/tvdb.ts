export interface TVDBFranchiseItem {
  id: number;
  media_type: 'tv' | 'movie';
}

export type TVDBRelationKind = 'franchise' | 'universe';

export interface TVDBFranchiseRelation {
  kind: TVDBRelationKind;
  items: TVDBFranchiseItem[];
}

interface TVDBAttachedList {
  id?: number | string;
  isOfficial?: boolean;
  name?: string;
  nameTranslated?: string;
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

interface TVDBSearchByRemoteIdResult {
  series?: { id?: number | string };
  movie?: { id?: number | string };
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

export function classifyTVDBList(list: unknown): TVDBRelationKind | null {
  if (!list || typeof list !== 'object') return null;
  const candidate = list as TVDBAttachedList;
  const label = String(candidate.nameTranslated || candidate.name || '').trim().toLowerCase();
  if (!label) return null;
  if (/\buniverse\b/.test(label)) return 'universe';
  if (/\bfranchise\b/.test(label)) return 'franchise';
  return null;
}

export function selectSingleOfficialTVDBList(lists: unknown): TVDBAttachedList | null {
  if (!Array.isArray(lists)) return null;
  const official = lists.filter((list): list is TVDBAttachedList => {
    if (!list || typeof list !== 'object') return false;
    const candidate = list as TVDBAttachedList;
    return candidate.isOfficial === true
      && toPositiveInteger(candidate.id) !== null
      && classifyTVDBList(candidate) !== null;
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

export function extractExactTVDBSearchIdentity(
  results: unknown,
  mediaType: 'tv' | 'movie',
): number | null {
  if (!Array.isArray(results)) return null;
  const matches = new Set<number>();

  for (const result of results as TVDBSearchByRemoteIdResult[]) {
    if (!result || typeof result !== 'object') continue;
    const id = mediaType === 'movie'
      ? toPositiveInteger(result.movie?.id)
      : toPositiveInteger(result.series?.id);
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

async function resolveExactTVDBMediaId(
  tvdbId: number | null | undefined,
  imdbId: string | null | undefined,
  mediaType: 'tv' | 'movie',
): Promise<number | null> {
  const exactTvdbId = toPositiveInteger(tvdbId);
  if (exactTvdbId !== null) return exactTvdbId;

  const exactImdbId = String(imdbId || '').trim();
  if (!/^tt\d+$/.test(exactImdbId)) return null;

  const payload = await fetchTVDB(`/search/remoteid/${encodeURIComponent(exactImdbId)}`);
  return extractExactTVDBSearchIdentity(payload?.data, mediaType);
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
 * Résout une franchise/univers TVDB sans aucun rapprochement nominatif d'œuvre.
 * Contrat SEENIT-RELATION-001 : identité externe exacte obligatoire, une seule liste officielle
 * attachée et explicitement qualifiable, aucun score/fusion, puis remappage TMDB exact et typé.
 * Le libellé de la liste déjà atteinte sert uniquement à qualifier l'UI franchise/univers.
 */
export async function getTVDBFranchiseRelation(
  tvdbId?: number | null,
  _mediaTitle?: string | null,
  imdbId?: string | null,
  mediaType: 'tv' | 'movie' = 'tv',
): Promise<TVDBFranchiseRelation | null> {
  const exactTvdbId = await resolveExactTVDBMediaId(tvdbId, imdbId, mediaType);
  if (exactTvdbId === null) return null;

  const mediaEndpoint = mediaType === 'movie'
    ? `/movies/${exactTvdbId}/extended`
    : `/series/${exactTvdbId}/extended`;
  const mediaPayload = await fetchTVDB(mediaEndpoint);
  const selectedList = selectSingleOfficialTVDBList(mediaPayload?.data?.lists);
  const listId = toPositiveInteger(selectedList?.id);
  const kind = classifyTVDBList(selectedList);
  if (listId === null || kind === null) return null;

  const listPayload = await fetchTVDB(`/lists/${listId}/extended`);
  const entities = Array.isArray(listPayload?.data?.entities) ? listPayload.data.entities : [];
  if (entities.length < 2) return null;

  const containsCurrentMedia = entities.some((entity: unknown) => {
    const identity = getTVDBEntityIdentity(entity);
    return identity?.id === exactTvdbId && identity.media_type === mediaType;
  });
  if (!containsCurrentMedia) return null;

  const items = await resolveEntitiesInOrder(entities);
  return items.length > 1 ? { kind, items } : null;
}

export async function getTVDBFranchiseTimeline(
  tvdbId?: number | null,
  mediaTitle?: string | null,
  imdbId?: string | null,
  mediaType: 'tv' | 'movie' = 'tv',
): Promise<TVDBFranchiseItem[]> {
  const relation = await getTVDBFranchiseRelation(tvdbId, mediaTitle, imdbId, mediaType);
  return relation?.items || [];
}
