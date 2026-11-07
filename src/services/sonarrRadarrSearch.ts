import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { C411Torrent } from './c411';
import { authenticatedFetch } from '../lib/apiAuth';
import { buildFreshGetUrl, buildNoCacheHeaders } from '../features/downloads/downloadNetwork';
import { extractQbitSessionCookie, isQbitAuthError } from '../features/downloads/qbitNativeSession';
import { getPhysicalDownloadId, isStrongTorrentHash, mergeDownloadIdAliases, normalizeDownloadClientId, normalizeQualityLabel, samePhysicalDownload, sameTransferPath } from '../features/downloads/downloadIdentity';
import { auth } from '../lib/firebase';
import { enableArrAvailabilityWatch } from './arrAvailabilityWatch';
import { buildQbitSessionScopeKey } from '../features/downloads/qbitSessionScope';
import { nextDownloadSourceBackoffMs, shouldFetchNextArrQueuePage } from '../features/downloads/downloadPollingPolicy';
import { executeDownloadMutationOnce } from '../features/downloads/downloadMutationPolicy';
import { shareDownloadSearch } from '../features/downloads/downloadSearchGuard';
import { getMagnetInfoHash, isSafeMagnetLink } from '../features/downloads/magnetLink';
import {
  findExactSonarrSeries,
  pushExactSonarrRelease,
  resolveCanonicalSeriesBridge,
  toExactSonarrSeriesIdentity,
  type ExactSonarrSeriesIdentity
} from '../features/downloads/sonarrCanonicalIdentity';
import { tmdb } from '../features/shows/tmdb';
import { confirmNoArrRelease, executeProvenArrSearch, requireArrReleaseArray, sonarrSeriesSearchQueries, type ArrRelease, type ArrSearchOutcome } from '../features/downloads/downloadNoRelease';
import {
  cleanUrl,
  executeArrInteractiveGet,
  executeArrInteractivePost,
  executeGet,
  executePost,
  executePut,
  loginQBittorrent,
  resolveQualityProfileId,
} from './sonarrRadarrTransport';

/**
 * Déclenche une recherche et un ajout automatique de Série dans Sonarr
 */
