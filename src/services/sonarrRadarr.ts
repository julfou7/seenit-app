import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { C411Torrent } from './c411';

export interface SonarrRadarrConfig {
  sonarrUrl?: string;
  sonarrApiKey?: string;
  radarrUrl?: string;
  radarrApiKey?: string;
  qbittorrentUrl?: string;
  qbittorrentUsername?: string;
  qbittorrentPassword?: string;
}

/**
 * Normalise l'URL pour s'assurer qu'elle n'a pas de slash final
 */
function cleanUrl(url: string): string {
  let u = (url || '').trim();
  if (!u) return '';
  if (!u.startsWith('http://') && !u.startsWith('https://')) {
    u = `http://${u}`;
  }
  return u.replace(/\/+$/, '');
}

/**
 * Exécute une requête GET multiplateforme (Natif CapacitorHttp sur mobile / Proxy ou Fetch sur Web)
 */
async function executeGet(url: string, headers: Record<string, string> = {}): Promise<any> {
  const isLocalIp = url.includes('192.168.') || url.includes('localhost') || url.includes('127.0.0.1') || url.includes('10.') || url.includes('172.16.') || url.includes('172.17.') || url.includes('172.18.') || url.includes('172.19.') || url.includes('172.20.') || url.includes('172.21.') || url.includes('172.22.') || url.includes('172.23.') || url.includes('172.24.') || url.includes('172.25.') || url.includes('172.26.') || url.includes('172.27.') || url.includes('172.28.') || url.includes('172.29.') || url.includes('172.30.') || url.includes('172.31.');

  if (Capacitor.isNativePlatform()) {
    try {
      const res = await CapacitorHttp.get({
        url,
        headers,
        connectTimeout: 8000,
        readTimeout: 8000
      });
      if (res.status >= 200 && res.status < 300) {
        return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
      }
      throw new Error(`Erreur HTTP ${res.status}`);
    } catch (err: any) {
      throw new Error(err?.message || 'Serveur injoignable sur le réseau local');
    }
  } else {
    // Mode Navigateur Web (AI Studio Dev ou Web Browser)
    if (isLocalIp) {
      throw new Error(`Navigateur Web : Les adresses privées locales (192.168.x.x / localhost) sont protégées et bloquées par le navigateur (CORS / Mixed-Content HTTPS). Testez directement depuis l'application APK Android sur votre Wi-Fi, ou utilisez un tunnel HTTPS (ngrok) pour tester dans le navigateur.`);
    }

    try {
      // Passer par le proxy backend du serveur pour éviter les soucis CORS sur le Web
      const res = await fetch('/api/service-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUrl: url,
          method: 'GET',
          headers
        }),
        signal: AbortSignal.timeout(10000)
      });

      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.message || json.error || `Erreur proxy ${res.status}`);
      }
      return json.data;
    } catch (err: any) {
      throw new Error(err?.message || 'Erreur réseau');
    }
  }
}

/**
 * Exécute une requête POST multiplateforme (Natif CapacitorHttp sur mobile / Proxy ou Fetch sur Web)
 */
async function executePost(url: string, body: any, headers: Record<string, string> = {}): Promise<any> {
  const isLocalIp = url.includes('192.168.') || url.includes('localhost') || url.includes('127.0.0.1') || url.includes('10.') || url.includes('172.16.') || url.includes('172.17.') || url.includes('172.18.') || url.includes('172.19.') || url.includes('172.20.') || url.includes('172.21.') || url.includes('172.22.') || url.includes('172.23.') || url.includes('172.24.') || url.includes('172.25.') || url.includes('172.26.') || url.includes('172.27.') || url.includes('172.28.') || url.includes('172.29.') || url.includes('172.30.') || url.includes('172.31.');

  if (Capacitor.isNativePlatform()) {
    try {
      const res = await CapacitorHttp.post({
        url,
        headers,
        data: body,
        connectTimeout: 10000,
        readTimeout: 10000
      });
      if (res.status >= 200 && res.status < 300) {
        if (!res.data) return { success: true };
        return typeof res.data === 'string' ? (res.data.startsWith('{') || res.data.startsWith('[') ? JSON.parse(res.data) : res.data) : res.data;
      }
      
      // Parser les erreurs Sonarr / Radarr (souvent un tableau d'objets [{ propertyName, errorMessage }])
      let readableError = `Erreur HTTP ${res.status}`;
      try {
        const parsed = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
        if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].errorMessage) {
          readableError = parsed.map(e => e.errorMessage || e.message).join(' • ');
        } else if (parsed && parsed.message) {
          readableError = parsed.message;
        } else if (parsed && parsed.error) {
          readableError = typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error);
        }
      } catch {
        const strData = typeof res.data === 'string' ? res.data : JSON.stringify(res.data || {});
        if (strData) readableError = `${readableError} : ${strData.substring(0, 100)}`;
      }

      throw new Error(readableError);
    } catch (err: any) {
      throw new Error(err?.message || 'Serveur injoignable sur le réseau local');
    }
  } else {
    // Mode Navigateur Web
    if (isLocalIp) {
      throw new Error(`Navigateur Web : Les adresses privées locales (192.168.x.x / localhost) sont protégées et bloquées par le navigateur (CORS / Mixed-Content HTTPS). Testez directement depuis l'application APK Android sur votre Wi-Fi, ou utilisez un tunnel HTTPS (ngrok) pour tester dans le navigateur.`);
    }

    try {
      const res = await fetch('/api/service-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUrl: url,
          method: 'POST',
          headers,
          body
        }),
        signal: AbortSignal.timeout(12000)
      });

      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.message || json.error || `Erreur proxy ${res.status}`);
      }
      return json.data;
    } catch (err: any) {
      throw new Error(err?.message || 'Erreur réseau');
    }
  }
}

