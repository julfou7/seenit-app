/**
 * #879 — Clé unique de présence d'un épisode (« 3x4 ») : le store de présence Sonarr l'écrit et la fiche,
 * le mode téléchargement et la popup la lisent. Deux formats différents (« S3E4 » contre « 3x4 ») faisaient
 * qu'aucun épisode téléchargé n'était jamais reconnu comme présent.
 */
export const episodePresenceKey = (season: number | string, episode: number | string): string => `${Number(season)}x${Number(episode)}`;
