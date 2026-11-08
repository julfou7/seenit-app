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
    ? 'Surveillé : il partira seul dès qu’une version compatible sortira.'
    : 'Aucune version compatible · surveillance automatique à vérifier';
}

/**
 * Retour terrain du 08/11 : le toast d'une demande sans release tient sur une ligne ; le détail de
 * l'attente reste sur sa carte, dans la section « En attente » de l'onglet Télécharger.
 */
export function noReleaseToastAction(availability?: DownloadAvailability): string {
  return availability?.reason === 'no_release' && availability.automatic ? 'Pas encore disponible · en attente' : 'Pas encore disponible · à vérifier';
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