/**
 * Test de connectivité avec Sonarr ou Radarr
 */
export async function testServiceConnection(
  type: 'sonarr' | 'radarr' | 'qbittorrent',
  url: string,
  apiKey?: string
): Promise<{ success: boolean; message: string; version?: string }> {
  const base = cleanUrl(url);
  if (!base) return { success: false, message: 'URL manquante' };

  try {
    if (type === 'sonarr' || type === 'radarr') {
      if (!apiKey) return { success: false, message: 'Clé API manquante' };
      const data = await executeGet(`${base}/api/v3/system/status`, {
        'X-Api-Key': apiKey,
        'Accept': 'application/json'
      });
      return {
        success: true,
        message: `Connecté avec succès à ${type === 'sonarr' ? 'Sonarr' : 'Radarr'} (v${data.version || '3+'})`,
        version: data.version
      };
    }

    if (type === 'qbittorrent') {
      const data = await executeGet(`${base}/api/v2/app/version`, {
        'Accept': 'text/plain, application/json'
      });
      return {
        success: true,
        message: `Connecté avec succès à qBittorrent (${typeof data === 'string' ? data : 'Web UI'})`
      };
    }

    return { success: false, message: 'Service inconnu' };
  } catch (err: any) {
    return {
      success: false,
      message: `Connexion impossible à ${type} (${err?.message || 'Vérifiez l\'adresse IP et que votre PC est allumé'})`
    };
  }
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
}): Promise<{ success: boolean; message: string }> {
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

    let existingSeries: any = null;
    const cleanTargetTitle = (params.title || '').trim().toLowerCase();
    if (Array.isArray(seriesList)) {
      existingSeries = seriesList.find((s: any) => {
        if (params.tvdbId && s.tvdbId && Number(s.tvdbId) === Number(params.tvdbId)) return true;
        if (params.imdbId && s.imdbId && String(s.imdbId).toLowerCase() === String(params.imdbId).toLowerCase()) return true;
        if (params.tmdbId && s.tmdbId && Number(s.tmdbId) === Number(params.tmdbId)) return true;
        if (s.title && s.title.toLowerCase() === cleanTargetTitle) return true;
        return false;
      });
    }

    // 2. Si la série est déjà dans Sonarr -> Déclencher la commande de recherche spécifique
    if (existingSeries && existingSeries.id) {
      const seriesId = existingSeries.id;

      // Recherche par épisode spécifique
      if (params.season && params.episode) {
        try {
          const episodes: any[] = await executeGet(`${base}/api/v3/episode?seriesId=${seriesId}`, headers);
          const targetEp = Array.isArray(episodes) ? episodes.find((ep: any) => ep.seasonNumber === params.season && ep.episodeNumber === params.episode) : null;
          
          if (targetEp && targetEp.id) {
            await executePost(`${base}/api/v3/command`, {
              name: 'EpisodeSearch',
              episodeIds: [targetEp.id]
            }, headers);
            return {
              success: true,
              message: `Recherche lancée dans Sonarr pour « ${params.title} » S${String(params.season).padStart(2, '0')}E${String(params.episode).padStart(2, '0')} !`
            };
          }
        } catch (epErr) {
          console.warn('[Sonarr Episode Search Error]', epErr);
        }
      }

      // Recherche par saison entière
      if (params.season) {
        await executePost(`${base}/api/v3/command`, {
          name: 'SeasonSearch',
          seriesId: seriesId,
          seasonNumber: params.season
        }, headers);
        return {
          success: true,
          message: `Recherche lancée dans Sonarr pour la Saison ${params.season} de « ${params.title} » !`
        };
      }

      // Recherche de toute la série
      await executePost(`${base}/api/v3/command`, {
        name: 'SeriesSearch',
        seriesId: seriesId
      }, headers);
      return {
        success: true,
        message: `Recherche lancée dans Sonarr pour toute la série « ${params.title} » !`
      };
    }

    // 3. Si la série n'est pas dans Sonarr -> Faire un lookup pour obtenir les métadonnées TVDB/TheTVDB
    let lookupResult: any = null;
    const lookupTerms = [
      params.imdbId ? `imdb:${params.imdbId}` : null,
      params.tvdbId ? `tvdb:${params.tvdbId}` : null,
      params.title,
      params.title.replace(/[:’'–-]/g, ' ').replace(/\s+/g, ' ').trim()
    ].filter(Boolean);

    for (const term of lookupTerms) {
      try {
        const lookup = await executeGet(`${base}/api/v3/series/lookup?term=${encodeURIComponent(term!)}`, headers);
        if (Array.isArray(lookup) && lookup.length > 0) {
          lookupResult = lookup[0];
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

    // Récupérer le root folder et le profil de qualité configurés dans Sonarr
    let rootFolders: any[] = [];
    try {
      const rfRes = await executeGet(`${base}/api/v3/rootfolder`, headers);
      if (Array.isArray(rfRes)) rootFolders = rfRes;
    } catch (e) {
      console.warn('[Sonarr] Erreur récupération rootfolder:', e);
    }

    let qualityProfiles: any[] = [];
    try {
      const qpRes = await executeGet(`${base}/api/v3/qualityprofile`, headers);
      if (Array.isArray(qpRes)) qualityProfiles = qpRes;
    } catch (e) {
      console.warn('[Sonarr] Erreur récupération qualityprofile:', e);
    }

    // Déterminer le meilleur chemin racine valide
    let rootFolderPath = '';
    if (rootFolders.length > 0) {
      const accessibleFolder = rootFolders.find((rf: any) => rf.accessible !== false && rf.path);
      rootFolderPath = accessibleFolder ? accessibleFolder.path : rootFolders[0].path;
    } else if (Array.isArray(seriesList) && seriesList.length > 0) {
      // Si l'API rootfolder n'a rien renvoyé mais que des séries existent, utiliser le chemin d'une série existante
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

    const qualityProfileId = qualityProfiles.length > 0 && qualityProfiles[0].id ? qualityProfiles[0].id : 1;

    // Ajouter la série dans Sonarr avec recherche automatique immédiate
    const addPayload: any = {
      title: lookupResult.title,
      seasons: Array.isArray(lookupResult.seasons) ? lookupResult.seasons : [],
      rootFolderPath,
      qualityProfileId,
      monitored: true,
      seasonFolder: true,
      tvdbId: lookupResult.tvdbId,
      year: lookupResult.year,
      titleSlug: lookupResult.titleSlug,
      images: lookupResult.images || [],
      addOptions: {
        searchForMissingEpisodes: true,
        monitor: params.season ? 'all' : 'all'
      }
    };
    if (lookupResult.seriesType) addPayload.seriesType = lookupResult.seriesType;
    if (lookupResult.overview) addPayload.overview = lookupResult.overview;

    const created = await executePost(`${base}/api/v3/series`, addPayload, headers);
    
    // Si on ciblait une saison en particulier, lancer la recherche de cette saison
    if (params.season && created && created.id) {
      await executePost(`${base}/api/v3/command`, {
        name: 'SeasonSearch',
        seriesId: created.id,
        seasonNumber: params.season
      }, headers).catch(() => {});
    }

    return {
      success: true,
      message: `« ${params.title} » ajoutée à Sonarr ! Recherche et téléchargement automatique en cours.`
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
  year?: number | string;
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
    // 1. Vérifier si le film est déjà dans Radarr
    const moviesList = await executeGet(`${base}/api/v3/movie`, headers).catch(() => []);
    let existingMovie: any = null;
    if (Array.isArray(moviesList)) {
      existingMovie = moviesList.find((m: any) => {
        if (params.tmdbId && m.tmdbId && Number(m.tmdbId) === Number(params.tmdbId)) return true;
        if (m.title && m.title.toLowerCase() === params.title.toLowerCase()) return true;
        return false;
      });
    }

    if (existingMovie && existingMovie.id) {
      await executePost(`${base}/api/v3/command`, {
        name: 'MoviesSearch',
        movieIds: [existingMovie.id]
      }, headers);
      return {
        success: true,
        message: `Recherche lancée dans Radarr pour « ${params.title} » !`
      };
    }

    // 2. Lookup du film
    let lookupResult: any = null;
    const lookupTerms = [
      params.tmdbId ? `tmdb:${params.tmdbId}` : null,
      params.title
    ].filter(Boolean);

    for (const term of lookupTerms) {
      try {
        const lookup = await executeGet(`${base}/api/v3/movie/lookup?term=${encodeURIComponent(term!)}`, headers);
        if (Array.isArray(lookup) && lookup.length > 0) {
          lookupResult = lookup[0];
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

    // Récupérer le root folder et le profil de qualité configurés dans Radarr
    let rootFolders: any[] = [];
    try {
      const rfRes = await executeGet(`${base}/api/v3/rootfolder`, headers);
      if (Array.isArray(rfRes)) rootFolders = rfRes;
    } catch (e) {
      console.warn('[Radarr] Erreur récupération rootfolder:', e);
    }

    let qualityProfiles: any[] = [];
    try {
      const qpRes = await executeGet(`${base}/api/v3/qualityprofile`, headers);
      if (Array.isArray(qpRes)) qualityProfiles = qpRes;
    } catch (e) {
      console.warn('[Radarr] Erreur récupération qualityprofile:', e);
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

    const qualityProfileId = qualityProfiles.length > 0 && qualityProfiles[0].id ? qualityProfiles[0].id : 1;

    const addPayload: any = {
      title: lookupResult.title,
      rootFolderPath,
      qualityProfileId,
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
      message: `« ${params.title} » ajouté à Radarr ! Recherche et téléchargement en cours.`
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

  if (!payload.torrent.magnetUri) {
    return { success: false, message: 'Lien Magnet introuvable pour ce torrent' };
  }

  try {
    // 1. Sonarr Release Push
    if (payload.service === 'sonarr') {
      if (!payload.apiKey) return { success: false, message: 'Clé API Sonarr manquante' };
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
          rejections = ['Release non approuvée par Sonarr'];
        }
      }

      if (rejections.length > 0) {
        const reasonStr = rejections.join(' • ');
        const isUnknown = /unknown|absent|introuvable|not found/i.test(reasonStr);

        // Si la série n'est pas encore ajoutée dans Sonarr, l'ajouter automatiquement puis re-tester
        if (isUnknown && payload.mediaInfo && payload.mediaInfo.title) {
          const addRes = await searchAndDownloadInSonarr({
            url: payload.url,
            apiKey: payload.apiKey,
            title: payload.mediaInfo.title,
            tmdbId: payload.mediaInfo.tmdbId,
            tvdbId: payload.mediaInfo.tvdbId,
            imdbId: payload.mediaInfo.imdbId,
            season: payload.mediaInfo.season,
            episode: payload.mediaInfo.episode
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
                return { success: true, message: `« ${payload.mediaInfo.title} » ajoutée à Sonarr et torrent envoyé au téléchargement !` };
              }
            } catch (retryErr) {}
            return { success: true, message: `« ${payload.mediaInfo.title} » ajoutée à Sonarr ! Recherche automatique lancée.` };
          }
        }

        return {
          success: false,
          message: `Sonarr a refusé la release : ${reasonStr}. Cliquez sur « Lancer dans Sonarr » pour ajouter d'abord la série.`
        };
      }

      return { success: true, message: 'Torrent envoyé avec succès à Sonarr !' };
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
        try {
          if (Capacitor.isNativePlatform()) {
            const loginRes = await CapacitorHttp.post({
              url: `${base}/api/v2/auth/login`,
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              data: `username=${encodeURIComponent(payload.username || '')}&password=${encodeURIComponent(payload.password || '')}`
            });
            if (loginRes.headers && (loginRes.headers['set-cookie'] || loginRes.headers['Set-Cookie'])) {
              cookieHeader = (loginRes.headers['set-cookie'] || loginRes.headers['Set-Cookie']).split(';')[0];
            }
          }
        } catch (loginErr) {}
      }

      const formBody = `urls=${encodeURIComponent(payload.torrent.magnetUri)}&category=${payload.mediaType === 'tv' ? 'tv' : 'movies'}`;
      const qbitHeaders: Record<string, string> = {
        'Content-Type': 'application/x-www-form-urlencoded'
      };
      if (cookieHeader) qbitHeaders['Cookie'] = cookieHeader;

      await executePost(`${base}/api/v2/torrents/add`, formBody, qbitHeaders);
      return { success: true, message: 'Torrent ajouté directement à qBittorrent !' };
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
