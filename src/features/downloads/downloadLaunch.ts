import { tmdb } from '../shows/tmdb';
import { fetchQualityProfiles, searchAndDownloadInRadarr, searchAndDownloadInSonarr } from '../../services/sonarrRadarr';
import { acceptDownloadRequest, beginDownloadRequest, failDownloadRequest, updateDownloadRequest } from './downloadLifecycle';
import { resolveEffectiveQualityProfileId } from './qualityProfileSelection';
import { downloadEpisodeWithSeasonPackFallback } from './episodeSeasonPackFallback';
import { type DownloadAvailability } from './downloadAvailability';
import { isDownloadFeatureEnabled } from './downloadFeatureVisibility';
import { auth } from '../../lib/firebase';
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
  packEpisodes?: number[];
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
  /** Autres épisodes de la même saison du lot, sélectionnés dans le pack si le repli l'utilise. */
  packEpisodes?: number[];
  notify: (action: string, toastType?: 'download' | 'success' | 'error' | 'info') => void;
  onStarted?: () => void;
}

/**
 * #879 — Lancement automatique Sonarr/Radarr partagé par la popup et le mode téléchargement de la fiche.
 * Corps déplacé tel quel depuis DownloadModal : mêmes demandes durables, profils de qualité, repli sur
 * le pack de saison et échecs explicites. Les gardes d'appel (configuration, demande active dans le même
 * périmètre, fichier présent) restent à la charge de l'appelant, avant tout lancement.
 */
export async function launchArrDownload({ config, mediaType, title, year, tmdbId, tvdbId, imdbId, posterPath, season, episode, qualityPreference, replaceExisting = false, packEpisodes, notify, onStarted }: ArrDownloadLaunch): Promise<number[]> {
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

  // Retour terrain du 08/11 : un seul toast, au lancement ; la suite (recherche, transfert, attente, échec)
  // se lit dans l'onglet Télécharger, avec le badge de la navigation pour un problème.
  notify(`Téléchargement lancé · ${qualityLabel}`, 'download');
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
            packEpisodes,
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

      return result.packEpisodes || [];
    } else {
      failDownloadRequest(requestId, result.message, result.failureCode, result.availability);
    }
  } catch (error: unknown) {
    const message = (error instanceof Error && error.message) || `Impossible de joindre ${client}.`;
    failDownloadRequest(requestId, message);
  }
  return [];
}

type ToastKind = 'download' | 'success' | 'error' | 'info';

export interface ArrEpisodeBatch extends Omit<ArrDownloadLaunch, 'config' | 'mediaType' | 'season' | 'episode' | 'notify' | 'onStarted' | 'replaceExisting'> {
  season: number;
  episodes: readonly number[];
  /** Configuration courante, relue avant chaque épisode. */
  readConfig: () => DownloadConfig;
  /** Garde d'appel par épisode : fichier présent ou demande active dans le même périmètre. */
  skip: (episode: number) => boolean;
  notify: (episode: number, action: string, toastType?: ToastKind) => void;
  /** Compte courant ; par défaut l'utilisateur Firebase connecté. */
  readOwner?: () => string | undefined;
  /** Renvoie les autres épisodes du lot que le pack de saison a couverts. */
  launch?: (input: ArrDownloadLaunch) => Promise<number[] | void>;
}

const sonarrTarget = (config: DownloadConfig) => `${config.sonarrUrl || ''}\n${config.sonarrApiKey || ''}`;

/**
 * #879 — Lot d'épisodes du mode téléchargement. Le lot reste attaché au compte, au gate personnel et au
 * serveur Sonarr qui l'ont lancé : ils sont relus avant chaque épisode et le lot s'arrête net si l'un
 * d'eux change (déconnexion, changement de compte, téléchargements désactivés, autre serveur), sans
 * jamais créer de demande au nom d'un autre compte. Rien n'est remplacé (replaceExisting reste faux).
 * Les épisodes suivants du lot sont proposés au repli : si un pack de saison sert, ils y sont
 * sélectionnés ensemble et ne sont pas relancés ensuite.
 */
export async function launchArrEpisodeBatch({ season, episodes, readConfig, skip, notify, readOwner = () => auth.currentUser?.uid, launch = launchArrDownload, ...media }: ArrEpisodeBatch): Promise<{ launched: number; interrupted: boolean }> {
  const owner = readOwner();
  const initial = readConfig();
  let launched = 0;
  if (!owner || !isDownloadFeatureEnabled(initial)) return { launched, interrupted: true };
  const covered = new Set<number>();
  for (const [index, episode] of episodes.entries()) {
    if (covered.has(episode)) continue;
    const config = readConfig();
    if (readOwner() !== owner || !isDownloadFeatureEnabled(config) || sonarrTarget(config) !== sonarrTarget(initial)) return { launched, interrupted: true };
    if (skip(episode)) continue;
    const packEpisodes = episodes.slice(index + 1).filter(next => !covered.has(next) && !skip(next));
    const inPack = await launch({ ...media, config, mediaType: 'tv', season, episode, packEpisodes, notify: (action, toastType) => notify(episode, action, toastType) });
    launched += 1;
    for (const extra of inPack || []) if (packEpisodes.includes(extra)) covered.add(extra);
  }
  return { launched, interrupted: false };
}
