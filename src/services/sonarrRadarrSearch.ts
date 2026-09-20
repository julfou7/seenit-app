import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { C411Torrent } from './c411';
import { authenticatedFetch } from '../lib/apiAuth';
import { buildFreshGetUrl, buildNoCacheHeaders } from '../features/downloads/downloadNetwork';
import { extractQbitSessionCookie, isQbitAuthError } from '../features/downloads/qbitNativeSession';
import { getPhysicalDownloadId, isStrongTorrentHash, mergeDownloadIdAliases, normalizeDownloadClientId, normalizeQualityLabel, samePhysicalDownload, sameTransferPath } from '../features/downloads/downloadIdentity';
import { auth } from '../lib/firebase';
import { buildQbitSessionScopeKey } from '../features/downloads/qbitSessionScope';
import { nextDownloadSourceBackoffMs, shouldFetchNextArrQueuePage } from '../features/downloads/downloadPollingPolicy';
import { executeDownloadMutationOnce } from '../features/downloads/downloadMutationPolicy';
import { isSafeMagnetLink } from '../features/downloads/magnetLink';
import {
  findExactSonarrSeries,
  pushExactSonarrRelease,
  resolveCanonicalSeriesBridge,
  toExactSonarrSeriesIdentity,
  type ExactSonarrSeriesIdentity
} from '../features/downloads/sonarrCanonicalIdentity';
import { tmdb } from '../features/shows/tmdb';
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

function releaseMatchesQualityPreference(release: any, preference?: '1080p' | '4k'): boolean {
  if (!preference) return true;
  const qualityName = release?.quality?.quality?.name || release?.quality?.name || '';
  const resolution = release?.quality?.quality?.resolution || release?.quality?.resolution || '';
  const haystack = `${qualityName} ${resolution} ${release?.title || ''}`.toLowerCase();
  if (preference === '4k') return /2160|4k|uhd/.test(haystack);
  return /1080/.test(haystack) && !/2160|4k|uhd/.test(haystack);
}

function hasOnlyExistingMediaRejections(release: any): boolean {
  const rejections = Array.isArray(release?.rejections) ? release.rejections.filter(Boolean) : [];
  if (!rejections.length) return true;
  return rejections.every((reason: any) => /existing file/i.test(String(reason)));
}

function rankInteractiveReleases(releases: any[], preference?: '1080p' | '4k', preferSeasonPack = false): any[] {
  return releases
    .filter(release => releaseMatchesQualityPreference(release, preference))
    .filter(release => release?.approved === true || hasOnlyExistingMediaRejections(release))
    .sort((a, b) => {
      if (preferSeasonPack && Boolean(a.fullSeason) !== Boolean(b.fullSeason)) return a.fullSeason ? -1 : 1;
      if (Boolean(a.approved) !== Boolean(b.approved)) return a.approved ? -1 : 1;
      const weightA = Number(a.releaseWeight ?? Number.MAX_SAFE_INTEGER);
      const weightB = Number(b.releaseWeight ?? Number.MAX_SAFE_INTEGER);
      if (weightA !== weightB) return weightA - weightB;
      const cfA = Number(a.customFormatScore || 0);
      const cfB = Number(b.customFormatScore || 0);
      if (cfA !== cfB) return cfB - cfA;
      return Number(b.seeders || 0) - Number(a.seeders || 0);
    });
}

async function grabFirstWorkingRelease(
  base: string,
  headers: Record<string, string>,
  releases: any[],
  contextPatch: Record<string, any> = {}
): Promise<{ success: boolean; release?: any; error?: string }> {
  let lastError = '';
  for (const release of releases.slice(0, 8)) {
    try {
      await executeArrInteractivePost(`${base}/api/v3/release`, { ...release, ...contextPatch }, headers);
      return { success: true, release };
    } catch (error: any) {
      lastError = error?.message || String(error);
      // Une release peut être refusée par qBittorrent car elle est déjà présente :
      // on essaie alors la release suivante plutôt que d'abandonner tout le flux.
    }
  }
  return { success: false, error: lastError || 'Aucune release compatible n’a pu être lancée.' };
}

