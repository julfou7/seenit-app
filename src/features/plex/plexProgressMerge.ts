import type { Show } from '../../types.ts';
import { normalizePlexEpisodeKey } from './plexIdentity.ts';
import type { PlexLibraryWatchState } from './plexLibraryWatchState.ts';

function cloneShow(show: Show): Show {
  return {
    ...show,
    seenEpisodes: [...(show.seenEpisodes || [])],
    episodeRecords: { ...(show.episodeRecords || {}) },
    plexWatchState: { ...(show.plexWatchState || {}) }
  };
}

function recomputeLastWatchedAt(records: Show['episodeRecords']): number | undefined {
  const timestamps = Object.values(records || {})
    .map(record => Number(record?.watchedAt))
    .filter(value => Number.isFinite(value) && value > 0);
  return timestamps.length > 0 ? Math.max(...timestamps) : undefined;
}

function getWatchStateStorageKey(state: PlexLibraryWatchState): string {
  return state.mediaType === 'movie'
    ? 'movie'
    : `${state.seasonNumber}x${state.episodeNumber}`;
}

function isPlexOwnedProgressRecord(record: unknown): boolean {
  return Boolean(record && typeof record === 'object' && (record as Record<string, unknown>).plexImported === true);
}

function hasPlexOwnedProgress(show: Show, state: PlexLibraryWatchState): boolean {
  if (state.mediaType === 'movie') {
    return isPlexOwnedProgressRecord(show.episodeRecords?.movie);
  }

  const expectedKey = `${state.seasonNumber}x${state.episodeNumber}`;
  return Object.entries(show.episodeRecords || {}).some(
    ([key, record]) => normalizePlexEpisodeKey(key) === expectedKey && isPlexOwnedProgressRecord(record)
  );
}

/**
 * Le miroir `plexWatchState` décrit uniquement l'état observé côté Plex. Il ne donne
 * jamais à Plex la propriété d'une progression SeenIt. Un `viewCount=0` ne peut donc
 * retirer que le film/épisode dont l'enregistrement porte explicitement
 * `plexImported=true`, c'est-à-dire une progression réellement créée par la synchro
 * Plex. Les progressions manuelles, importées ailleurs et legacy sans provenance
 * certaine sont conservées par défaut.
 */
export function applyPlexLibraryWatchState(
  input: Show,
  state: PlexLibraryWatchState
): { show: Show; changed: boolean; unwatchApplied: boolean } {
  if (Number(input.tmdbId) !== Number(state.tmdbId)) {
    return { show: input, changed: false, unwatchApplied: false };
  }
  if (state.mediaType === 'movie' && input.mediaType !== 'movie') {
    return { show: input, changed: false, unwatchApplied: false };
  }
  if (state.mediaType === 'episode' && input.mediaType !== 'tv') {
    return { show: input, changed: false, unwatchApplied: false };
  }

  const storageKey = getWatchStateStorageKey(state);
  const previousPlexState = input.plexWatchState?.[storageKey];
  const stateChanged = previousPlexState !== state.watched;
  // La provenance `plexImported` est l'unique preuve de propriété. Le miroir peut être
  // absent sur une progression Plex plus ancienne et ne doit jamais bloquer un dé-vu
  // explicitement confirmé par Plex.
  const shouldUnwatch = state.watched === false
    && hasPlexOwnedProgress(input, state);

  if (!stateChanged && !shouldUnwatch) {
    return { show: input, changed: false, unwatchApplied: false };
  }

  const show = cloneShow(input);
  show.plexWatchState = { ...(show.plexWatchState || {}), [storageKey]: state.watched };
  let progressChanged = false;

  if (shouldUnwatch && state.mediaType === 'movie') {
    const nextSeen = show.seenEpisodes.filter(key => key !== 'movie');
    if (nextSeen.length !== show.seenEpisodes.length) progressChanged = true;
    show.seenEpisodes = nextSeen;
    if (isPlexOwnedProgressRecord(show.episodeRecords.movie)) {
      delete show.episodeRecords.movie;
      progressChanged = true;
    }
    if (progressChanged && show.status === 'completed') show.status = 'plan_to_watch';
  } else if (shouldUnwatch && state.mediaType === 'episode') {
    const expectedKey = `${state.seasonNumber}x${state.episodeNumber}`;
    const plexOwnedKeys = Object.entries(show.episodeRecords)
      .filter(([key, record]) => normalizePlexEpisodeKey(key) === expectedKey && isPlexOwnedProgressRecord(record))
      .map(([key]) => key);

    if (plexOwnedKeys.length > 0) {
      const nextSeen = show.seenEpisodes.filter(key => normalizePlexEpisodeKey(key) !== expectedKey);
      if (nextSeen.length !== show.seenEpisodes.length) progressChanged = true;
      show.seenEpisodes = nextSeen;

      for (const key of plexOwnedKeys) {
        delete show.episodeRecords[key];
        progressChanged = true;
      }
    }

    if (progressChanged && show.status !== 'dropped') {
      show.status = show.seenEpisodes.length > 0 ? 'watching' : 'plan_to_watch';
    }
  }

  if (progressChanged) {
    show.lastWatchedAt = recomputeLastWatchedAt(show.episodeRecords);
    show.updatedAt = Date.now();
  }

  return {
    show,
    changed: stateChanged || progressChanged,
    unwatchApplied: progressChanged
  };
}

