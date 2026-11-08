type SonarrRecord = Record<string, unknown>;
export type SeasonPlanEpisode = SonarrRecord & { id?: number; seasonNumber?: number; episodeNumber?: number; hasFile?: boolean; monitored?: boolean; airDateUtc?: string; airDate?: string };
export type SeasonPlanSeries = SonarrRecord & { seasons?: Array<SonarrRecord & { seasonNumber?: number; monitored?: boolean }> };

export interface SeasonBlanketPlan {
  /** Saisons à renvoyer avec la série (saison visée non surveillée), ou `null` si rien ne change. */
  seasons: SeasonPlanSeries['seasons'] | null;
  /** Épisodes dont la surveillance doit être rétablie après la mise à jour de la série. */
  restore: SeasonPlanEpisode[];
}

const aired = (episode: SeasonPlanEpisode, now: number) => {
  const time = Date.parse(String(episode.airDateUtc || episode.airDate || ''));
  return Number.isFinite(time) && time <= now;
};

/**
 * Retour terrain du 08/11 (« quand je lance 1 seul épisode il me programme toute la saison à venir ») : dans
 * Sonarr, une saison surveillée fait surveiller — donc télécharger à sa sortie — chaque épisode annoncé
 * ensuite, et le calendrier les montre tous dans « Programmés ». Quand SeenIt programme ou lance des épisodes
 * précis, la saison cesse d'être surveillée en bloc. Sonarr retirant alors la surveillance de ses épisodes,
 * seuls la retrouvent : les épisodes demandés, et ceux déjà sortis sans fichier (un téléchargement voulu n'est
 * jamais abandonné). Un épisode à venir non demandé n'est plus programmé.
 */
export function seasonBlanketPlan(series: SeasonPlanSeries | null | undefined, season: number, episodes: readonly SeasonPlanEpisode[], requested: readonly number[], now = Date.now()): SeasonBlanketPlan {
  const watched = Boolean(series?.seasons?.some(entry => Number(entry.seasonNumber) === Number(season) && entry.monitored === true));
  // Revue Codex #918 : jamais de saison désurveillée sans connaître ses épisodes — une liste illisible ou vide
  // ferait perdre leur surveillance aux épisodes déjà sortis et manquants. La saison reste alors telle quelle.
  const known = episodes.filter(entry => entry.id && Number(entry.seasonNumber) === Number(season));
  if (!watched || !series?.seasons || !known.length) return { seasons: null, restore: [] };
  return {
    seasons: series.seasons.map(entry => Number(entry.seasonNumber) === Number(season) ? { ...entry, monitored: false } : entry),
    restore: known.filter(entry => entry.hasFile !== true
      && (requested.includes(Number(entry.episodeNumber)) || (entry.monitored === true && aired(entry, now)))),
  };
}
