import { Capacitor, CapacitorHttp } from '@capacitor/core';

export interface C411Torrent {
  id: number;
  infoHash: string;
  name: string;
  description?: string;
  size: number;
  seeders: number;
  leechers: number;
  completions?: number;
  language?: string;
  quality?: string;
  uploader?: string;
  createdAt?: string;
  isExclusive?: boolean;
  isFreeleech?: boolean;
  category?: {
    id: number;
    name: string;
    slug: string;
    color?: string;
    icon?: string;
  };
  subcategory?: {
    id: number;
    categoryId?: number;
    name: string;
    slug: string;
  };
  magnetUri?: string;
}

export interface C411SearchParams {
  query: string;
  mediaType?: 'movie' | 'tv';
  year?: string | number;
  apiKey?: string;
}

/**
 * Normalise la taille en Mo / Go
 */
export function formatTorrentSize(bytes: number): string {
  if (!bytes || bytes === 0) return '0 Mo';
  const k = 1024;
  const sizes = ['Octets', 'Ko', 'Mo', 'Go', 'To'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Crée un lien Magnet à partir du hash et du nom
 */
export function buildMagnetLink(infoHash: string, name: string): string {
  const trackers = [
    'udp://tracker.opentrackr.org:1337/announce',
    'udp://open.tracker.cl:1337/announce',
    'udp://9.rarbg.com:2810/announce',
    'udp://tracker.openbittorrent.com:6969/announce',
    'udp://opentracker.i2p.rocks:6969/announce',
    'udp://tracker.torrent.eu.org:451/announce'
  ];
  const trParams = trackers.map(tr => `&tr=${encodeURIComponent(tr)}`).join('');
  return `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(name)}${trParams}`;
}

/**
 * Helper HTTP multiplateforme (Natif via CapacitorHttp pour contourner CORS / Web via fetch standard)
 */
async function performC411Get(url: string, apiKey: string): Promise<any> {
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Accept': 'application/json',
    'User-Agent': 'SeenIt-App'
  };

  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.get({
      url,
      headers,
      connectTimeout: 8000,
      readTimeout: 8000
    });
    if (res.status >= 200 && res.status < 300) {
      return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    }
    return null;
  } else {
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(8000)
    });
    if (res.ok) {
      return await res.json();
    }
    return null;
  }
}

/**
 * Recherche des torrents sur C411 via l'API officielle (avec CapacitorHttp natif sur mobile) ou fallback proxy
 */
