/** Champs d'une notification reçue lus par la déduplication (sous-ensemble d'InboxNotification). */
export interface ReceivedLike { data: Record<string, unknown>; receivedAt: number }

const episodePair = (seasonValue: unknown, episodeValue: unknown) => {
  const season = Number(seasonValue), episode = Number(episodeValue);
  return seasonValue !== undefined && episodeValue !== undefined && seasonValue !== null && episodeValue !== null && Number.isInteger(season) && Number.isInteger(episode) ? { season, episode } : undefined;
};

/**
 * Épisode annoncé par une notification reçue. Un rappel de sortie porte la sortie dans
 * `releasedSeason`/`releasedEpisode` ; `season`/`episode` y désignent l'épisode à reprendre (cible de
 * « Vu »), différent en cas de retard. La sortie annoncée prime donc, `season`/`episode` en repli.
 */
export function receivedEpisode(item: ReceivedLike): { season: number; episode: number } | undefined {
  return episodePair(item.data.releasedSeason, item.data.releasedEpisode) || episodePair(item.data.season, item.data.episode);
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
