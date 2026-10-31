import { canonicalProviderBrandAsset } from '../features/providers/providerBrandAssets.ts';

export const PLEX_LOGO_SVG = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="20" fill="%231F2326"/><path d="M30 20 L56 50 L30 80 L46 80 L72 50 L46 20 Z" fill="%23E5A00D"/></svg>`;

export function getFormattedProviderLogo(logoPath?: string | null, name?: string | null): string | null {
  if (!logoPath && !name) return null;

  const lowerName = (name || '').toLowerCase();
  const lowerPath = (logoPath || '').toLowerCase();

  // Plex detection
  if (
    lowerName === 'plex' ||
    lowerName.includes('plex') ||
    lowerPath.includes('plex')
  ) {
    return PLEX_LOGO_SVG;
  }

  const canonicalBrandAsset = canonicalProviderBrandAsset(name, logoPath);
  if (canonicalBrandAsset) return canonicalBrandAsset;

  // Default TMDB image URL for providers without a local canonical brand asset.
  if (logoPath) {
    return logoPath.startsWith('http') ? logoPath : `https://image.tmdb.org/t/p/w92${logoPath}`;
  }

  return null;
}

/**
 * Resolves genuine streaming providers (SVOD / flatrate / free / ads).
 * Strictly ignores 'buy' (Achat VOD) and 'rent' (Location VOD) to avoid displaying Apple TV/Prime on movies not streaming.
 * When the user configured "Mes plateformes", an actually available matching provider wins before the generic TMDB order.
 */
export interface StreamingProvider {
  provider_id?: number;
  logo_path: string;
  provider_name?: string;
}

export type WatchProviderResults = Record<string, {
  flatrate?: StreamingProvider[];
  free?: StreamingProvider[];
  ads?: StreamingProvider[];
  buy?: StreamingProvider[];
  rent?: StreamingProvider[];
}>;

export function extractOfficialStreamingProvider(
  results: WatchProviderResults | null | undefined,
  preferredProviderIds: readonly number[] = [],
): { logo_path: string; provider_name: string; provider_id?: number } | null {
  const fr = results?.FR;
  if (!fr) return null;

  const candidates = [
    ...(Array.isArray(fr.flatrate) ? fr.flatrate : []),
    ...(Array.isArray(fr.free) ? fr.free : []),
    ...(Array.isArray(fr.ads) ? fr.ads : []),
  ].filter(provider => Boolean(provider?.logo_path));

  if (candidates.length === 0) return null;

  const preferredIds = new Set(
    preferredProviderIds
      .map(Number)
      .filter((id) => Number.isFinite(id) && id > 0),
  );
  const stream = candidates.find(provider => preferredIds.has(Number(provider?.provider_id))) || candidates[0];

  return {
    logo_path: stream.logo_path,
    provider_name: stream.provider_name || '',
    provider_id: stream.provider_id,
  };
}
