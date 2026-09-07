import { authenticatedFetch } from '../lib/apiAuth';
import { resolveSeenItApiUrl } from '../lib/seenitApi';

export interface TVDBFranchiseItem {
  id: number;
  media_type: 'tv' | 'movie';
}

export type TVDBRelationKind = 'franchise' | 'universe';

export interface TVDBFranchiseRelation {
  kind: TVDBRelationKind;
  items: TVDBFranchiseItem[];
}

const toPositiveInteger = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

/**
 * Façade PWA/APK : TVDB n'est jamais contacté directement depuis le client.
 * Le backend SeenIt authentifié reçoit uniquement des identifiants externes exacts.
 */
export async function getTVDBFranchiseRelation(
  tvdbId?: number | null,
  imdbId?: string | null,
  mediaType: 'tv' | 'movie' = 'tv',
): Promise<TVDBFranchiseRelation | null> {
  const exactTvdbId = toPositiveInteger(tvdbId);
  const exactImdbId = String(imdbId || '').trim();
  if (exactTvdbId === null && !/^tt\d{5,12}$/i.test(exactImdbId)) return null;

  const url = new URL(resolveSeenItApiUrl('/api/media/tvdb/franchise'));
  url.searchParams.set('mediaType', mediaType);
  if (exactTvdbId !== null) url.searchParams.set('tvdbId', String(exactTvdbId));
  if (/^tt\d{5,12}$/i.test(exactImdbId)) url.searchParams.set('imdbId', exactImdbId);

  try {
    const response = await authenticatedFetch(url.toString());
    if (!response.ok) return null;
    const payload = await response.json();
    const kind: TVDBRelationKind | null = payload?.kind === 'universe'
      ? 'universe'
      : payload?.kind === 'franchise'
        ? 'franchise'
        : null;
    if (!kind || !Array.isArray(payload?.results)) return null;

    const seen = new Set<string>();
    const items = payload.results.filter((item: any): item is TVDBFranchiseItem => {
      const id = toPositiveInteger(item?.id);
      if (id === null || (item?.media_type !== 'tv' && item?.media_type !== 'movie')) return false;
      const key = `${item.media_type}:${id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      item.id = id;
      return true;
    });

    return items.length > 1 ? { kind, items } : null;
  } catch {
    return null;
  }
}
