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

const SEENIT_API_ORIGIN = 'https://seenit.ai.studio';

function getBackendEndpoints(path: string): string[] {
  if (Capacitor.isNativePlatform()) {
    return [`${SEENIT_API_ORIGIN}${path}`];
  }

  if (typeof window !== 'undefined' && window.location.origin === SEENIT_API_ORIGIN) {
    return [path];
  }

  // En preview/dev Web : backend courant en priorité, production SeenIt en secours.
  return [path, `${SEENIT_API_ORIGIN}${path}`];
}

function parseResponseData(raw: unknown): any {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Normalise la taille en Mo / Go.
 */
export function formatTorrentSize(bytes: number): string {
  if (!bytes || bytes === 0) return '0 Mo';
  const k = 1024;
  const sizes = ['Octets', 'Ko', 'Mo', 'Go', 'To'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Crée un lien Magnet à partir du hash et du nom.
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
 * Recherche des torrents C411 via un backend SeenIt authentifié.
 * Une réponse valide vide retourne []; une panne réseau lève une erreur pour ne plus
 * confondre "aucun résultat" et "tracker indisponible".
 */
export async function searchC411Torrents(params: C411SearchParams): Promise<C411Torrent[]> {
  const query = (params.query || '').trim();
  if (!query) return [];

  const payload = {
    query,
    mediaType: params.mediaType,
    year: params.year ? String(params.year) : undefined
  };

  let lastError: Error | null = null;

  for (const endpoint of getBackendEndpoints('/api/c411/search')) {
    try {
      let status = 0;
      let data: any = null;

      if (Capacitor.isNativePlatform()) {
        const response = await CapacitorHttp.post({
          url: endpoint,
          headers: await getAuthenticatedHeaders({
            Accept: 'application/json',
            'Content-Type': 'application/json'
          }),
          data: payload,
          connectTimeout: 6000,
          readTimeout: 6000
        });
        status = response.status;
        data = parseResponseData(response.data);
      } else {
        const response = await authenticatedFetch(endpoint, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(6000)
        });
        status = response.status;
        data = await response.json().catch(() => null);
      }

      if (status >= 200 && status < 300) {
        const list = Array.isArray(data?.torrents)
          ? data.torrents
          : Array.isArray(data?.data)
            ? data.data
            : null;

        if (list) {
          return list.map((torrent: C411Torrent) => ({
            ...torrent,
            magnetUri: torrent.infoHash
              ? buildMagnetLink(torrent.infoHash, torrent.name)
              : undefined
          }));
        }

        throw new Error('Réponse C411 invalide.');
      }

      const message = data?.error || data?.message || `C411 indisponible (${status}).`;
      if ([400, 401, 403].includes(status)) {
        throw new Error(message);
      }

      lastError = new Error(message);
    } catch (error: any) {
      lastError = new Error(error?.message || 'Impossible de joindre C411.');
    }
  }

  console.warn('[C411] Recherche indisponible:', lastError?.message);
  throw lastError || new Error('Impossible de joindre C411.');
}

/**
 * Vérifie une clé C411 via le backend SeenIt authentifié.
 */
export async function testC411Connection(apiKey: string): Promise<{ success: boolean; message: string }> {
  const normalizedApiKey = apiKey.trim();
  if (!normalizedApiKey) {
    return { success: false, message: 'Clé API C411 manquante.' };
  }

  let lastMessage = 'Impossible de joindre le serveur SeenIt.';

  for (const endpoint of getBackendEndpoints('/api/c411/test')) {
    try {
      let status = 0;
      let data: any = null;

      if (Capacitor.isNativePlatform()) {
        const response = await CapacitorHttp.post({
          url: endpoint,
          headers: await getAuthenticatedHeaders({
            Accept: 'application/json',
            'Content-Type': 'application/json'
          }),
          data: { apiKey: normalizedApiKey },
          connectTimeout: 6000,
          readTimeout: 6000
        });
        status = response.status;
        data = parseResponseData(response.data);
      } else {
        const response = await authenticatedFetch(endpoint, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ apiKey: normalizedApiKey }),
          signal: AbortSignal.timeout(6000)
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

      if ([400, 401, 403].includes(status)) {
        return {
          success: false,
          message: data?.error || 'Clé API C411 refusée.'
        };
      }

      lastMessage = data?.error || data?.message || `Serveur C411 indisponible (${status}).`;
    } catch (error: any) {
      lastMessage = error?.message || lastMessage;
    }
  }

  return { success: false, message: lastMessage };
}

/**
 * Déclenchement d'un téléchargement via le dispatcher SeenIt.
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
  let lastMessage = 'Impossible de joindre le serveur SeenIt.';

  for (const endpoint of getBackendEndpoints('/api/downloads/push')) {
    try {
      const response = await authenticatedFetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(12000)
      });

      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        return {
          success: true,
          message: data.message || 'Téléchargement envoyé avec succès !'
        };
      }

      lastMessage = data.error || data.message || `Erreur serveur (${response.status})`;
      if ([400, 401, 403].includes(response.status)) {
        return { success: false, message: lastMessage };
      }
    } catch (error: any) {
      lastMessage = error?.message || lastMessage;
    }
  }

  return { success: false, message: lastMessage };
}
