export type TmdbPageResult = {
  ok?: boolean;
  value?: {
    results?: unknown[];
    total_pages?: number | null;
  };
} | null | undefined;

/**
 * Une page qui ne produit aucun nouvel élément après dédoublonnage n'est pas une
 * preuve de fin du catalogue. La pagination Explorer suit uniquement les métadonnées
 * brutes renvoyées par les sources TMDB qui alimentent encore la grille.
 */
export function hasMoreTmdbPages(currentPage: number, ...sources: TmdbPageResult[]): boolean {
  return sources.some(source => {
    if (!source?.ok || !Array.isArray(source.value?.results)) return false;

    const totalPages = Number(source.value.total_pages);
    if (Number.isFinite(totalPages) && totalPages > 0) {
      return currentPage < totalPages;
    }

    // Certaines façades historiques ne renseignent pas total_pages : dans ce cas,
    // une page brute non vide autorise au moins la tentative suivante.
    return source.value.results.length > 0;
  });
}
