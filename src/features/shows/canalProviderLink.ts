export type CanalProviderTargetKind = 'exact-media-watch' | 'provider-search';

export interface CanalProviderTarget {
  url: string;
  kind: CanalProviderTargetKind;
}

export function resolveCanalProviderTarget({
  title,
  fallbackLink,
  mediaType,
  tmdbId,
}: {
  title: string;
  fallbackLink: string;
  mediaType: 'tv' | 'movie';
  tmdbId?: number | string;
}): CanalProviderTarget {
  const numericTmdbId = Number(tmdbId);
  if (fallbackLink && fallbackLink !== '#' && Number.isInteger(numericTmdbId) && numericTmdbId > 0) {
    try {
      const parsed = new URL(fallbackLink);
      const host = parsed.hostname.toLowerCase();
      const expectedPath = `/${mediaType}/${numericTmdbId}/watch`;
      const isTmdbHost = parsed.protocol === 'https:' && (host === 'www.themoviedb.org' || host === 'themoviedb.org');
      const isExactMediaPath = parsed.pathname === expectedPath || parsed.pathname.startsWith(`${expectedPath}/`);
      if (isTmdbHost && isExactMediaPath) {
        return { url: fallbackLink, kind: 'exact-media-watch' };
      }
    } catch {
      // Un fallback malformé ne porte aucune preuve d'identité.
    }
  }

  return {
    url: `https://www.canalplus.com/recherche/?q=${encodeURIComponent(title)}`,
    kind: 'provider-search',
  };
}