export async function searchC411Torrents(params: C411SearchParams): Promise<C411Torrent[]> {
  const query = (params.query || '').trim();
  if (!query) return [];

  const apiKey = params.apiKey || '2d4baaf4fdd1dacd26f8dc96b1ab6aa06fc95140a7509456b25c8c0b9b5ac55a';

  // 1. Appel direct vers l'API C411 (CapacitorHttp sur Android/iOS pour contourner le CORS, fetch sur Web)
  try {
    const cleanQuery = query.replace(/[:’']/g, ' ').replace(/\s+/g, ' ').trim();
    const searchParams = new URLSearchParams();
    searchParams.set('name', cleanQuery);
    searchParams.set('category', '1');
    if (params.mediaType === 'tv') searchParams.set('subcategory', '7');
    if (params.mediaType === 'movie') searchParams.set('subcategory', '6');

    let data = await performC411Get(`https://c411.org/api/torrents?${searchParams.toString()}`, apiKey);
    let torrents: C411Torrent[] = data?.data || [];

    // Fallback 1 : recherche large (sans sous-catégorie) si aucun résultat
    if (torrents.length === 0) {
      data = await performC411Get(`https://c411.org/api/torrents?name=${encodeURIComponent(cleanQuery)}&category=1`, apiKey);
      torrents = data?.data || [];
    }

    // Fallback 2 : Si la recherche ciblait un épisode (ex: "Reacher S01E01" ou "Reacher S01") et ne donne rien, chercher la saison ou le titre de base
    if (torrents.length === 0 && params.mediaType === 'tv') {
      const episodeMatch = cleanQuery.match(/(.+?)\s+S(\d+)E\d+/i);
      const seasonMatch = cleanQuery.match(/(.+?)\s+S(\d+)/i);

      if (episodeMatch) {
        // Essayer "Titre S01"
        const fallbackSeasonQuery = `${episodeMatch[1]} S${episodeMatch[2]}`;
        data = await performC411Get(`https://c411.org/api/torrents?name=${encodeURIComponent(fallbackSeasonQuery)}&category=1`, apiKey);
        torrents = data?.data || [];
      }

      if (torrents.length === 0 && (episodeMatch || seasonMatch)) {
        // Essayer simplement le titre de la série
        const showTitle = episodeMatch ? episodeMatch[1] : (seasonMatch ? seasonMatch[1] : cleanQuery);
        if (showTitle && showTitle.length >= 3) {
          data = await performC411Get(`https://c411.org/api/torrents?name=${encodeURIComponent(showTitle)}&category=1`, apiKey);
          torrents = data?.data || [];
        }
      }
    }

    if (torrents.length > 0) {
      return torrents.map((t: C411Torrent) => ({
        ...t,
        magnetUri: t.infoHash ? buildMagnetLink(t.infoHash, t.name) : undefined
      }));
    }
  } catch (directErr) {
    console.warn('[C411 Direct Request Error, trying backend fallback]', directErr);
  }

  // 2. Fallback via le backend proxy SeenIt si l'appel direct échoue
  try {
    const queryParams = new URLSearchParams();
    queryParams.set('query', query);
    if (params.mediaType) queryParams.set('mediaType', params.mediaType);
    if (params.year) queryParams.set('year', String(params.year));
    queryParams.set('apiKey', apiKey);

    const endpoints = [
      'https://seenit.ai.studio/api/c411/search',
      'https://ais-pre-mooctibtw2amkshvkzlqij-700628279309.europe-west2.run.app/api/c411/search',
      'https://ais-dev-mooctibtw2amkshvkzlqij-700628279309.europe-west2.run.app/api/c411/search',
      '/api/c411/search'
    ];

    for (const ep of endpoints) {
      try {
        const url = `${ep}?${queryParams.toString()}`;
        let resData: any = null;

        if (Capacitor.isNativePlatform()) {
          const nativeRes = await CapacitorHttp.get({
            url,
            headers: { 'Accept': 'application/json' },
            connectTimeout: 8000,
            readTimeout: 8000
          });
          if (nativeRes.status >= 200 && nativeRes.status < 300) {
            resData = typeof nativeRes.data === 'string' ? JSON.parse(nativeRes.data) : nativeRes.data;
          }
        } else {
          const res = await fetch(url, {
            headers: { 'Accept': 'application/json' },
            signal: AbortSignal.timeout(8000)
          });
          if (res.ok) {
            resData = await res.json();
          }
        }

        if (resData && (resData.torrents || resData.data)) {
          const list = resData.torrents || resData.data || [];
          return list.map((t: C411Torrent) => ({
            ...t,
            magnetUri: t.infoHash ? buildMagnetLink(t.infoHash, t.name) : undefined
          }));
        }
      } catch (err: any) {
        // next endpoint
      }
    }
    return [];
  } catch (err) {
    console.error('[C411] Search failed:', err);
    return [];
  }
}

/**
 * Déclenchement d'un téléchargement vers Sonarr / Radarr / qBittorrent via l'API backend
 */
export async function triggerRemoteDownload(payload: {
  service: 'sonarr' | 'radarr' | 'qbittorrent';
  url: string;
  apiKey?: string;
  username?: string;
  password?: string;
  torrent: C411Torrent;
  mediaType: 'movie' | 'tv';
  tmdbId?: number | string;
  title: string;
  year?: number | string;
}): Promise<{ success: boolean; message: string }> {
  try {
    const endpoints = [
      'https://seenit.ai.studio/api/downloads/push',
      'https://ais-pre-mooctibtw2amkshvkzlqij-700628279309.europe-west2.run.app/api/downloads/push',
      'https://ais-dev-mooctibtw2amkshvkzlqij-700628279309.europe-west2.run.app/api/downloads/push',
      '/api/downloads/push'
    ];

    for (const ep of endpoints) {
      try {
        const res = await fetch(ep, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(15000)
        });
        if (res.ok) {
          const data = await res.json();
          return { success: true, message: data.message || 'Téléchargement envoyé avec succès !' };
        }
        const errorData = await res.json().catch(() => ({}));
        return {
          success: false,
          message: errorData.error || `Erreur serveur (${res.status})`
        };
      } catch (e) {
        // Try next
      }
    }
    return { success: false, message: 'Impossible de joindre le serveur' };
  } catch (err: any) {
    return { success: false, message: err?.message || 'Erreur inconnue' };
  }
}
