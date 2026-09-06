import { authenticatedFetch } from '../lib/apiAuth';
import { resolveSeenItApiUrl } from '../lib/seenitApi';

export interface TVDBFranchiseItem {
  id: number;
  media_type: 'tv' | 'movie';
}

/**
 * TVDB n'est jamais contacté directement par le client. La façade backend SeenIt
 * possède la clé fournisseur, le token TVDB et le rate-limit. Cette fonction garde
 * le contrat historique pour les éventuels consommateurs encore présents.
 */
export async function getTVDBFranchiseTimeline(
  tvdbId?: number | null,
  mediaTitle?: string | null,
  _imdbId?: string | null,
  mediaType: 'tv' | 'movie' = 'tv'
): Promise<TVDBFranchiseItem[]> {
  const params = new URLSearchParams();
  if (Number(tvdbId) > 0) params.set('tvdbId', String(Number(tvdbId)));
  if (mediaTitle?.trim()) params.set('mediaTitle', mediaTitle.trim());
  params.set('mediaType', mediaType);
  const url = `${resolveSeenItApiUrl('/api/media/tvdb/franchise')}?${params.toString()}`;

  try {
    const response = await authenticatedFetch(url);
    if (!response.ok) return [];
    const payload = await response.json();
    return Array.isArray(payload?.results)
      ? payload.results.filter((item: any): item is TVDBFranchiseItem =>
          Number.isFinite(Number(item?.id)) && (item?.media_type === 'tv' || item?.media_type === 'movie'))
      : [];
  } catch (error) {
    console.warn('[TVDB] Façade backend indisponible:', error);
    return [];
  }
}
