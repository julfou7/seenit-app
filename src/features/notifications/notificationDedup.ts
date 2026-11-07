/** Champs d'une notification reçue lus par la déduplication (sous-ensemble d'InboxNotification). */
export interface ReceivedLike { data: Record<string, unknown>; receivedAt: number }

/** Épisode visé par une notification reçue (`season`/`episode` du rappel natif), s'il est connu. */
export function receivedEpisode(item: ReceivedLike): { season: number; episode: number } | undefined {
  const season = Number(item.data.season), episode = Number(item.data.episode);
  return item.data.season !== undefined && item.data.episode !== undefined && Number.isInteger(season) && Number.isInteger(episode) ? { season, episode } : undefined;
}

/**
 * Retour terrain 07/11 (MobLand) : le rappel de sortie calculé n'est qu'un repli. Si la notification de cet
 * épisode a déjà été reçue (ou, sans numéro d'épisode, une notification de cette série le même jour), la
 * page n'affiche que la notification reçue — jamais deux cartes pour la même sortie.
 */
export function releaseReminderAlreadyReceived(upcoming: { season_number: number; episode_number: number }, received: readonly ReceivedLike[], today: string, dayOf: (time: number) => string): boolean {
  return received.some(item => {
    const target = receivedEpisode(item);
    return target ? target.season === upcoming.season_number && target.episode === upcoming.episode_number : dayOf(item.receivedAt) === today;
  });
}
