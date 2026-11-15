const tmdbImage = (path: string | null | undefined, size: 'w342' | 'w780') => {
  if (!path) return undefined;
  return path.startsWith('http') ? path : `https://image.tmdb.org/t/p/${size}${path}`;
};

/**
 * Retour terrain du 15/11 (Actualité « Loups garous », décision #443) : une actualité de série montre en
 * grand l'image paysage de la série et garde l'affiche en vignette. Sans image paysage, l'affiche reste le
 * repli (centrée entière par le natif) ; sans aucune image, la notification reste textuelle.
 */
export function buildNewsNotificationVisual(
  posterPath: string | null | undefined,
  backdropPath: string | null | undefined,
): { icon?: string; image?: string } {
  const icon = tmdbImage(posterPath, 'w342');
  const image = tmdbImage(backdropPath, 'w780');
  return { ...(icon ? { icon } : {}), ...(image ? { image } : {}) };
}