function normalizedSet(keys: string[]): Set<string> {
  return new Set(keys.map(key => normalizePlexEpisodeKey(key) || key));
}

/**
 * Applique au document Firestore courant uniquement les changements de progression
 * produits par cette synchro Plex par rapport à son snapshot de départ. Cela permet
 * un vrai dé-vu Plex sans écraser une action SeenIt concurrente sur un autre épisode.
 */
export function mergePlexProgressMutation(
  current: Partial<Show> | null | undefined,
  baseline: Partial<Show> | null | undefined,
  candidate: Show
): Show {
  if (!current || !baseline) return candidate;

  const baselineSeen = normalizedSet(Array.isArray(baseline.seenEpisodes) ? baseline.seenEpisodes : []);
  const candidateSeen = normalizedSet(candidate.seenEpisodes || []);
  const currentEntries = Array.isArray(current.seenEpisodes) ? current.seenEpisodes : [];

  const removed = new Set([...baselineSeen].filter(key => !candidateSeen.has(key)));
  const added = new Set([...candidateSeen].filter(key => !baselineSeen.has(key)));

  const nextSeen = currentEntries.filter(key => !removed.has(normalizePlexEpisodeKey(key) || key));
  for (const key of candidate.seenEpisodes || []) {
    const normalized = normalizePlexEpisodeKey(key) || key;
    if (added.has(normalized) && !nextSeen.some(existing => (normalizePlexEpisodeKey(existing) || existing) === normalized)) {
      nextSeen.push(key);
    }
  }

  const nextRecords: Show['episodeRecords'] = { ...((current.episodeRecords || {}) as Show['episodeRecords']) };
  const baselineRecordKeys = normalizedSet(Object.keys(baseline.episodeRecords || {}));
  const candidateRecordKeys = normalizedSet(Object.keys(candidate.episodeRecords || {}));
  const removedRecordKeys = new Set([...baselineRecordKeys].filter(key => !candidateRecordKeys.has(key)));

  for (const key of Object.keys(nextRecords)) {
    if (removedRecordKeys.has(normalizePlexEpisodeKey(key) || key)) delete nextRecords[key];
  }
  for (const [key, record] of Object.entries(candidate.episodeRecords || {})) {
    const normalized = normalizePlexEpisodeKey(key) || key;
    const existedInBaseline = baselineRecordKeys.has(normalized);
    const baselineRecord = Object.entries(baseline.episodeRecords || {}).find(
      ([baselineKey]) => (normalizePlexEpisodeKey(baselineKey) || baselineKey) === normalized
    )?.[1];
    const changedByPlex = !existedInBaseline || JSON.stringify(baselineRecord) !== JSON.stringify(record);
    if (changedByPlex) {
      nextRecords[key] = { ...(nextRecords[key] || {}), ...record };
    }
  }

  const merged: Show = {
    ...(current as Show),
    ...candidate,
    seenEpisodes: nextSeen,
    episodeRecords: nextRecords,
    plexWatchState: {
      ...((current.plexWatchState || {}) as Record<string, boolean>),
      ...(candidate.plexWatchState || {})
    },
    lastWatchedAt: recomputeLastWatchedAt(nextRecords),
    updatedAt: Math.max(Number(current.updatedAt) || 0, Number(candidate.updatedAt) || 0)
  };

  if (current.isArchived !== undefined) merged.isArchived = current.isArchived;
  if (current.isFavorite !== undefined) merged.isFavorite = current.isFavorite;
  if (current.notificationsEnabled !== undefined) merged.notificationsEnabled = current.notificationsEnabled;
  if (current.userRating !== undefined) merged.userRating = current.userRating;

  const progressChanged = removed.size > 0 || added.size > 0 || removedRecordKeys.size > 0;
  if (!progressChanged && current.status) merged.status = current.status;
  else if (candidate.mediaType === 'movie') {
    merged.status = nextSeen.includes('movie') ? 'completed' : (current.status === 'dropped' ? 'dropped' : 'plan_to_watch');
  } else if (current.status === 'dropped') {
    merged.status = 'dropped';
  } else {
    merged.status = nextSeen.length > 0 ? 'watching' : 'plan_to_watch';
  }

  return merged;
}