async function launchSearchAndDownloadInSonarr(params: {
  url: string;
  apiKey: string;
  title: string;
  tmdbId?: number | string;
  imdbId?: string;
  tvdbId?: number | string;
  season?: number;
  episode?: number;
  qualityProfileId?: number;
  qualityPreference?: '1080p' | '4k';
  ensureOnly?: boolean;
  replaceExisting?: boolean;
  /** Relu juste avant d'ajouter la série : compte, gate et serveur toujours ceux de l'appelant. */
  canWrite?: () => boolean;
}): Promise<ArrSearchOutcome & { target?: ExactSonarrSeriesIdentity }> {
  const base = cleanUrl(params.url);
  if (!base || !params.apiKey) {
    return { success: false, message: 'Configuration Sonarr incomplète (URL ou Clé API manquante)' };
  }

  const headers = {
    'X-Api-Key': params.apiKey,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };

  try {
    const requestedTmdbId = Number(params.tmdbId);
    if (!Number.isInteger(requestedTmdbId) || requestedTmdbId <= 0) {
      return {
        success: false,
        message: 'Identité Sonarr incomplète : le TMDB ID exact de la fiche est requis.'
      };
    }

    const tmdbDetails = await tmdb.getShowDetails(requestedTmdbId);
    const canonicalIdentity = tmdbDetails.ok
      ? resolveCanonicalSeriesBridge(requestedTmdbId, tmdbDetails.value)
      : null;
    if (!canonicalIdentity) {
      return {
        success: false,
        message: 'Impossible de vérifier le pont TMDB → TVDB de cette série ; aucun téléchargement n’a été lancé.'
      };
    }

    let targetQualityProfileId = params.qualityProfileId;
    if (!targetQualityProfileId) {
      let qualityProfiles: any[] = [];
      try {
        const qpRes = await executeGet(`${base}/api/v3/qualityprofile`, headers);
        if (Array.isArray(qpRes)) qualityProfiles = qpRes;
      } catch (e) {
        console.warn('[Sonarr] Erreur récupération qualityprofile:', e);
      }
      targetQualityProfileId = resolveQualityProfileId(qualityProfiles, params.qualityPreference);
    }

    const ensureEpisodeMonitored = async (episode: any) => {
      if (!episode?.id || episode.monitored === true) return;
      await executePut(`${base}/api/v3/episode/${episode.id}`, {
        ...episode,
        monitored: true
      }, headers);
    };

    const findEpisodeByNumber = async (
      seriesId: number,
      season: number,
      episode: number,
      attempts = 1
    ): Promise<any | null> => {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const episodes: any[] = await executeGet(`${base}/api/v3/episode?seriesId=${seriesId}`, headers);
        const target = Array.isArray(episodes)
          ? episodes.find((ep: any) =>
              Number(ep.seasonNumber) === Number(season) && Number(ep.episodeNumber) === Number(episode)
            )
          : null;
        if (target) return target;
        if (attempt < attempts - 1) {
          await new Promise(resolve => setTimeout(resolve, 450 * (attempt + 1)));
        }
      }
      return null;
    };

    // 1. Vérifier si la série est déjà présente dans la bibliothèque Sonarr
    let seriesList: any[] = [];
    try {
      seriesList = await executeGet(`${base}/api/v3/series`, headers);
    } catch (e: any) {
      console.warn('[Sonarr] Impossible de joindre Sonarr:', e);
      return {
        success: false,
        message: `Impossible de contacter Sonarr : ${e?.message || 'Vérifiez l\'adresse IP locale de votre PC'}`
      };
    }

    const existingSeries = findExactSonarrSeries(seriesList, canonicalIdentity);

    // 2. Si la série est déjà dans Sonarr -> Ajuster le profil si besoin & Déclencher la commande de recherche spécifique
    if (existingSeries && existingSeries.id) {
      const seriesId = Number(existingSeries.id);
      if (params.ensureOnly) {
        const target = toExactSonarrSeriesIdentity(existingSeries, canonicalIdentity);
        return target
          ? { success: true, message: 'Série Sonarr exacte vérifiée.', target }
          : { success: false, message: 'Sonarr ne fournit pas une identité exploitable pour la série TMDB exacte.' };
      }

      // Si le profil de qualité diffère, le mettre à jour
      if (existingSeries.qualityProfileId !== targetQualityProfileId) {
        try {
          await executePut(`${base}/api/v3/series`, {
            ...existingSeries,
            qualityProfileId: targetQualityProfileId
          }, headers);
        } catch (updateErr) {
          console.warn('[Sonarr] Impossible de mettre à jour le profil de qualité:', updateErr);
        }
      }

      // Recherche par épisode spécifique
      if (params.season !== undefined && params.episode !== undefined && params.season !== null && params.episode !== null) {
        try {
          const targetEp = await findEpisodeByNumber(
            Number(seriesId),
            Number(params.season),
            Number(params.episode),
            1
          );

          if (targetEp && targetEp.id) {
            await ensureEpisodeMonitored(targetEp);
            if (targetEp.hasFile && params.replaceExisting !== true) {
              return { success: false, message: 'Cet épisode est déjà disponible. Choisis explicitement une autre version pour le remplacer.' };
            }
            const search = await executeProvenArrSearch({
              queries: [`release?episodeId=${targetEp.id}`],
              read: path => executeArrInteractiveGet(`${base}/api/v3/${path}`, headers),
              preference: params.qualityPreference,
              launch: release => executeArrInteractivePost(`${base}/api/v3/release`, { ...release, episodeId: targetEp.id }, headers)
            });
            if (!search.success) return search;
            return {
              success: true,
              message: `Recherche lancée dans Sonarr pour « ${params.title} » S${String(params.season).padStart(2, '0')}E${String(params.episode).padStart(2, '0')} (${params.qualityPreference === '4k' ? '4K' : '1080p'}) !`
            };
          } else {
            console.warn(`[Sonarr] Épisode S${params.season}E${params.episode} non trouvé dans la liste d'épisodes de Sonarr.`);
            return {
              success: false,
              message: `Épisode S${String(params.season).padStart(2, '0')}E${String(params.episode).padStart(2, '0')} introuvable dans Sonarr.`
            };
          }
        } catch (epErr: any) {
          console.warn('[Sonarr Episode Search Error]', epErr);
          return {
            success: false,
            message: `Erreur recherche épisode Sonarr : ${epErr?.message || 'Erreur réseau'}`
          };
        }
      }

      // Recherche par saison entière
      if (params.season !== undefined && params.season !== null) {
        try {
          const seasonEpisodes: any[] = await executeGet(`${base}/api/v3/episode?seriesId=${seriesId}`, headers);
          const scopedEpisodes = Array.isArray(seasonEpisodes)
            ? seasonEpisodes.filter(ep => Number(ep.seasonNumber) === Number(params.season))
            : [];
          if (scopedEpisodes.length > 0 && scopedEpisodes.every(ep => Boolean(ep.hasFile)) && params.replaceExisting !== true) {
            return { success: false, message: 'Cette saison est déjà disponible. Choisis explicitement une autre version pour la remplacer.' };
          }
        } catch (presenceErr) {
          console.warn('[Sonarr] Impossible de vérifier la présence des fichiers de saison:', presenceErr);
        }

        const search = await executeProvenArrSearch({
          queries: [`release?seriesId=${seriesId}&seasonNumber=${params.season}`],
          coverSeason: true,
          read: path => executeArrInteractiveGet(`${base}/api/v3/${path}`, headers),
          preference: params.qualityPreference,
          launch: release => executeArrInteractivePost(`${base}/api/v3/release`, { ...release, seriesId, seasonNumber: params.season }, headers)
        });
        if (!search.success) return search;
        return {
          success: true,
          message: `Recherche lancée dans Sonarr pour la Saison ${params.season} de « ${params.title} » (${params.qualityPreference === '4k' ? '4K' : '1080p'}) !`
        };
      }

      // Recherche de toute la série
      try {
        const allEpisodes: any[] = await executeGet(`${base}/api/v3/episode?seriesId=${seriesId}`, headers);
        const regularEpisodes = Array.isArray(allEpisodes)
          ? allEpisodes.filter(ep => Number(ep.seasonNumber) > 0 && ep.airDateUtc)
          : [];
        if (regularEpisodes.length > 0 && regularEpisodes.every(ep => Boolean(ep.hasFile))) {
          return {
            success: false,
            message: 'La série est déjà complète. Choisis une saison ou un épisode pour forcer un nouveau téléchargement.'
          };
        }
      } catch {}

      const allEpisodes = await executeGet(`${base}/api/v3/episode?seriesId=${seriesId}`, headers);
      const search = await executeProvenArrSearch({
        queries: sonarrSeriesSearchQueries(seriesId, allEpisodes),
        coverSeason: true,
        allScopes: true,
        read: path => executeArrInteractiveGet(`${base}/api/v3/${path}`, headers),
        preference: params.qualityPreference,
        launch: release => executeArrInteractivePost(`${base}/api/v3/release`, { ...release, seriesId }, headers)
      });
      if (!search.success) return search;
      return {
        success: true,
        message: `Recherche lancée dans Sonarr pour toute la série « ${params.title} » (${params.qualityPreference === '4k' ? '4K' : '1080p'}) !`
      };
    }

    // 3. Si la série n'est pas dans Sonarr -> Faire un lookup pour obtenir les métadonnées TVDB/TheTVDB
    let lookupResult: any = null;
    const lookupTerms = [`tvdb:${canonicalIdentity.tvdbId}`];

    for (const term of lookupTerms) {
      try {
        const lookup = await executeGet(`${base}/api/v3/series/lookup?term=${encodeURIComponent(term!)}`, headers);
        if (Array.isArray(lookup) && lookup.length > 0) {
          lookupResult = findExactSonarrSeries(lookup, canonicalIdentity);
        }
        if (lookupResult) {
          break;
        }
      } catch (lErr) {
        console.warn(`[Sonarr Lookup failed for term ${term}]`, lErr);
      }
    }

    if (!lookupResult) {
      return {
        success: false,
        message: `Série « ${params.title} » non trouvée sur TheTVDB via Sonarr. Utilisez la liste des torrents C411 ci-dessous.`
      };
    }

    // Récupérer le root folder configuré dans Sonarr
    let rootFolders: any[] = [];
    try {
      const rfRes = await executeGet(`${base}/api/v3/rootfolder`, headers);
      if (Array.isArray(rfRes)) rootFolders = rfRes;
    } catch (e) {
      console.warn('[Sonarr] Erreur récupération rootfolder:', e);
    }

    // Déterminer le meilleur chemin racine valide
    let rootFolderPath = '';
    if (rootFolders.length > 0) {
      const accessibleFolder = rootFolders.find((rf: { accessible?: boolean; path?: string }) => rf.accessible !== false && rf.path);
      rootFolderPath = accessibleFolder ? accessibleFolder.path : rootFolders[0].path;
    } else if (Array.isArray(seriesList) && seriesList.length > 0) {
      const sWithRoot = seriesList.find((s: any) => s.rootFolderPath);
      if (sWithRoot) {
        rootFolderPath = sWithRoot.rootFolderPath;
      } else {
        const sWithPath = seriesList.find((s: any) => s.path);
        if (sWithPath && sWithPath.path) {
          const p = sWithPath.path;
          const lastSep = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
          if (lastSep > 0) rootFolderPath = p.substring(0, lastSep);
        }
      }
    }

    if (!rootFolderPath) {
      return {
        success: false,
        message: `Sonarr : Aucun dossier racine ("Root Folder") n'est configuré dans votre serveur Sonarr. Veuillez en ajouter un dans Sonarr (Paramètres > Gestion des médias > Dossiers racine).`
      };
    }

    const isEpisodeSearch = params.season !== undefined && params.episode !== undefined && params.season !== null && params.episode !== null;
    const isSeasonSearch = !isEpisodeSearch && params.season !== undefined && params.season !== null;

    // Ajouter la série dans Sonarr avec recherche ciblée
    const addPayload: any = {
      title: lookupResult.title,
      seasons: Array.isArray(lookupResult.seasons) ? lookupResult.seasons.map((s: { seasonNumber?: number }) => ({
        ...s,
        monitored: (!isEpisodeSearch && !isSeasonSearch) || (isSeasonSearch && Number(s.seasonNumber) === Number(params.season)) || (isEpisodeSearch && Number(s.seasonNumber) === Number(params.season))
      })) : [],
      rootFolderPath,
      qualityProfileId: targetQualityProfileId,
      monitored: true,
      seasonFolder: true,
      tvdbId: lookupResult.tvdbId,
      year: lookupResult.year,
      titleSlug: lookupResult.titleSlug,
      images: lookupResult.images || [],
      addOptions: {
        // La recherche observable du scope exact sera lancée après l'ajout confirmé.
        searchForMissingEpisodes: false,
        monitor: (!params.ensureOnly && !isEpisodeSearch && !isSeasonSearch) ? 'all' : 'none'
      }
    };
    if (lookupResult.seriesType) addPayload.seriesType = lookupResult.seriesType;
    if (lookupResult.overview) addPayload.overview = lookupResult.overview;

    if (params.canWrite && !params.canWrite()) return { success: false, message: 'La configuration a changé : rien n’a été ajouté.' };
    const created = await executePost(`${base}/api/v3/series`, addPayload, headers);

    if (created && created.id) {
      if (params.ensureOnly) {
        const target = toExactSonarrSeriesIdentity(
          { ...lookupResult, ...created, tvdbId: canonicalIdentity.tvdbId },
          canonicalIdentity
        );
        return target
          ? { success: true, message: 'Série Sonarr exacte ajoutée sans recherche automatique.', target }
          : { success: false, message: 'Sonarr a ajouté la série sans confirmer son identité exacte.' };
      }
      if (isEpisodeSearch) {
        try {
          const targetEp = await findEpisodeByNumber(
            Number(created.id),
            Number(params.season),
            Number(params.episode),
            4
          );

          if (targetEp && targetEp.id) {
            await ensureEpisodeMonitored(targetEp);
            const search = await executeProvenArrSearch({
              queries: [`release?episodeId=${targetEp.id}`],
              read: path => executeArrInteractiveGet(`${base}/api/v3/${path}`, headers),
              preference: params.qualityPreference,
              launch: release => executeArrInteractivePost(`${base}/api/v3/release`, { ...release, episodeId: targetEp.id }, headers)
            });
            if (!search.success) return search;
            return {
              success: true,
              message: `« ${params.title} » ajoutée à Sonarr ! Recherche de l'épisode S${String(params.season).padStart(2, '0')}E${String(params.episode).padStart(2, '0')} lancée.`
            };
          }
        } catch (epErr) {
          return { success: false, message: epErr instanceof Error ? epErr.message : 'Recherche épisode Sonarr indisponible.' };
        }
        return { success: false, message: 'Sonarr n’a pas encore confirmé l’épisode exact.' };
      } else if (isSeasonSearch) {
        const search = await executeProvenArrSearch({
          queries: [`release?seriesId=${created.id}&seasonNumber=${params.season}`],
          coverSeason: true,
          read: path => executeArrInteractiveGet(`${base}/api/v3/${path}`, headers),
          preference: params.qualityPreference,
          launch: release => executeArrInteractivePost(`${base}/api/v3/release`, { ...release, seriesId: created.id, seasonNumber: params.season }, headers)
        });
        if (!search.success) return search;
        return {
          success: true,
          message: `« ${params.title} » ajoutée à Sonarr ! Recherche de la Saison ${params.season} lancée.`
        };
      }
      const episodes = await executeGet(`${base}/api/v3/episode?seriesId=${created.id}`, headers);
      return executeProvenArrSearch({
        queries: sonarrSeriesSearchQueries(Number(created.id), episodes),
        coverSeason: true,
        allScopes: true,
        read: path => executeArrInteractiveGet(`${base}/api/v3/${path}`, headers),
        preference: params.qualityPreference,
        launch: release => executeArrInteractivePost(`${base}/api/v3/release`, { ...release, seriesId: created.id }, headers)
      });
    }

    return {
      success: false,
      message: 'Sonarr n’a pas confirmé l’ajout de la série exacte.'
    };

  } catch (err: any) {
    console.error('[Sonarr Search & Download Error]', err);
    return {
      success: false,
      message: `Erreur Sonarr : ${err?.message || 'Impossible de joindre le serveur Sonarr'}`
    };
  }
}