async function forceGrabExistingEpisode(
  base: string,
  headers: Record<string, string>,
  episodeId: number,
  preference?: '1080p' | '4k'
): Promise<{ success: boolean; message: string }> {
  const releases = await executeArrInteractiveGet(`${base}/api/v3/release?episodeId=${episodeId}`, headers);
  const ranked = rankInteractiveReleases(Array.isArray(releases) ? releases : [], preference);
  if (!ranked.length) return { success: false, message: 'Le fichier existe déjà et aucune nouvelle release compatible n’a été trouvée.' };
  const grabbed = await grabFirstWorkingRelease(base, headers, ranked, { episodeId });
  return grabbed.success
    ? { success: true, message: 'Le fichier existe déjà : une nouvelle release a été forcée.' }
    : { success: false, message: grabbed.error || 'Impossible de relancer cet épisode.' };
}

async function forceGrabExistingSeason(
  base: string,
  headers: Record<string, string>,
  seriesId: number,
  seasonNumber: number,
  preference?: '1080p' | '4k'
): Promise<{ success: boolean; message: string }> {
  const releases = await executeArrInteractiveGet(
    `${base}/api/v3/release?seriesId=${seriesId}&seasonNumber=${seasonNumber}`,
    headers
  );
  const ranked = rankInteractiveReleases(Array.isArray(releases) ? releases : [], preference, true);
  if (!ranked.length) return { success: false, message: 'La saison existe déjà et aucune nouvelle release compatible n’a été trouvée.' };

  const seasonPack = ranked.filter(release => release.fullSeason);
  if (seasonPack.length) {
    const grabbed = await grabFirstWorkingRelease(base, headers, seasonPack, { seriesId });
    if (grabbed.success) return { success: true, message: 'La saison existe déjà : un nouveau pack a été forcé.' };
  }

  // Pas de pack : on force au maximum une release par épisode depuis le résultat
  // interactif déjà récupéré, sans relancer une recherche indexer pour chaque épisode.
  const episodeNumbers = new Set<number>();
  for (const release of ranked) {
    const mapped = Array.isArray(release.mappedEpisodeNumbers)
      ? release.mappedEpisodeNumbers
      : (Array.isArray(release.episodeNumbers) ? release.episodeNumbers : []);
    mapped.forEach((n: any) => Number.isFinite(Number(n)) && episodeNumbers.add(Number(n)));
  }

  let grabbedCount = 0;
  for (const episodeNumber of Array.from(episodeNumbers).sort((a, b) => a - b)) {
    const candidates = ranked.filter(release => {
      if (release.fullSeason) return false;
      const mapped = Array.isArray(release.mappedEpisodeNumbers)
        ? release.mappedEpisodeNumbers
        : (Array.isArray(release.episodeNumbers) ? release.episodeNumbers : []);
      return mapped.some((n: any) => Number(n) === episodeNumber);
    });
    if (!candidates.length) continue;
    const grabbed = await grabFirstWorkingRelease(base, headers, candidates, { seriesId });
    if (grabbed.success) grabbedCount++;
  }

  return grabbedCount > 0
    ? { success: true, message: `La saison existe déjà : ${grabbedCount} téléchargement(s) ont été forcés.` }
    : { success: false, message: 'La saison existe déjà mais aucune release n’a pu être relancée.' };
}

async function forceGrabExistingMovie(
  base: string,
  headers: Record<string, string>,
  movieId: number,
  preference?: '1080p' | '4k'
): Promise<{ success: boolean; message: string }> {
  const releases = await executeArrInteractiveGet(`${base}/api/v3/release?movieId=${movieId}`, headers);
  const ranked = rankInteractiveReleases(Array.isArray(releases) ? releases : [], preference);
  if (!ranked.length) return { success: false, message: 'Le film existe déjà et aucune nouvelle release compatible n’a été trouvée.' };
  const grabbed = await grabFirstWorkingRelease(base, headers, ranked, { movieId });
  return grabbed.success
    ? { success: true, message: 'Le film existe déjà : une nouvelle release a été forcée.' }
    : { success: false, message: grabbed.error || 'Impossible de relancer ce film.' };
}

