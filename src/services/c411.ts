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
 * Recherche des torrents sur C411 via le backend SeenIt
 */
export async function searchC411Torrents(params: C411SearchParams): Promise<C411Torrent[]> {
  try {
    const queryParams = new URLSearchParams();
    queryParams.set('query', params.query);
    if (params.mediaType) queryParams.set('mediaType', params.mediaType);
    if (params.year) queryParams.set('year', String(params.year));
    if (params.apiKey) queryParams.set('apiKey', params.apiKey);

    const endpoints = [
      'https://ais-pre-mooctibtw2amkshvkzlqij-700628279309.europe-west2.run.app/api/c411/search',
      'https://ais-dev-mooctibtw2amkshvkzlqij-700628279309.europe-west2.run.app/api/c411/search',
      '/api/c411/search'
    ];

    let lastError: Error | null = null;
    for (const ep of endpoints) {
      try {
        const url = `${ep}?${queryParams.toString()}`;
        const res = await fetch(url, {
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(10000)
        });
        if (res.ok) {
          const data = await res.json();
          return (data.torrents || []).map((t: C411Torrent) => ({
            ...t,
            magnetUri: t.infoHash ? buildMagnetLink(t.infoHash, t.name) : undefined
          }));
        }
      } catch (err: any) {
        lastError = err;
      }
    }
    if (lastError) throw lastError;
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