/**
 * Déclenche une recherche et un ajout automatique de Film dans Radarr
 */
async function launchSearchAndDownloadInRadarr(params: {
  url: string;
  apiKey: string;
  title: string;
  tmdbId?: number | string;
  imdbId?: string;
  year?: number | string;
  qualityProfileId?: number;
  qualityPreference?: '1080p' | '4k';
  ensureOnly?: boolean;
  replaceExisting?: boolean;
  /** Relu juste avant d'ajouter le film : compte, gate et serveur toujours ceux de l'appelant. */
  canWrite?: () => boolean;
}): Promise<ArrSearchOutcome & { target?: { movieId: number; tmdbId: number } }> {
  const base = cleanUrl(params.url);
  if (!base || !params.apiKey) {
    return { success: false, message: 'Configuration Radarr incomplète' };
  }

  const headers = {
    'X-Api-Key': params.apiKey,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };

  try {
    if (!Number.isInteger(Number(params.tmdbId)) || Number(params.tmdbId) <= 0) {
      return {
        success: false,
        message: 'Identité Radarr incomplète : un identifiant TMDB vérifié est requis.'
      };
    }

    let targetQualityProfileId = params.qualityProfileId;
    if (!targetQualityProfileId) {
      let qualityProfiles: any[] = [];
      try {
        const qpRes = await executeGet(`${base}/api/v3/qualityprofile`, headers);
        if (Array.isArray(qpRes)) qualityProfiles = qpRes;
      } catch (e) {
        console.warn('[Radarr] Erreur récupération qualityprofile:', e);
      }
      targetQualityProfileId = resolveQualityProfileId(qualityProfiles, params.qualityPreference);
    }

    // 1. Vérifier si le film est déjà dans Radarr
    const moviesList = await executeGet(`${base}/api/v3/movie`, headers);
    if (!Array.isArray(moviesList)) throw new Error('Réponse Radarr invalide : aucun ajout lancé.');
    let existingMovie: any = null;
    if (Array.isArray(moviesList)) {
      existingMovie = moviesList.find((m: any) => {
        if (params.tmdbId && m.tmdbId && Number(m.tmdbId) === Number(params.tmdbId)) return true;
        return false;
      });
    }

    if (existingMovie && existingMovie.id) {
      if (params.ensureOnly) return { success: true, message: 'Film exact déjà présent dans Radarr.',
        target: { movieId: Number(existingMovie.id), tmdbId: Number(params.tmdbId) } };
      // Ajuster le profil de qualité si différent
      if (existingMovie.qualityProfileId !== targetQualityProfileId) {
        try {
          await executePut(`${base}/api/v3/movie`, {
            ...existingMovie,
            qualityProfileId: targetQualityProfileId
          }, headers);
        } catch (uErr) {
          console.warn('[Radarr] Impossible de mettre à jour le profil de qualité du film:', uErr);
        }
      }

      if (existingMovie.hasFile && params.replaceExisting !== true) {
        return { success: false, message: 'Ce film est déjà disponible. Choisis explicitement une autre version pour le remplacer.' };
      }

      const search = await executeProvenArrSearch({
        queries: [`release?movieId=${existingMovie.id}`],
        read: path => executeArrInteractiveGet(`${base}/api/v3/${path}`, headers),
        preference: params.qualityPreference,
        launch: release => executeArrInteractivePost(`${base}/api/v3/release`, { ...release, movieId: existingMovie.id }, headers)
      });
      if (!search.success) return search;
      return {
        success: true,
        message: `Recherche lancée dans Radarr pour « ${params.title} » (${params.qualityPreference === '4k' ? '4K' : '1080p'}) !`
      };
    }

    // 2. Lookup du film
    let lookupResult: any = null;
    const lookupTerms = [`tmdb:${params.tmdbId}`];

    for (const term of lookupTerms) {
      try {
        const lookup = await executeGet(`${base}/api/v3/movie/lookup?term=${encodeURIComponent(term!)}`, headers);
        if (Array.isArray(lookup) && lookup.length > 0) {
          lookupResult = lookup.find((candidate: any) =>
            candidate?.tmdbId && Number(candidate.tmdbId) === Number(params.tmdbId)
          ) || null;
        }
        if (lookupResult) {
          break;
        }
      } catch (e) {}
    }

    if (!lookupResult) {
      return {
        success: false,
        message: `Film « ${params.title} » introuvable sur Radarr.`
      };
    }

    // Récupérer le root folder
    let rootFolders: any[] = [];
    try {
      const rfRes = await executeGet(`${base}/api/v3/rootfolder`, headers);
      if (Array.isArray(rfRes)) rootFolders = rfRes;
    } catch (e) {
      console.warn('[Radarr] Erreur récupération rootfolder:', e);
    }

    let rootFolderPath = '';
    if (rootFolders.length > 0) {
      const accessibleFolder = rootFolders.find((rf: { accessible?: boolean; path?: string }) => rf.accessible !== false && rf.path);
      rootFolderPath = accessibleFolder ? accessibleFolder.path : rootFolders[0].path;
    } else if (Array.isArray(moviesList) && moviesList.length > 0) {
      const mWithRoot = moviesList.find((m: any) => m.rootFolderPath);
      if (mWithRoot) {
        rootFolderPath = mWithRoot.rootFolderPath;
      } else {
        const mWithPath = moviesList.find((m: any) => m.path);
        if (mWithPath && mWithPath.path) {
          const p = mWithPath.path;
          const lastSep = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
          if (lastSep > 0) rootFolderPath = p.substring(0, lastSep);
        }
      }
    }

    if (!rootFolderPath) {
      return {
        success: false,
        message: `Radarr : Aucun dossier racine ("Root Folder") n'est configuré dans votre serveur Radarr. Veuillez en ajouter un dans Radarr (Paramètres > Gestion des médias > Dossiers racine).`
      };
    }

    const addPayload: any = {
      title: lookupResult.title,
      rootFolderPath,
      qualityProfileId: targetQualityProfileId,
      monitored: true,
      tmdbId: lookupResult.tmdbId,
      year: lookupResult.year,
      titleSlug: lookupResult.titleSlug,
      images: lookupResult.images || [],
      addOptions: {
        searchForMovie: false
      }
    };
    if (lookupResult.overview) addPayload.overview = lookupResult.overview;

    if (params.canWrite && !params.canWrite()) return { success: false, message: 'La configuration a changé : rien n’a été ajouté.' };
    const created: { id?: number; tmdbId?: number } = await executePost(`${base}/api/v3/movie`, addPayload, headers);
    if (!created?.id) return { success: false, message: 'Radarr n’a pas confirmé l’ajout du film exact.' };
    if (params.ensureOnly) {
      if (!Number.isInteger(created.id) || Number(created.id) <= 0 || Number(created.tmdbId) !== Number(params.tmdbId)) {
        return { success: false, message: 'Le film ajouté ne peut pas être vérifié ; aucune release envoyée.' };
      }
      return { success: true, message: 'Film exact ajouté sans recherche automatique.',
        target: { movieId: Number(created.id), tmdbId: Number(params.tmdbId) } };
    }
    return executeProvenArrSearch({
      queries: [`release?movieId=${created.id}`],
      read: path => executeArrInteractiveGet(`${base}/api/v3/${path}`, headers),
      preference: params.qualityPreference,
      launch: release => executeArrInteractivePost(`${base}/api/v3/release`, { ...release, movieId: created.id }, headers)
    });
  } catch (err: any) {
    console.error('[Radarr Search & Download Error]', err);
    return {
      success: false,
      message: `Erreur Radarr : ${err?.message || 'Impossible de joindre Radarr'}`
    };
  }
}

