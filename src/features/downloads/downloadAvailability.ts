export interface DownloadAvailability {
  reason: 'no_release' | 'unconfirmed';
  automatic: boolean;
}

export function parseDownloadAvailability(value: unknown): DownloadAvailability | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const data = value as Record<string, unknown>;
  return (data.reason === 'no_release' || data.reason === 'unconfirmed') && typeof data.automatic === 'boolean'
    ? { reason: data.reason, automatic: data.reason === 'no_release' && data.automatic } : undefined;
}

interface AvailabilityItem {
  status?: string;
  requestId?: string;
  mediaType: 'movie' | 'tv';
  tmdbId?: number;
  seasonNumber?: number;
  episodeNumber?: number;
  addedAt?: number;
  downloadId?: string;
  downloadIdAliases?: string[];
}

export function availabilityHint(availability?: DownloadAvailability): string {
  if (availability?.reason !== 'no_release') return 'Recherche interrompue · disponibilité à vérifier';
  return availability.automatic
    ? 'Surveillance active · téléchargement automatique dès disponibilité d’une release compatible'
    : 'Aucune release compatible · surveillance automatique à vérifier';
}

/** Un transfert ancien, un autre scope ou un titre similaire ne clôt jamais l'attente. */
export function canHandoffAvailability(request: AvailabilityItem, remote: AvailabilityItem): boolean {
  return request.status === 'waiting' && Boolean(request.requestId) && Boolean(request.tmdbId)
    && request.mediaType === remote.mediaType && Number(request.tmdbId) === Number(remote.tmdbId)
    && !request.downloadId && !request.downloadIdAliases?.length
    && Number(request.addedAt) > 0 && Number(remote.addedAt) >= Number(request.addedAt) - 5_000
    && (request.mediaType === 'movie' || (
      (request.seasonNumber ?? null) === (remote.seasonNumber ?? null)
      && (request.episodeNumber ?? null) === (remote.episodeNumber ?? null)
    ));
}