/**
 * Déclenche une recherche et un ajout automatique de Série dans Sonarr
 */
export async function searchAndDownloadInSonarr(params: {
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
}): Promise<{ success: boolean; message: string; target?: ExactSonarrSeriesIdentity }> {
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
            if (targetEp.hasFile) {
              return await forceGrabExistingEpisode(base, headers, targetEp.id, params.qualityPreference);
            }
            await executePost(`${base}/api/v3/command`, {
              name: 'EpisodeSearch',
              episodeIds: [targetEp.id]
            }, headers);
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
          if (scopedEpisodes.length > 0 && scopedEpisodes.every(ep => Boolean(ep.hasFile))) {
            return await forceGrabExistingSeason(base, headers, seriesId, Number(params.season), params.qualityPreference);
          }
        } catch (presenceErr) {
          console.warn('[Sonarr] Impossible de vérifier la présence des fichiers de saison:', presenceErr);
        }

        await executePost(`${base}/api/v3/command`, {
          name: 'SeasonSearch',
          seriesId: seriesId,
          seasonNumber: params.season
        }, headers);
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

      await executePost(`${base}/api/v3/command`, {
        name: 'SeriesSearch',
        seriesId: seriesId
      }, headers);
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
      const accessibleFolder = rootFolders.find((rf: any) => rf.accessible !== false && rf.path);
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
      seasons: Array.isArray(lookupResult.seasons) ? lookupResult.seasons.map((s: any) => ({
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
        // Empêche la recherche globale de toute la série si un épisode ou une saison est spécifié
        searchForMissingEpisodes: !params.ensureOnly && !isEpisodeSearch && !isSeasonSearch,
        monitor: (!params.ensureOnly && !isEpisodeSearch && !isSeasonSearch) ? 'all' : 'none'
      }
    };
    if (lookupResult.seriesType) addPayload.seriesType = lookupResult.seriesType;
    if (lookupResult.overview) addPayload.overview = lookupResult.overview;

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
            await executePost(`${base}/api/v3/command`, {
              name: 'EpisodeSearch',
              episodeIds: [targetEp.id]
            }, headers);
            return {
              success: true,
              message: `« ${params.title} » ajoutée à Sonarr ! Recherche de l'épisode S${String(params.season).padStart(2, '0')}E${String(params.episode).padStart(2, '0')} lancée.`
            };
          }
        } catch (epErr) {
          console.warn('[Sonarr Episode Search Error after Add]', epErr);
        }
      } else if (isSeasonSearch) {
        await executePost(`${base}/api/v3/command`, {
          name: 'SeasonSearch',
          seriesId: created.id,
          seasonNumber: params.season
        }, headers).catch(() => {});
        return {
          success: true,
          message: `« ${params.title} » ajoutée à Sonarr ! Recherche de la Saison ${params.season} lancée.`
        };
      }
    }

    return {
      success: true,
      message: `« ${params.title} » ajoutée à Sonarr ! Recherche (${params.qualityPreference === '4k' ? '4K' : '1080p'}) en cours.`
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
export async function searchAndDownloadInRadarr(params: {
  url: string;
  apiKey: string;
  title: string;
  tmdbId?: number | string;
  imdbId?: string;
  year?: number | string;
  qualityProfileId?: number;
  qualityPreference?: '1080p' | '4k';
}): Promise<{ success: boolean; message: string }> {
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
    if (!params.tmdbId) {
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
    const moviesList = await executeGet(`${base}/api/v3/movie`, headers).catch(() => []);
    let existingMovie: any = null;
    if (Array.isArray(moviesList)) {
      existingMovie = moviesList.find((m: any) => {
        if (params.tmdbId && m.tmdbId && Number(m.tmdbId) === Number(params.tmdbId)) return true;
        return false;
      });
    }

    if (existingMovie && existingMovie.id) {
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

      if (existingMovie.hasFile) {
        return await forceGrabExistingMovie(base, headers, existingMovie.id, params.qualityPreference);
      }

      await executePost(`${base}/api/v3/command`, {
        name: 'MoviesSearch',
        movieIds: [existingMovie.id]
      }, headers);
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
      const accessibleFolder = rootFolders.find((rf: any) => rf.accessible !== false && rf.path);
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
        searchForMovie: true
      }
    };
    if (lookupResult.overview) addPayload.overview = lookupResult.overview;

    await executePost(`${base}/api/v3/movie`, addPayload, headers);

    return {
      success: true,
      message: `« ${params.title} » ajouté à Radarr ! Recherche (${params.qualityPreference === '4k' ? '4K' : '1080p'}) en cours.`
    };
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
export async function pushReleaseDirectly(payload: {
  service: 'sonarr' | 'radarr' | 'qbittorrent';
  url: string;
  apiKey?: string;
  username?: string;
  password?: string;
  torrent: C411Torrent;
  mediaType: 'movie' | 'tv';
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
      const endpoint = `${base}/api/v3/release/push`;
      const body = {
        title: payload.torrent.name,
        downloadUrl: payload.torrent.magnetUri,
        protocol: 'torrent',
        publishDate: payload.torrent.createdAt || new Date().toISOString()
      };

      const resData = await executePost(endpoint, body, {
        'X-Api-Key': payload.apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      });

      const releaseResult = Array.isArray(resData) ? resData[0] : resData;
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
        const isUnknown = /unknown|absent|introuvable|not found/i.test(reasonStr);

        if (isUnknown && payload.mediaInfo && payload.mediaInfo.title) {
          const addRes = await searchAndDownloadInRadarr({
            url: payload.url,
            apiKey: payload.apiKey,
            title: payload.mediaInfo.title,
            tmdbId: payload.mediaInfo.tmdbId,
            year: payload.mediaInfo.year
          });

          if (addRes.success) {
            try {
              const retryRes = await executePost(endpoint, body, {
                'X-Api-Key': payload.apiKey,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
              });
              const retryResult = Array.isArray(retryRes) ? retryRes[0] : retryRes;
              if (!retryResult || (!retryResult.rejections?.length && retryResult.approved !== false)) {
                return { success: true, message: `« ${payload.mediaInfo.title} » ajouté à Radarr et torrent envoyé au téléchargement !` };
              }
            } catch (retryErr) {}
            return { success: true, message: `« ${payload.mediaInfo.title} » ajouté à Radarr ! Recherche automatique lancée.` };
          }
        }

        return {
          success: false,
          message: `Radarr a refusé la release : ${reasonStr}. Cliquez sur « Lancer dans Radarr » pour ajouter d'abord le film.`
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

      const formBody = `urls=${encodeURIComponent(payload.torrent.magnetUri)}&category=${payload.mediaType === 'tv' ? 'tv' : 'movies'}`;
      const qbitHeaders: Record<string, string> = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': base,
        'Origin': base
      };
      if (cookieHeader) qbitHeaders['Cookie'] = cookieHeader;

      try {
        await executePost(`${base}/api/v2/torrents/add`, formBody, qbitHeaders);
        return { success: true, message: 'Torrent ajouté directement à qBittorrent !' };
      } catch (err: any) {
        if (!payload.username && !payload.password && (err?.message?.includes('403') || err?.message?.includes('401'))) {
          return {
            success: false,
            message: 'Authentification qBittorrent requise : renseignez votre nom d\'utilisateur et mot de passe'
          };
        }
        throw err;
      }
    }

    return { success: false, message: 'Service non supporté' };
  } catch (err: any) {
    console.error('[Push Release Error]', err);
    return {
      success: false,
      message: `Erreur lors de l'envoi : ${err?.message || 'Vérifiez la connexion avec votre serveur'}`
    };
  }
}