/**
 * Envoie directement une release (Torrent / Magnet) vers Sonarr / Radarr / qBittorrent
 */
async function launchPushReleaseDirectly(payload: {
  service: 'sonarr' | 'radarr' | 'qbittorrent';
  url: string;
  apiKey?: string;
  username?: string;
  password?: string;
  torrent: C411Torrent;
  mediaType: 'movie' | 'tv';
  /**
   * undefined conserve le routage historique par type pour une fiche SeenIt ;
   * null force un téléchargement qBittorrent manuel sans catégorie *Arr.
   */
  qbittorrentCategory?: string | null;
  mediaInfo?: {
    title: string;
    tmdbId?: number | string;
    tvdbId?: number | string;
    imdbId?: string;
    year?: number | string;
    season?: number;
    episode?: number;
  };
}): Promise<{ success: boolean; message: string }> {
  const base = cleanUrl(payload.url);
  if (!base) return { success: false, message: 'URL du client manquante' };

  if (!isSafeMagnetLink(payload.torrent.magnetUri)) {
    return { success: false, message: 'Lien Magnet absent ou invalide pour ce torrent' };
  }

  try {
    // 1. Sonarr Release Push
    if (payload.service === 'sonarr') {
      if (!payload.apiKey) return { success: false, message: 'Clé API Sonarr manquante' };
      if (!payload.mediaInfo?.title || !payload.mediaInfo.tmdbId) {
        return {
          success: false,
          message: 'Le TMDB ID exact de la fiche est requis pour envoyer une release à Sonarr.'
        };
      }

      const endpoint = `${base}/api/v3/release/push`;
      const headers = {
        'X-Api-Key': payload.apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      };

      const exactSeries = await searchAndDownloadInSonarr({
        url: payload.url,
        apiKey: payload.apiKey,
        title: payload.mediaInfo.title,
        tmdbId: payload.mediaInfo.tmdbId,
        season: payload.mediaInfo.season,
        episode: payload.mediaInfo.episode,
        ensureOnly: true
      });
      if (!exactSeries.success || !exactSeries.target) return exactSeries;

      return pushExactSonarrRelease({
        releaseTitle: payload.torrent.name,
        magnetUri: payload.torrent.magnetUri,
        publishDate: payload.torrent.createdAt || new Date().toISOString(),
        exact: exactSeries.target
      }, {
        parseReleaseTitle: title => executeGet(
          `${base}/api/v3/parse?title=${encodeURIComponent(title)}`,
          headers
        ),
        postRelease: body => executePost(endpoint, body, headers)
      });
    }

    // 2. Radarr Release Push
    if (payload.service === 'radarr') {
      if (!payload.apiKey) return { success: false, message: 'Clé API Radarr manquante' };
      if (!payload.mediaInfo?.tmdbId) return { success: false, message: 'Le TMDB ID exact de la fiche est requis pour Radarr.' };
      const ensured = await searchAndDownloadInRadarr({ url: payload.url, apiKey: payload.apiKey,
        title: payload.mediaInfo.title, tmdbId: payload.mediaInfo.tmdbId, year: payload.mediaInfo.year, ensureOnly: true });
      if (!ensured.success || !ensured.target) return ensured;
      const parsed: { movie?: { id?: number; tmdbId?: number } } = await executeGet(
        `${base}/api/v3/parse?title=${encodeURIComponent(payload.torrent.name)}`, { 'X-Api-Key': payload.apiKey, Accept: 'application/json' });
      if (Number(parsed?.movie?.id) !== ensured.target.movieId || Number(parsed?.movie?.tmdbId) !== ensured.target.tmdbId) {
        return { success: false, message: 'Radarr ne peut pas prouver le film exact de cette release ; aucun téléchargement lancé.' };
      }
      const endpoint = `${base}/api/v3/release/push`;
      const body = {
        title: payload.torrent.name,
        downloadUrl: payload.torrent.magnetUri,
        protocol: 'torrent',
        tmdbId: ensured.target.tmdbId,
        publishDate: payload.torrent.createdAt || new Date().toISOString()
      };

      const resData = await executePost(endpoint, body, {
        'X-Api-Key': payload.apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      });

      const releaseResult = Array.isArray(resData) ? resData[0] : resData;
      if (releaseResult?.mappedMovieId && Number(releaseResult.mappedMovieId) !== ensured.target.movieId) {
        return { success: false, message: 'Radarr a renvoyé un autre film ; résultat rejeté.' };
      }
      let rejections: string[] = [];
      if (releaseResult) {
        if (Array.isArray(releaseResult.rejections) && releaseResult.rejections.length > 0) {
          rejections = releaseResult.rejections;
        } else if (releaseResult.approved === false) {
          rejections = ['Release non approuvée par Radarr'];
        }
      }

      if (rejections.length > 0) {
        const reasonStr = rejections.join(' • ');

        return {
          success: false,
          message: `Radarr a refusé la release : ${reasonStr}.`
        };
      }

      return { success: true, message: 'Torrent envoyé avec succès à Radarr !' };
    }

    // 3. qBittorrent Web UI
    if (payload.service === 'qbittorrent') {
      let cookieHeader = '';
      if (payload.username || payload.password) {
        const loginRes = await loginQBittorrent(base, payload.username, payload.password);
        if (!loginRes.success) {
          return {
            success: false,
            message: loginRes.message || 'Échec d\'authentification qBittorrent'
          };
        }
        cookieHeader = loginRes.cookie || '';
      }

      const defaultCategory = payload.mediaType === 'tv' ? 'tv' : 'movies';
      const requestedCategory = payload.qbittorrentCategory === undefined
        ? defaultCategory
        : payload.qbittorrentCategory;
      const categoryField = requestedCategory?.trim()
        ? `&category=${encodeURIComponent(requestedCategory.trim())}`
        : '';
      const formBody = `urls=${encodeURIComponent(payload.torrent.magnetUri)}${categoryField}`;
      const qbitHeaders: Record<string, string> = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': base,
        'Origin': base
      };
      if (cookieHeader) qbitHeaders['Cookie'] = cookieHeader;

      try {
        await executePost(`${base}/api/v2/torrents/add`, formBody, qbitHeaders);
        return { success: true, message: 'Torrent ajouté directement à qBittorrent !' };
      } catch (err: unknown) {
        const errMessage = err instanceof Error ? err.message : String(err);
        if (!payload.username && !payload.password && (errMessage.includes('403') || errMessage.includes('401'))) {
          return {
            success: false,
            message: 'Authentification qBittorrent requise : renseignez votre nom d\'utilisateur et mot de passe'
          };
        }
        throw err;
      }
    }

    return { success: false, message: 'Service non supporté' };
  } catch (err: unknown) {
    return {
      success: false,
      message: `Erreur lors de l'envoi : ${err instanceof Error ? err.message : 'Vérifiez la connexion avec votre serveur'}`
    };
  }
}

