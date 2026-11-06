import { tmdb } from '../shows/tmdb';
import { fetchQualityProfiles, searchAndDownloadInRadarr, searchAndDownloadInSonarr } from '../../services/sonarrRadarr';
import { acceptDownloadRequest, beginDownloadRequest, failDownloadRequest, updateDownloadRequest } from './downloadLifecycle';
import { resolveEffectiveQualityProfileId } from './qualityProfileSelection';
import { downloadEpisodeWithSeasonPackFallback } from './episodeSeasonPackFallback';
import { availabilityHint, type DownloadAvailability } from './downloadAvailability';
import type { useDownloadConfigStore } from '../../store/downloadConfigStore';

export type DownloadQualityChoice = '1080p' | '4k';
type DownloadConfig = ReturnType<typeof useDownloadConfigStore.getState>;

export type DownloadActionResult = {
  success: boolean;
  message: string;
  failureCode?: 'no_release';
  availability?: DownloadAvailability;
  status?: 'searching' | 'queued';
  fallbackUsed?: boolean;
  downloadId?: string;
};

export interface ArrDownloadLaunch {
  config: DownloadConfig;
  mediaType: 'movie' | 'tv';
  title: string;
  year?: string | number;
  tmdbId?: number | string;
  tvdbId?: number | string;
  imdbId?: string;
  posterPath?: string;
  /** Saison ciblée (série) ; absente = toute la série. */
  season?: number;
  /** Épisode ciblé ; exige une saison. */
  episode?: number;
  qualityPreference: DownloadQualityChoice;
  replaceExisting?: boolean;
  notify: (action: string, toastType?: 'download' | 'success' | 'error' | 'info') => void;
  onStarted?: () => void;
}

/**
 * #879 — Lancement automatique Sonarr/Radarr partagé par la popup et le mode téléchargement de la fiche.
 * Corps déplacé tel quel depuis DownloadModal : mêmes demandes durables, profils de qualité, repli sur
 * le pack de saison et échecs explicites. Les gardes d'appel (configuration, demande active dans le même
 * périmètre, fichier présent) restent à la charge de l'appelant, avant tout lancement.
 */
export async function launchArrDownload({ config, mediaType, title, year, tmdbId, tvdbId, imdbId, posterPath, season, episode, qualityPreference, replaceExisting = false, notify, onStarted }: ArrDownloadLaunch): Promise<void> {
  const isTv = mediaType === 'tv';
  const scopeMode: 'all' | 'season' | 'episode' = !isTv || season === undefined ? 'all' : episode === undefined ? 'season' : 'episode';
  const client = isTv ? 'Sonarr' : 'Radarr';
  const qualityLabel = qualityPreference === '4k' ? '4K' : '1080p';
  const targetLabel = isTv
    ? scopeMode === 'all'
      ? 'Toute la série'
      : scopeMode === 'season'
        ? `Saison ${season}`
        : `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`
    : 'Film';
  const displayTitle = isTv ? `${title} (${targetLabel})` : title;

  const requestId = beginDownloadRequest({
    title: displayTitle,
    seriesTitle: isTv ? title : undefined,
    movieTitle: !isTv ? title : undefined,
    mediaType,
    tmdbId,
    tvdbId,
    imdbId,
    seasonNumber: season,
    episodeNumber: episode,
    posterPath,
    downloadClient: client,
    statusText: 'Demande prise en compte • préparation du téléchargement…',
    releaseTitle: `${displayTitle} • ${qualityLabel}`,
    quality: qualityLabel
  });

  notify(`Recherche ${qualityLabel} en cours…`, 'download');
  onStarted?.();

  try {
    let verifiedTvdbId = tvdbId;
    let verifiedImdbId = imdbId;
    if (isTv && tmdbId && !verifiedTvdbId && !verifiedImdbId) {
      const identityResult = await tmdb.getShowDetails(Number(tmdbId));
      if (identityResult.ok) {
        verifiedTvdbId = identityResult.value?.external_ids?.tvdb_id || undefined;
        verifiedImdbId = identityResult.value?.external_ids?.imdb_id || undefined;
      }
    }

    const configuredProfileId = isTv
      ? (qualityPreference === '4k' ? config.sonarr4kProfileId : config.sonarr1080pProfileId)
      : (qualityPreference === '4k' ? config.radarr4kProfileId : config.radarr1080pProfileId);
    const clientUrl = isTv ? config.sonarrUrl : config.radarrUrl;
    const clientApiKey = isTv ? config.sonarrApiKey : config.radarrApiKey;

    let effectiveProfileId = configuredProfileId ?? undefined;
    if (!effectiveProfileId) {
      const profiles = await fetchQualityProfiles(isTv ? 'sonarr' : 'radarr', clientUrl, clientApiKey);
      effectiveProfileId = resolveEffectiveQualityProfileId(profiles, qualityPreference);
      if (!effectiveProfileId) {
        throw new Error(`Aucun profil ${qualityLabel} compatible n’est disponible dans ${client}.`);
      }
    }

    const result: DownloadActionResult = isTv
      ? scopeMode === 'episode'
        ? await downloadEpisodeWithSeasonPackFallback({
            url: config.sonarrUrl,
            apiKey: config.sonarrApiKey,
            title,
            tmdbId,
            tvdbId: verifiedTvdbId,
            imdbId: verifiedImdbId,
            season: season!,
            episode: episode!,
            qualityPreference,
            replaceExisting,
            qualityProfileId: effectiveProfileId,
            qbittorrentUrl: config.qbittorrentUrl,
            qbittorrentUsername: config.qbittorrentUsername,
            qbittorrentPassword: config.qbittorrentPassword
          })
        : await searchAndDownloadInSonarr({
            url: config.sonarrUrl,
            apiKey: config.sonarrApiKey,
            title,
            tmdbId,
            tvdbId: verifiedTvdbId,
            imdbId: verifiedImdbId,
            season: scopeMode === 'all' ? undefined : season,
            qualityPreference,
            replaceExisting,
            qualityProfileId: effectiveProfileId
          })
      : await searchAndDownloadInRadarr({
          url: config.radarrUrl,
          apiKey: config.radarrApiKey,
          title,
          tmdbId,
          year,
          qualityPreference,
          replaceExisting,
          qualityProfileId: effectiveProfileId
        });

    if (result.success) {
      const nextStatus = result.status || 'searching';
      const statusText = result.message || `Demande acceptée • recherche ${qualityLabel} en cours`;
      acceptDownloadRequest(requestId, statusText, nextStatus);

      if (result.downloadId) {
        updateDownloadRequest(requestId, {
          downloadId: result.downloadId,
          downloadIdAliases: [result.downloadId],
          statusText
        });
      }

      if (result.fallbackUsed) {
        notify(statusText, 'download');
      }
    } else {
      failDownloadRequest(requestId, result.message, result.failureCode, result.availability);
      notify(result.failureCode === 'no_release'
        ? `En attente de disponibilité · ${availabilityHint(result.availability)}` : result.message,
        result.failureCode === 'no_release' ? 'download' : 'error');
    }
  } catch (error: unknown) {
    const message = (error instanceof Error && error.message) || `Impossible de joindre ${client}.`;
    failDownloadRequest(requestId, message);
    notify(message, 'error');
  }
}
