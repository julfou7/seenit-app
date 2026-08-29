import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { authenticatedFetch, getAuthenticatedHeaders } from '../lib/apiAuth';

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
 * Recherche des torrents sur C411 via le backend authentifié.
 * La clé est lue dans Firestore pour l'utilisateur connecté.
 */
export async function searchC411Torrents(params: C411SearchParams): Promise<C411Torrent[]> {
  const query = (params.query || '').trim();
  if (!query) return [];

  try {
    const payload = {
      query,
      mediaType: params.mediaType,
      year: params.year ? String(params.year) : undefined
    };

    const endpoints = [
      'https://seenit.ai.studio/api/c411/search',
      'https://ais-pre-mooctibtw2amkshvkzlqij-700628279309.europe-west2.run.app/api/c411/search',
      'https://ais-dev-mooctibtw2amkshvkzlqij-700628279309.europe-west2.run.app/api/c411/search',
      '/api/c411/search'
    ];

    for (const ep of endpoints) {
      try {
        let resData: any = null;

        if (Capacitor.isNativePlatform()) {
          const nativeRes = await CapacitorHttp.post({
            url: ep,
            headers: await getAuthenticatedHeaders({
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            }),
            data: payload,
            connectTimeout: 8000,
            readTimeout: 8000
          });
          if (nativeRes.status >= 200 && nativeRes.status < 300) {
            resData = typeof nativeRes.data === 'string' ? JSON.parse(nativeRes.data) : nativeRes.data;
          }
        } else {
          const res = await authenticatedFetch(ep, {
            method: 'POST',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload),
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
 * Vérifie une clé C411 via le backend SeenIt authentifié.
 * Le transport est adapté à la PWA et à l'APK Capacitor.
 */
export async function testC411Connection(apiKey: string): Promise<{ success: boolean; message: string }> {
  const normalizedApiKey = apiKey.trim();
  if (!normalizedApiKey) {
    return { success: false, message: 'Clé API C411 manquante.' };
  }

  const endpoints = [
    'https://seenit.ai.studio/api/c411/test',
    'https://ais-pre-mooctibtw2amkshvkzlqij-700628279309.europe-west2.run.app/api/c411/test',
    'https://ais-dev-mooctibtw2amkshvkzlqij-700628279309.europe-west2.run.app/api/c411/test',
    '/api/c411/test'
  ];

  let lastMessage = 'Impossible de joindre le serveur SeenIt.';

  for (const endpoint of endpoints) {
    try {
      let status = 0;
      let data: any = null;

      if (Capacitor.isNativePlatform()) {
        const response = await CapacitorHttp.post({
          url: endpoint,
          headers: await getAuthenticatedHeaders({
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          }),
          data: { apiKey: normalizedApiKey },
          connectTimeout: 8000,
          readTimeout: 8000
        });
        status = response.status;
        data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
      } else {
        const response = await authenticatedFetch(endpoint, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ apiKey: normalizedApiKey }),
          signal: AbortSignal.timeout(8000)
        });
        status = response.status;
        data = await response.json().catch(() => null);
      }

      if (status >= 200 && status < 300 && data?.success) {
        return {
          success: true,
          message: data.message || 'Connexion C411 réussie !'
        };
      }

      if (status === 400 || status === 401 || status === 403) {
        return {
          success: false,
          message: data?.error || 'Clé API C411 refusée.'
        };
      }

      if (status !== 404) {
        lastMessage = data?.error || `Serveur C411 indisponible (${status}).`;
      }
    } catch (error: any) {
      lastMessage = error?.message || lastMessage;
    }
  }

  return { success: false, message: lastMessage };
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
        const res = await authenticatedFetch(ep, {
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