export function searchAndDownloadInSonarr(params: Parameters<typeof launchSearchAndDownloadInSonarr>[0]) {
  const ownerUid = auth.currentUser?.uid;
  const key = JSON.stringify([auth.currentUser?.uid, 'sonarr', cleanUrl(params.url), params.tmdbId,
    params.season ?? null, params.episode ?? null, params.ensureOnly === true, params.replaceExisting === true]);
  return shareDownloadSearch(key, async () => {
    const result = await launchSearchAndDownloadInSonarr(params);
    return result.failureCode === 'no_release'
      ? { ...result, availability: await enableArrAvailabilityWatch({ ...params, service: 'sonarr', ownerUid }) } : result;
  });
}

export function searchAndDownloadInRadarr(params: Parameters<typeof launchSearchAndDownloadInRadarr>[0]) {
  const ownerUid = auth.currentUser?.uid;
  const key = JSON.stringify([auth.currentUser?.uid, 'radarr', cleanUrl(params.url), params.tmdbId, params.ensureOnly === true, params.replaceExisting === true]);
  return shareDownloadSearch(key, async () => {
    const result = await launchSearchAndDownloadInRadarr(params);
    return result.failureCode === 'no_release'
      ? { ...result, availability: await enableArrAvailabilityWatch({ ...params, service: 'radarr', ownerUid }) } : result;
  });
}

export function pushReleaseDirectly(payload: Parameters<typeof launchPushReleaseDirectly>[0]) {
  const key = JSON.stringify([auth.currentUser?.uid, payload.service, cleanUrl(payload.url), payload.mediaType,
    payload.mediaInfo?.tmdbId ?? null, getMagnetInfoHash(payload.torrent.magnetUri)]);
  return shareDownloadSearch(key, () => launchPushReleaseDirectly(payload));
}
