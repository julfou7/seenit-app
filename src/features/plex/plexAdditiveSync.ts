import type { Show } from '../../types';

type ExistingSeenItState = Partial<Show> | null | undefined;

function mergeEpisodeRecords(
  plexRecords: Show['episodeRecords'] | undefined,
  seenItRecords: Show['episodeRecords'] | undefined
): Show['episodeRecords'] {
  const merged: Show['episodeRecords'] = { ...(plexRecords || {}) };

  for (const [key, seenItRecord] of Object.entries(seenItRecords || {})) {
    merged[key] = {
      ...(merged[key] || {}),
      ...seenItRecord
    };
  }

  return merged;
}

function maxOptionalTimestamp(a: unknown, b: unknown): number | undefined {
  const values = [Number(a), Number(b)].filter(value => Number.isFinite(value) && value > 0);
  return values.length > 0 ? Math.max(...values) : undefined;
}

/**
 * Fusion finale avant écriture d'une synchro Plex.
 *
 * Plex est une source additive : il peut apporter de nouveaux visionnages, mais une
 * absence de visionnage / un « dé-vu » Plex n'est jamais une instruction de retrait.
 * Les marqueurs et métadonnées déjà présents dans SeenIt sont donc conservés, y
 * compris lorsqu'ils ont été modifiés pendant que la synchro Plex était en cours.
 */
export function mergeAdditivePlexProgress(
  currentSeenItState: ExistingSeenItState,
  plexCandidate: Show
): Show {
  if (!currentSeenItState) return plexCandidate;

  const seenItEpisodes = Array.isArray(currentSeenItState.seenEpisodes)
    ? currentSeenItState.seenEpisodes
    : [];
  const plexEpisodes = Array.isArray(plexCandidate.seenEpisodes)
    ? plexCandidate.seenEpisodes
    : [];
  const seenEpisodes = [...new Set([...seenItEpisodes, ...plexEpisodes])];

  const episodeRecords = mergeEpisodeRecords(
    plexCandidate.episodeRecords,
    currentSeenItState.episodeRecords
  );

  const plexAddsWatchEvidence = plexEpisodes.some(key => !seenItEpisodes.includes(key)) ||
    Object.keys(plexCandidate.episodeRecords || {}).some(
      key => !Object.prototype.hasOwnProperty.call(currentSeenItState.episodeRecords || {}, key)
    );

  let status = plexCandidate.status;
  if (currentSeenItState.status) {
    // Les statuts manuels existants restent prioritaires. Seul un média encore « à voir »
    // peut progresser automatiquement lorsqu'une nouvelle preuve Plex est réellement ajoutée.
    status = currentSeenItState.status === 'plan_to_watch' && plexAddsWatchEvidence
      ? plexCandidate.status
      : currentSeenItState.status;
  }

  const merged: Show = {
    ...plexCandidate,
    seenEpisodes,
    episodeRecords,
    status,
    lastWatchedAt: maxOptionalTimestamp(
      currentSeenItState.lastWatchedAt,
      plexCandidate.lastWatchedAt
    ),
    updatedAt: Math.max(
      Number(currentSeenItState.updatedAt) || 0,
      Number(plexCandidate.updatedAt) || 0
    )
  };

  // Ces champs sont pilotés directement par l'utilisateur SeenIt et ne doivent pas
  // être remis à une valeur plus ancienne par une synchro Plex longue/concurrente.
  if (currentSeenItState.isArchived !== undefined) merged.isArchived = currentSeenItState.isArchived;
  if (currentSeenItState.isFavorite !== undefined) merged.isFavorite = currentSeenItState.isFavorite;
  if (currentSeenItState.notificationsEnabled !== undefined) {
    merged.notificationsEnabled = currentSeenItState.notificationsEnabled;
  }
  if (currentSeenItState.userRating !== undefined) merged.userRating = currentSeenItState.userRating;

  return merged;
}
