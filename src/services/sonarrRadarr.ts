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
 * Exécute une requête GET multiplateforme (Natif CapacitorHttp sur mobile / Fetch standard sur Web)
 */
async function executeGet(url: string, headers: Record<string, string> = {}): Promise<any> {
  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.get({
      url,
      headers,
      connectTimeout: 7000,
      readTimeout: 7000
    });
    if (res.status >= 200 && res.status < 300) {
      return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    }
    throw new Error(`Erreur HTTP ${res.status}`);
  } else {
    const res = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(7000)
    });
    if (!res.ok) throw new Error(`Erreur HTTP ${res.status}`);
    return await res.json();
  }
}

/**
 * Exécute une requête POST multiplateforme (Natif CapacitorHttp sur mobile / Fetch standard sur Web)
 */
async function executePost(url: string, body: any, headers: Record<string, string> = {}): Promise<any> {
  const isFormData = typeof body === 'string' && headers['Content-Type'] === 'application/x-www-form-urlencoded';

  if (Capacitor.isNativePlatform()) {
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
    const errMsg = typeof res.data === 'string' ? res.data : JSON.stringify(res.data || {});
    throw new Error(`Erreur HTTP ${res.status} : ${errMsg.substring(0, 100)}`);
  } else {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: isFormData ? body : (typeof body === 'string' ? body : JSON.stringify(body)),
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) {
      const errTxt = await res.text().catch(() => '');
      throw new Error(`Erreur HTTP ${res.status} : ${errTxt.substring(0, 100)}`);
    }
    const txt = await res.text().catch(() => '');
    if (!txt) return { success: true };
    try {
      return JSON.parse(txt);
    } catch {
      return txt;
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
    } catch (e) {
      console.warn('[Sonarr] Impossible de lister les séries:', e);
    }

    let existingSeries: any = null;
    if (Array.isArray(seriesList)) {
      existingSeries = seriesList.find((s: any) => {
        if (params.tmdbId && s.tmdbId && Number(s.tmdbId) === Number(params.tmdbId)) return true;
        if (s.title && s.title.toLowerCase() === params.title.toLowerCase()) return true;
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

    // 3. Si la série n'est pas dans Sonarr -> Faire un lookup pour obtenir les métadonnées TVDB/TMDB
    let lookupResult: any = null;
    const lookupTerms = [
      params.tmdbId ? `tmdb:${params.tmdbId}` : null,
      params.title
    ].filter(Boolean);

    for (const term of lookupTerms) {
      try {
        const lookup = await executeGet(`${base}/api/v3/series/lookup?term=${encodeURIComponent(term!)}`, headers);
        if (Array.isArray(lookup) && lookup.length > 0) {
          lookupResult = lookup[0];
          break;
        }
      } catch (lErr) {}
    }

    if (!lookupResult) {
      return {
        success: false,
        message: `Série « ${params.title} » introuvable sur Sonarr. Utilisez la liste des torrents C411 ci-dessous.`
      };
    }

    // Récupérer le root folder et le profile de qualité par défaut
    const rootFolders = await executeGet(`${base}/api/v3/rootfolder`, headers).catch(() => []);
    const qualityProfiles = await executeGet(`${base}/api/v3/qualityprofile`, headers).catch(() => []);

    const rootFolderPath = Array.isArray(rootFolders) && rootFolders.length > 0 ? rootFolders[0].path : '/tv';
    const qualityProfileId = Array.isArray(qualityProfiles) && qualityProfiles.length > 0 ? qualityProfiles[0].id : 1;

    // Ajouter la série dans Sonarr avec recherche automatique immédiate
    const addPayload = {
      ...lookupResult,
      rootFolderPath,
      qualityProfileId,
      monitored: true,
      addOptions: {
        searchForMissingEpisodes: true,
        monitor: params.season ? 'future' : 'all'
      }
    };

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

    const rootFolders = await executeGet(`${base}/api/v3/rootfolder`, headers).catch(() => []);
    const qualityProfiles = await executeGet(`${base}/api/v3/qualityprofile`, headers).catch(() => []);

    const rootFolderPath = Array.isArray(rootFolders) && rootFolders.length > 0 ? rootFolders[0].path : '/movies';
    const qualityProfileId = Array.isArray(qualityProfiles) && qualityProfiles.length > 0 ? qualityProfiles[0].id : 1;

    const addPayload = {
      ...lookupResult,
      rootFolderPath,
      qualityProfileId,
      monitored: true,
      addOptions: {
        searchForMovie: true
      }
    };

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
      await executePost(endpoint, body, {
        'X-Api-Key': payload.apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      });
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
      await executePost(endpoint, body, {
        'X-Api-Key': payload.apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      });
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
