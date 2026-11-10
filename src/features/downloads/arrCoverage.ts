import { movieRelease, sortProgrammedItems, type ProgrammedCalendar, type ProgrammedItem } from './programmedCalendar';
import type { ArrPendingTitle } from './recentImports';

/**
 * SEENIT-DOWNLOAD-023 — Aucun titre de Sonarr/Radarr invisible dans SeenIt (retours terrain du 09/11 : « ne pas
 * laisser de données orphelines dans Sonarr/Radarr » ; « un film unmonitored restera orphelin également, il doit
 * être visible, et je déciderai dans SeenIt quoi en faire »). Chaque titre de leur bibliothèque apparaît à un endroit
 * de l'onglet Télécharger :
 * - avec au moins un fichier → « Téléchargés » (lu par `fetchRecentImports`) ;
 * - sans fichier, déjà dans Programmés (calendrier, recherchés) → Programmés ;
 * - film surveillé sans fichier hors calendrier (sortie lointaine ou non annoncée) → ajouté à Programmés ;
 * - sinon (non surveillé, ou série surveillée sans épisode au calendrier ni parmi les recherchés lus) → « À décider ».
 * Le rattachement se fait par l'identifiant Sonarr/Radarr du même serveur, jamais par le titre.
 */
export interface ArrCoverage { programmed: ProgrammedCalendar; undecided: ArrPendingTitle[] }

export function coverArrLibrary(programmed: ProgrammedCalendar, pending: readonly ArrPendingTitle[], now = Date.now()): ArrCoverage {
  const shown = new Set(programmed.items.map(item => item.kind === 'movie' ? `m${item.id}` : `s${item.seriesId}`));
  // Calendrier Sonarr illisible : une série surveillée y figure peut-être ; elle n'est jamais classée « À décider » à tort.
  const sonarrUnknown = programmed.failures.some(source => /sonarr/i.test(source));
  const extra: ProgrammedItem[] = [];
  const undecided: ArrPendingTitle[] = [];
  for (const title of pending) {
    if (shown.has(title.key)) continue;
    if (title.kind === 'movie' && title.monitored) {
      const release = movieRelease(title.release || {}, now);
      const state = release.date ? {} : title.release?.isAvailable ? { wanted: true } : release.inCinemasPast ? { inCinemasPast: true } : {};
      // Revue Codex #933 : même libellé de qualité qu'au calendrier (affichage et choix 1080p/4K du menu ⋯).
      const quality = programmed.movieQuality?.(title.profileId);
      extra.push({ kind: 'movie', id: title.arrId, tmdbId: title.tmdbId, title: title.title, date: release.date, dateKind: release.kind, posterUrl: title.posterUrl, profileId: title.profileId, ...(quality ? { quality } : {}), ...state });
      continue;
    }
    if (title.kind === 'series' && title.monitored && sonarrUnknown) continue;
    undecided.push(title);
  }
  return { programmed: extra.length ? { ...programmed, items: sortProgrammedItems([...programmed.items, ...extra]) } : programmed, undecided };
}

/** Raison affichée d'un titre « À décider ». */
export const undecidedReason = (title: Pick<ArrPendingTitle, 'kind' | 'monitored'>) => title.kind === 'movie'
  ? 'Film non surveillé, sans fichier'
  // Revue Codex #933 : hors calendrier et hors première page des recherchés ne prouve pas « aucun épisode attendu ».
  : title.monitored ? 'Série surveillée, sans fichier' : 'Série non surveillée, sans fichier';

/**
 * Retour terrain du 10/11 sur la v1.4.289 (« un film à décider ne disparaît pas après arbitrage ») : télécharger
 * une version d'un film déjà dans Radarr ne le rend pas « surveillé » ; il restait « À décider » pendant le
 * téléchargement. Un titre présent dans la file du client (en cours, en attente, à régler ou terminé, jamais un
 * annulé) est déjà visible dans Télécharger : il quitte « À décider ». Identité TMDB exacte, jamais le titre.
 */
export function undecidedOutsideQueue(undecided: readonly ArrPendingTitle[], queued: ReadonlySet<string>): ArrPendingTitle[] {
  return undecided.filter(title => !(Number(title.tmdbId) > 0 && queued.has(`${title.kind === 'movie' ? 'movie' : 'tv'}:${Number(title.tmdbId)}`)));
}
