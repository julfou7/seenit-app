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
 * Exécute une requête PUT multiplateforme
 */
async function executePut(url: string, body: any, headers: Record<string, string> = {}): Promise<any> {
  const isLocalIp = url.includes('192.168.') || url.includes('localhost') || url.includes('127.0.0.1') || url.includes('10.') || url.includes('172.16.') || url.includes('172.17.') || url.includes('172.18.') || url.includes('172.19.') || url.includes('172.20.') || url.includes('172.21.') || url.includes('172.22.') || url.includes('172.23.') || url.includes('172.24.') || url.includes('172.25.') || url.includes('172.26.') || url.includes('172.27.') || url.includes('172.28.') || url.includes('172.29.') || url.includes('172.30.') || url.includes('172.31.');

  if (Capacitor.isNativePlatform()) {
    try {
      const res = await CapacitorHttp.put({
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
      throw new Error(`Navigateur Web : Les adresses privées locales sont protégées et bloquées par le navigateur.`);
    }

    try {
      const res = await fetch('/api/service-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUrl: url,
          method: 'PUT',
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
 * Utilitaires de résolution des profils de qualité Sonarr / Radarr (1080p vs 4K)
 */
export function resolveQualityProfileId(
  profiles: Array<{ id: number; name: string }>,
  preference?: '1080p' | '4k',
  explicitId?: number
): number {
  if (explicitId && explicitId > 0) return explicitId;
  if (!profiles || profiles.length === 0) return 1;

  if (preference === '1080p') {
    // Profil 1080p ou HD
    const hd1080 = profiles.find(p => {
      const n = (p.name || '').toLowerCase();
      return n.includes('1080') || n.includes('hd-1080p') || n.includes('hd 1080p') || n.includes('web-1080p');
    });
    if (hd1080) return hd1080.id;

    const hdAny = profiles.find(p => {
      const n = (p.name || '').toLowerCase();
      return (n.includes('hd') || n.includes('720/1080')) && !n.includes('4k') && !n.includes('2160');
    });
    if (hdAny) return hdAny.id;

    return profiles[0].id;
  }

  if (preference === '4k') {
    // Profil Ultra-HD / 4K
    const uhd = profiles.find(p => {
      const n = (p.name || '').toLowerCase();
      return n.includes('4k') || n.includes('2160') || n.includes('ultra-hd') || n.includes('uhd') || n.includes('ultra hd');
    });
    if (uhd) return uhd.id;

    const anyProfile = profiles.find(p => (p.name || '').toLowerCase().includes('any'));
    if (anyProfile) return anyProfile.id;

    return profiles[profiles.length - 1].id;
  }

  return profiles[0].id;
}

/**
 * Récupère les profils de qualité configurés dans Sonarr ou Radarr
 */
export async function fetchQualityProfiles(
  type: 'sonarr' | 'radarr',
  url: string,
  apiKey: string
): Promise<Array<{ id: number; name: string }>> {
  const base = cleanUrl(url);
  if (!base || !apiKey) return [];
  const headers = { 'X-Api-Key': apiKey, 'Accept': 'application/json' };
  try {
    const res = await executeGet(`${base}/api/v3/qualityprofile`, headers);
    return Array.isArray(res) ? res.map((p: any) => ({ id: p.id, name: p.name })) : [];
  } catch {
    return [];
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
  qualityProfileId?: number;
  qualityPreference?: '1080p' | '4k';
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
    // Récupérer les profils de qualité
    let qualityProfiles: any[] = [];
    try {
      const qpRes = await executeGet(`${base}/api/v3/qualityprofile`, headers);
      if (Array.isArray(qpRes)) qualityProfiles = qpRes;
    } catch (e) {
      console.warn('[Sonarr] Erreur récupération qualityprofile:', e);
    }
    const targetQualityProfileId = resolveQualityProfileId(qualityProfiles, params.qualityPreference, params.qualityProfileId);

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

    // 2. Si la série est déjà dans Sonarr -> Ajuster le profil si besoin & Déclencher la commande de recherche spécifique
    if (existingSeries && existingSeries.id) {
      const seriesId = existingSeries.id;

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
              message: `Recherche lancée dans Sonarr pour « ${params.title} » S${String(params.season).padStart(2, '0')}E${String(params.episode).padStart(2, '0')} (${params.qualityPreference === '4k' ? '4K' : '1080p'}) !`
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
          message: `Recherche lancée dans Sonarr pour la Saison ${params.season} de « ${params.title} » (${params.qualityPreference === '4k' ? '4K' : '1080p'}) !`
        };
      }

      // Recherche de toute la série
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

    // Ajouter la série dans Sonarr avec recherche automatique immédiate et profil de qualité choisi
    const addPayload: any = {
      title: lookupResult.title,
      seasons: Array.isArray(lookupResult.seasons) ? lookupResult.seasons : [],
      rootFolderPath,
      qualityProfileId: targetQualityProfileId,
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
    // Récupérer les profils de qualité
    let qualityProfiles: any[] = [];
    try {
      const qpRes = await executeGet(`${base}/api/v3/qualityprofile`, headers);
      if (Array.isArray(qpRes)) qualityProfiles = qpRes;
    } catch (e) {
      console.warn('[Radarr] Erreur récupération qualityprofile:', e);
    }
    const targetQualityProfileId = resolveQualityProfileId(qualityProfiles, params.qualityPreference, params.qualityProfileId);

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

/* ========================================================================
   GÉRATION DU SUIVI DES TÉLÉCHARGEMENTS EN DIRECT (SONARR, RADARR, QBIT)
   ======================================================================== */

export interface LiveDownloadItem {
  id: string;
  mediaType: 'tv' | 'movie';
  title: string;
  seriesTitle?: string;
  movieTitle?: string;
  tmdbId?: number;
  tvdbId?: number;
  imdbId?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  size: number;
  sizeleft: number;
  progress: number;
  timeleft?: string;
  timeleftSeconds?: number;
  speedBytesPerSec?: number;
  speedFormatted?: string;
  status: 'downloading' | 'queued' | 'paused' | 'completed' | 'warning' | string;
  statusText: string;
  downloadClient?: string;
  releaseTitle?: string;
}

export function formatBytes(bytes: number, decimals = 1): string {
  if (!bytes || bytes === 0) return '0 Octet';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Octets', 'Ko', 'Mo', 'Go', 'To'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

export function formatSpeed(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return '0 Ko/s';
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatSecondsToETA(seconds: number): string {
  if (!seconds || seconds <= 0 || !isFinite(seconds) || seconds > 86400 * 7) return '--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const h = Math.floor(m / 60);
  const remainingM = m % 60;

  if (h > 0) return `${h}h ${remainingM}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function parseTimeStringToSeconds(timeStr?: string): number {
  if (!timeStr) return 0;
  const parts = timeStr.trim().split(':');
  if (parts.length === 3) {
    const hours = parseInt(parts[0], 10) || 0;
    const mins = parseInt(parts[1], 10) || 0;
    const secs = parseInt(parts[2], 10) || 0;
    return hours * 3600 + mins * 60 + secs;
  }
  if (parts.length === 2) {
    const mins = parseInt(parts[0], 10) || 0;
    const secs = parseInt(parts[1], 10) || 0;
    return mins * 60 + secs;
  }
  return 0;
}

export function matchShowDownload(
  item: LiveDownloadItem,
  tmdbId?: number | string,
  tvdbId?: number | string,
  showTitle?: string
): boolean {
  if (item.mediaType !== 'tv') return false;
  if (tmdbId && item.tmdbId && Number(item.tmdbId) === Number(tmdbId)) return true;
  if (tvdbId && item.tvdbId && Number(item.tvdbId) === Number(tvdbId)) return true;

  if (showTitle && (item.seriesTitle || item.title)) {
    const normSearch = showTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normItemSeries = (item.seriesTitle || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const normItemTitle = (item.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normItemSeries && (normItemSeries === normSearch || normItemSeries.includes(normSearch) || normSearch.includes(normItemSeries))) {
      return true;
    }
    if (normItemTitle && normItemTitle.includes(normSearch)) {
      return true;
    }
  }
  return false;
}

export function matchMovieDownload(
  item: LiveDownloadItem,
  tmdbId?: number | string,
  movieTitle?: string
): boolean {
  if (item.mediaType !== 'movie') return false;
  if (tmdbId && item.tmdbId && Number(item.tmdbId) === Number(tmdbId)) return true;

  if (movieTitle && (item.movieTitle || item.title)) {
    const normSearch = movieTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normItemMovie = (item.movieTitle || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const normItemTitle = (item.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normItemMovie && (normItemMovie === normSearch || normItemMovie.includes(normSearch) || normSearch.includes(normItemMovie))) {
      return true;
    }
    if (normItemTitle && normItemTitle.includes(normSearch)) {
      return true;
    }
  }
  return false;
}

export async function fetchLiveDownloadsQueue(config: SonarrRadarrConfig): Promise<LiveDownloadItem[]> {
  const items: LiveDownloadItem[] = [];

  // 1. Sonarr Queue
  if (config.sonarrUrl && config.sonarrApiKey) {
    const sonarrBase = cleanUrl(config.sonarrUrl);
    try {
      const res = await executeGet(`${sonarrBase}/api/v3/queue?pageSize=100&includeSeries=true&includeEpisode=true`, {
        'X-Api-Key': config.sonarrApiKey,
        'Accept': 'application/json'
      });

      const records = Array.isArray(res) ? res : (Array.isArray(res?.records) ? res.records : []);

      for (const rec of records) {
        const totalSize = rec.size || 0;
        const leftSize = rec.sizeleft || 0;
        const downloaded = Math.max(0, totalSize - leftSize);
        const progress = totalSize > 0 ? Math.min(100, Math.max(0, Math.round((downloaded / totalSize) * 100))) : (leftSize === 0 ? 100 : 0);

        const timeleftSeconds = parseTimeStringToSeconds(rec.timeleft);
        const timeleftStr = timeleftSeconds > 0 ? formatSecondsToETA(timeleftSeconds) : (rec.timeleft || '');

        const seriesTitle = rec.series?.title || rec.title || 'Série';
        const seasonNum = rec.seasonNumber ?? rec.episode?.seasonNumber ?? 1;
        const epNum = rec.episode?.episodeNumber ?? rec.episodeNumber;
        const epTitle = epNum ? `S${seasonNum}E${epNum}` : `Saison ${seasonNum}`;

        items.push({
          id: `sonarr_${rec.id}`,
          mediaType: 'tv',
          title: `${seriesTitle} (${epTitle})`,
          seriesTitle: seriesTitle,
          tmdbId: rec.series?.tmdbId,
          tvdbId: rec.series?.tvdbId,
          imdbId: rec.series?.imdbId,
          seasonNumber: seasonNum,
          episodeNumber: epNum,
          size: totalSize,
          sizeleft: leftSize,
          progress,
          timeleft: timeleftStr,
          timeleftSeconds,
          speedBytesPerSec: timeleftSeconds > 0 && leftSize > 0 ? Math.round(leftSize / timeleftSeconds) : 0,
          speedFormatted: timeleftSeconds > 0 && leftSize > 0 ? formatSpeed(Math.round(leftSize / timeleftSeconds)) : '',
          status: rec.status || 'downloading',
          statusText: rec.status === 'downloading' ? `Téléchargement ${progress}%` : (rec.status || 'En cours'),
          downloadClient: rec.downloadClient || 'Sonarr',
          releaseTitle: rec.title
        });
      }
    } catch (e) {
      console.warn('[LiveQueue] Erreur Sonarr queue:', e);
    }
  }

  // 2. Radarr Queue
  if (config.radarrUrl && config.radarrApiKey) {
    const radarrBase = cleanUrl(config.radarrUrl);
    try {
      const res = await executeGet(`${radarrBase}/api/v3/queue?pageSize=100&includeMovie=true`, {
        'X-Api-Key': config.radarrApiKey,
        'Accept': 'application/json'
      });

      const records = Array.isArray(res) ? res : (Array.isArray(res?.records) ? res.records : []);

      for (const rec of records) {
        const totalSize = rec.size || 0;
        const leftSize = rec.sizeleft || 0;
        const downloaded = Math.max(0, totalSize - leftSize);
        const progress = totalSize > 0 ? Math.min(100, Math.max(0, Math.round((downloaded / totalSize) * 100))) : (leftSize === 0 ? 100 : 0);

        const timeleftSeconds = parseTimeStringToSeconds(rec.timeleft);
        const timeleftStr = timeleftSeconds > 0 ? formatSecondsToETA(timeleftSeconds) : (rec.timeleft || '');

        const movieTitle = rec.movie?.title || rec.title || 'Film';

        items.push({
          id: `radarr_${rec.id}`,
          mediaType: 'movie',
          title: movieTitle,
          movieTitle: movieTitle,
          tmdbId: rec.movie?.tmdbId,
          imdbId: rec.movie?.imdbId,
          size: totalSize,
          sizeleft: leftSize,
          progress,
          timeleft: timeleftStr,
          timeleftSeconds,
          speedBytesPerSec: timeleftSeconds > 0 && leftSize > 0 ? Math.round(leftSize / timeleftSeconds) : 0,
          speedFormatted: timeleftSeconds > 0 && leftSize > 0 ? formatSpeed(Math.round(leftSize / timeleftSeconds)) : '',
          status: rec.status || 'downloading',
          statusText: rec.status === 'downloading' ? `Téléchargement ${progress}%` : (rec.status || 'En cours'),
          downloadClient: rec.downloadClient || 'Radarr',
          releaseTitle: rec.title
        });
      }
    } catch (e) {
      console.warn('[LiveQueue] Erreur Radarr queue:', e);
    }
  }

  // 3. qBittorrent direct
  if (config.qbittorrentUrl) {
    const qbitBase = cleanUrl(config.qbittorrentUrl);
    try {
      let cookieHeader = '';
      if (config.qbittorrentUsername || config.qbittorrentPassword) {
        if (Capacitor.isNativePlatform()) {
          try {
            const loginRes = await CapacitorHttp.post({
              url: `${qbitBase}/api/v2/auth/login`,
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              data: `username=${encodeURIComponent(config.qbittorrentUsername || '')}&password=${encodeURIComponent(config.qbittorrentPassword || '')}`
            });
            if (loginRes.headers && (loginRes.headers['set-cookie'] || loginRes.headers['Set-Cookie'])) {
              cookieHeader = (loginRes.headers['set-cookie'] || loginRes.headers['Set-Cookie']).split(';')[0];
            }
          } catch {}
        }
      }

      const qHeaders: Record<string, string> = { 'Accept': 'application/json' };
      if (cookieHeader) qHeaders['Cookie'] = cookieHeader;

      const res = await executeGet(`${qbitBase}/api/v2/torrents/info?filter=downloading`, qHeaders);
      if (Array.isArray(res)) {
        for (const t of res) {
          const rawProgress = typeof t.progress === 'number' ? Math.round(t.progress * 100) : 0;
          const speed = t.dlspeed || 0;
          const etaSec = t.eta || 0;
          const isTv = t.category === 'tv' || /s\d{1,2}e\d{1,2}/i.test(t.name);

          const existing = items.find(it => it.releaseTitle && (it.releaseTitle.toLowerCase() === t.name.toLowerCase() || t.name.toLowerCase().includes(it.releaseTitle.toLowerCase()) || it.releaseTitle.toLowerCase().includes(t.name.toLowerCase())));

          if (existing) {
            if (speed > 0) {
              existing.speedBytesPerSec = speed;
              existing.speedFormatted = formatSpeed(speed);
            }
            if (etaSec > 0 && etaSec < 86400 * 7) {
              existing.timeleftSeconds = etaSec;
              existing.timeleft = formatSecondsToETA(etaSec);
            }
          } else {
            items.push({
              id: `qbit_${t.hash || t.name}`,
              mediaType: isTv ? 'tv' : 'movie',
              title: t.name,
              size: t.size || 0,
              sizeleft: Math.round((t.size || 0) * (1 - (t.progress || 0))),
              progress: rawProgress,
              timeleft: formatSecondsToETA(etaSec),
              timeleftSeconds: etaSec,
              speedBytesPerSec: speed,
              speedFormatted: formatSpeed(speed),
              status: t.state || 'downloading',
              statusText: `qBittorrent ${rawProgress}%`,
              downloadClient: 'qBittorrent',
              releaseTitle: t.name
            });
          }
        }
      }
    } catch (e) {
      console.warn('[LiveQueue] Erreur qBittorrent queue:', e);
    }
  }

  return items;
}
