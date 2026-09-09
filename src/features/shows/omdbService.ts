/**
 * Compatibilité transitoire avec la fiche historique.
 *
 * OMDb n'est plus un fournisseur SeenIt : ce module n'effectue aucun appel réseau,
 * ne lit ni n'écrit aucun cache et ne fournit aucune note IMDb. Les appelants
 * historiques sont retirés dans le chantier fiche #216, après quoi ce fichier
 * peut être supprimé sans migration de données.
 */
export interface EpisodeImdbData {
  rating: number;
  imdbId: string;
}

export interface SeriesImdbData {
  rating: number;
  votes: string;
  updatedAt: number;
}

export async function getSeasonImdbRatings(): Promise<Record<number, EpisodeImdbData>> {
  return {};
}

export async function getSeriesImdbData(): Promise<SeriesImdbData | null> {
  return null;
}

export async function getEpisodeImdbVotes(): Promise<string | null> {
  return null;
}
