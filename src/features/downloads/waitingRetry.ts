import type { LiveDownloadItem } from '../../services/sonarrRadarrLive';
import type { ArrDownloadLaunch } from './downloadLaunch';
import { downloadGroup } from './downloadGroups.ts';

/**
 * #664 — retour du propriétaire du 15/11 : « un bouton retry pour forcer la nouvelle tentative ». Une demande en
 * attente de disponibilité se relance par le même chemin qu'un lancement depuis la fiche : même identité TMDB, même
 * périmètre (film, saison ou épisode), même qualité. La nouvelle demande prend la place de l'attente (même
 * périmètre) ; si rien n'est trouvé, l'attente revient avec la raison exacte (aucune version, disque plein…).
 * Sans identité TMDB, rien n'est relancé : jamais de recherche par titre.
 */
export function waitingRetryLaunch(item: LiveDownloadItem): Omit<ArrDownloadLaunch, 'config' | 'notify'> | null {
  // Retour terrain du 15/11 (v1.4.316, « je suis bloqué, rien pour relancer ») : une demande « À régler » sans
  // transfert (recherche impossible, timeout…) se relance aussi ; un vrai transfert en échec passe par « Choisir
  // une version ».
  // Revue Codex #1057 : `importState: 'pending'` est posé dès la demande (`beginDownloadRequest`) ; seul un
  // identifiant, un chemin ou une progression prouvent un transfert.
  const transferStarted = Boolean(item.downloadId || item.transferPath) || Number(item.progress) > 0;
  const failedRequest = downloadGroup(item) === 'attention' && !transferStarted;
  if ((item.status !== 'waiting' && !failedRequest) || !(Number(item.tmdbId) > 0)) return null;
  // Revue Codex #1051 : une attente créée depuis la fiche garde sa qualité dans `releaseTitle` (« … • 4K ») ;
  // une qualité inconnue n'est jamais devinée (relancer en 1080p remplacerait le profil 4K du média).
  const qualityText = item.quality || item.releaseTitle || '';
  const qualityPreference = /4k|2160/i.test(qualityText) ? '4k' as const : /1080/.test(qualityText) ? '1080p' as const : null;
  if (!qualityPreference) return null;
  const isTv = item.mediaType === 'tv';
  const season = isTv && Number.isFinite(item.seasonNumber) ? Number(item.seasonNumber) : undefined;
  return {
    mediaType: item.mediaType,
    title: (isTv ? item.seriesTitle : item.movieTitle) || item.title,
    tmdbId: item.tmdbId,
    tvdbId: item.tvdbId,
    imdbId: item.imdbId,
    posterPath: item.posterPath,
    season,
    episode: season !== undefined && Number.isFinite(item.episodeNumber) ? Number(item.episodeNumber) : undefined,
    qualityPreference,
  };
}
