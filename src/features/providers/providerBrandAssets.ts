export const PROVIDER_BRAND_ASSETS = {
  netflix: '/brand/providers/netflix.webp',
  hbo: '/brand/providers/hbo.webp',
  canal: '/brand/providers/canalplus.webp',
  france: '/brand/providers/francetv.webp',
} as const;

/**
 * Assets de marque validés sur le terrain. Ils priment sur les variantes TMDB
 * ou générées afin qu'un même diffuseur garde le même logo dans toute l'app.
 */
export function canonicalProviderBrandAsset(
  name?: string | null,
  logoPath?: string | null,
): string | null {
  const lowerName = String(name || '').trim().toLowerCase();
  const lowerPath = String(logoPath || '').toLowerCase();

  if (lowerName === 'netflix' || lowerPath.includes('pbpmk2jmconnqwx5jgpxngfowtp')) {
    return PROVIDER_BRAND_ASSETS.netflix;
  }
  if (
    lowerName === 'hbo' ||
    lowerName === 'hbo max' ||
    lowerName.startsWith('hbo ') ||
    lowerPath.includes('2me1s9339')
  ) {
    return PROVIDER_BRAND_ASSETS.hbo;
  }
  if (
    lowerName === 'canal+' ||
    lowerName === 'canal plus' ||
    lowerName.startsWith('canal+') ||
    lowerName.startsWith('canal plus')
  ) {
    return PROVIDER_BRAND_ASSETS.canal;
  }
  if (
    lowerName === 'france tv' ||
    lowerName === 'france.tv' ||
    lowerName.includes('france télévisions') ||
    lowerName.includes('france televisions')
  ) {
    return PROVIDER_BRAND_ASSETS.france;
  }

  return null;
}
