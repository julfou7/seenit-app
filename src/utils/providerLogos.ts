export const PLEX_LOGO_SVG = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="20" fill="%231F2326"/><path d="M30 20 L56 50 L30 80 L46 80 L72 50 L46 20 Z" fill="%23E5A00D"/></svg>`;

export const PROVIDER_BRAND_LOGOS = {
  netflix: '/brand/providers/netflix.png',
  canal: '/brand/providers/canalplus.png',
  hbo: '/brand/providers/hbo.png',
  france: '/brand/providers/france-tv.png',
} as const;

export function getFormattedProviderLogo(logoPath?: string | null, name?: string | null): string | null {
  if (!logoPath && !name) return null;

  const lowerName = (name || '').toLowerCase();
  const lowerPath = (logoPath || '').toLowerCase();

  if (
    lowerName === 'plex' ||
    lowerName.includes('plex') ||
    lowerPath.includes('plex')
  ) {
    return PLEX_LOGO_SVG;
  }

  if (lowerName.includes('netflix') || lowerPath.includes('pbpmk2jmconnqwx5jgpxngfowtp')) {
    return PROVIDER_BRAND_LOGOS.netflix;
  }

  if (
    lowerName === 'canal+' ||
    lowerName === 'canal plus' ||
    lowerName.startsWith('canal+ ') ||
    lowerName.startsWith('canal plus ') ||
    lowerPath.includes('canalplus.svg')
  ) {
    return PROVIDER_BRAND_LOGOS.canal;
  }

  if (
    lowerName === 'hbo' ||
    lowerName.includes('hbo max') ||
    lowerName.startsWith('hbo ') ||
    lowerPath.includes('2me1s9339')
  ) {
    return PROVIDER_BRAND_LOGOS.hbo;
  }

  if (
    lowerName === 'france tv' ||
    lowerName === 'france.tv' ||
    lowerName.startsWith('france tv ') ||
    lowerName.startsWith('france.tv ')
  ) {
    return PROVIDER_BRAND_LOGOS.france;
  }

  if (logoPath) {
    if (logoPath.startsWith('/brand/') || logoPath.startsWith('data:') || logoPath.startsWith('http')) return logoPath;
    return `https://image.tmdb.org/t/p/w92${logoPath}`;
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
