export interface DownloadRenderIdentity {
  id: string;
  requestId?: string;
}

/**
 * L'identifiant du client distant peut changer pendant la réconciliation
 * (opt_* → radarr_* / sonarr_* / qbit_*). La requestId SeenIt reste stable et
 * doit donc piloter la clé React pour ne pas démonter/remonter la carte.
 */
export function getStableDownloadRenderKey(item: DownloadRenderIdentity): string {
  return item.requestId || item.id;
}

/**
 * Le premier poster connu sur une carte est celui qui accompagne la demande
 * SeenIt issue de la fiche. Une télémétrie distante ne doit jamais remplacer
 * ce visuel pendant la vie de la carte.
 */
export function selectStableDownloadPosterPath(
  lockedPosterPath?: string,
  incomingPosterPath?: string
): string | undefined {
  return lockedPosterPath || incomingPosterPath;
}

/**
 * Quand une représentation distante fournit son propre poster, le visuel de
 * la demande SeenIt reste prioritaire. Le distant n'est qu'un fallback si la
 * fiche n'avait aucun visuel.
 */
export function preferSeenItImagePath(
  remotePath?: string,
  seenItPath?: string
): string | undefined {
  return seenItPath || remotePath;
}
