function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count === 1 ? singular : pluralForm;
}

export function formatPlexElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(Number(elapsedMs) / 1000));
  if (totalSeconds < 60) return `${totalSeconds} s`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes} min ${seconds} s` : `${minutes} min`;
}

/**
 * Le backend Plex répond en une seule requête : avant sa réponse on affiche donc
 * une phase réelle et la durée écoulée, jamais un faux pourcentage.
 */
export function formatPlexWaitingStatus(delta: boolean, elapsedMs: number): string {
  const elapsed = formatPlexElapsed(elapsedMs);
  return delta
    ? `Sync rapide Plex • état vu courant • ${elapsed}`
    : `Scan complet Plex • inventaire des bibliothèques • ${elapsed}`;
}

export function formatPlexCompletionSummary(
  scannedServers: number,
  watchedCount: number,
  unwatchedCount: number
): string {
  const servers = Math.max(0, Number(scannedServers) || 0);
  const watched = Math.max(0, Number(watchedCount) || 0);
  const unwatched = Math.max(0, Number(unwatchedCount) || 0);

  return `Synchronisation Plex terminée • ${servers} ${plural(servers, 'serveur')} ${plural(servers, 'scanné')} • ` +
    `${watched} ${plural(watched, 'vu')} • ${unwatched} ${plural(unwatched, 'non vu', 'non vus')}`;
}
