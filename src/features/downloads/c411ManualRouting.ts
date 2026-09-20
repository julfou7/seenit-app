import { isSafeMagnetLink } from './magnetLink.ts';

export type C411ManualMediaType = 'movie' | 'tv';

interface C411ManualTorrentMetadata {
  name?: string;
  magnetUri?: unknown;
  subcategory?: {
    id?: number | string;
  };
}

export interface C411ManualClients {
  qbittorrentConfigured: boolean;
  sonarrConfigured?: boolean;
  radarrConfigured?: boolean;
}

export type C411ManualRoute =
  | {
      kind: 'qbittorrent';
      mediaType: C411ManualMediaType;
    }
  | {
      kind: 'magnet';
      mediaType: C411ManualMediaType | null;
    }
  | {
      kind: 'blocked';
      mediaType: C411ManualMediaType | null;
      message: string;
    };

export function resolveC411ManualMediaType(
  torrent: C411ManualTorrentMetadata
): C411ManualMediaType | null {
  const subcategoryId = Number(torrent.subcategory?.id);
  if (subcategoryId === 6) return 'movie';
  if (subcategoryId === 7) return 'tv';
  return null;
}

export function planC411ManualDownload(
  torrent: C411ManualTorrentMetadata,
  clients: C411ManualClients
): C411ManualRoute {
  const mediaType = resolveC411ManualMediaType(torrent);

  if (!isSafeMagnetLink(torrent.magnetUri)) {
    return {
      kind: 'blocked',
      mediaType,
      message: 'Cette release ne fournit pas de lien Magnet BTIH valide.'
    };
  }

  if (clients.qbittorrentConfigured && mediaType) {
    return { kind: 'qbittorrent', mediaType };
  }

  // Sonarr/Radarr exigent une fiche SeenIt et un TMDB ID exact. Une recherche
  // C411 globale ne transporte pas cette identité : le Magnet reste autonome.
  return { kind: 'magnet', mediaType };
}

export function getC411ManualMediaTypeLabel(
  mediaType: C411ManualMediaType | null
): string | null {
  if (mediaType === 'movie') return 'Film C411';
  if (mediaType === 'tv') return 'Série C411';
  return null;
}
