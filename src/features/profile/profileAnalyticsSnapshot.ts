import type { Show } from '../../types.ts';
import {
  readUserScopedJson,
  removeUserScopedValue,
  writeUserScopedJson,
} from '../../lib/userIsolation.ts';

export interface PersonStat {
  id: number;
  name: string;
  count: number;
  movieCount: number;
  tvCount: number;
  profile_path: string | null;
  popularity: number;
  subtitle: string;
}

export interface AnalyticsData {
  totalMinutes: number;
  totalEpisodesSeen: number;
  totalMoviesSeen: number;
  completedTvCount: number;
  favoritesCount: number;
  topShowTitle: string;
  cinephileArchetype: string;
  dominantGenre: string;
  platforms: { name: string; count: number; percentage: number }[];
  genres: { name: string; count: number; percentage: number }[];
  topActors: PersonStat[];
  topDirectors: PersonStat[];
  bingeTime: { title: string; remainingMinutes: number } | null;
}

export interface AnalyticsPersonContribution {
  id: number;
  name: string;
  profile_path: string | null;
  popularity: number;
}

export interface AnalyticsMediaContribution {
  genres: string[];
  actors: AnalyticsPersonContribution[];
  directors: AnalyticsPersonContribution[];
}

export interface ProfileAnalyticsMediaState {
  key: string;
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  watched: boolean;
  seenEpisodes: number;
  completed: boolean;
  favorite: boolean;
  platform: string;
  title: string;
  status: Show['status'];
  totalEpisodes: number;
  metadataRevision: number;
  order: number;
  fingerprint: string;
}

interface ProfileAnalyticsPersonAggregate {
  works: Record<string, {
    person: AnalyticsPersonContribution;
    position: number;
  }>;
}

interface ProfileAnalyticsAggregate {
  totalMinutes: number;
  totalEpisodesSeen: number;
  totalMoviesSeen: number;
  completedTvCount: number;
  favoritesCount: number;
  platformCounts: Record<string, number>;
  genreCounts: Record<string, number>;
  actors: Record<string, ProfileAnalyticsPersonAggregate>;
  directors: Record<string, ProfileAnalyticsPersonAggregate>;
}

interface ProfileAnalyticsContributionEntry {
  value: AnalyticsMediaContribution;
  fetchedAt: number;
  metadataRevision: number;
}

export interface ProfileAnalyticsSnapshot {
  version: number;
  algorithm: string;
  uid: string;
  signature: string;
  media: Record<string, ProfileAnalyticsMediaState>;
  contributions: Record<string, ProfileAnalyticsContributionEntry>;
  aggregate: ProfileAnalyticsAggregate;
  data: AnalyticsData;
  updatedAt: number;
}

export interface ProfileAnalyticsReconciliation {
  snapshot: ProfileAnalyticsSnapshot;
  mode: 'full-rebuild' | 'snapshot-delta' | 'snapshot-exact';
  changedMediaKeys: string[];
  metadataKeys: string[];
  scannedMediaCount: number;
}

export const PROFILE_ANALYTICS_SNAPSHOT_VERSION = 1;
export const PROFILE_ANALYTICS_ALGORITHM = 'profile-analytics-delta-v1';
export const PROFILE_ANALYTICS_STORAGE_FIELD = 'profile_analytics_snapshot_v1';
export const PROFILE_ANALYTICS_METADATA_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_PERSISTED_CONTRIBUTIONS = 512;

const emptyData = (): AnalyticsData => ({
  totalMinutes: 0,
  totalEpisodesSeen: 0,
  totalMoviesSeen: 0,
  completedTvCount: 0,
  favoritesCount: 0,
  topShowTitle: 'Aucune',
  cinephileArchetype: '🍿 Cinéphile Aguerri',
  dominantGenre: 'Aucun',
  platforms: [],
  genres: [],
  topActors: [],
  topDirectors: [],
  bingeTime: null,
});

const emptyAggregate = (): ProfileAnalyticsAggregate => ({
  totalMinutes: 0,
  totalEpisodesSeen: 0,
  totalMoviesSeen: 0,
  completedTvCount: 0,
  favoritesCount: 0,
  platformCounts: {},
  genreCounts: {},
  actors: {},
  directors: {},
});

export const getProfileAnalyticsMediaKey = (show: Pick<Show, 'mediaType' | 'tmdbId'>): string =>
  `${show.mediaType === 'movie' ? 'movie' : 'tv'}:${Number(show.tmdbId)}`;

const getPlatformName = (show: Show): string => {
  const network = String(show.networks?.[0]?.name || '');
  if (!network) return 'Autres';
  if (network.includes('Netflix')) return 'Netflix';
  if (network.includes('Apple')) return 'Apple TV+';
  if (network.includes('HBO') || network.includes('Max')) return 'HBO / Max';
  if (network.includes('Disney')) return 'Disney+';
  if (network.includes('Amazon') || network.includes('Prime')) return 'Prime Video';
  if (network.includes('Canal')) return 'Canal+';
  return network;
};

const normalizeMediaState = (
  show: Show,
  watched: boolean,
  order: number,
): ProfileAnalyticsMediaState => {
  const mediaType = show.mediaType === 'movie' ? 'movie' : 'tv';
  const seenEpisodes = mediaType === 'movie'
    ? 0
    : (show.seenEpisodes || []).filter((episode) => episode !== 'movie').length;
  const state = {
    key: getProfileAnalyticsMediaKey(show),
    mediaType,
    tmdbId: Number(show.tmdbId),
    watched,
    seenEpisodes,
    completed: show.status === 'completed',
    favorite: show.isFavorite === true,
    platform: getPlatformName(show),
    title: show.title || 'Aucune',
    status: show.status,
    totalEpisodes: Number(show.totalEpisodes) || 0,
    metadataRevision: Number(show.detailsSyncedAt) || 0,
    order,
  } satisfies Omit<ProfileAnalyticsMediaState, 'fingerprint'>;

  return {
    ...state,
    fingerprint: JSON.stringify([
      state.mediaType,
      state.tmdbId,
      state.watched,
      state.seenEpisodes,
      state.completed,
      state.favorite,
      state.platform,
      state.title,
      state.status,
      state.totalEpisodes,
    ]),
  };
};

const buildMediaMap = (
  shows: Show[],
  isWatched: (show: Show) => boolean,
): Record<string, ProfileAnalyticsMediaState> => {
  const media: Record<string, ProfileAnalyticsMediaState> = {};
  shows.forEach((show, order) => {
    if (!show?.tmdbId) return;
    const state = normalizeMediaState(show, isWatched(show), order);
    if (!media[state.key]) media[state.key] = state;
  });
  return media;
};

const hashString = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const buildMediaSignature = (media: Record<string, ProfileAnalyticsMediaState>): string => {
  const canonical = Object.values(media)
    .map((state) => `${state.key}:${state.fingerprint}:${state.metadataRevision}`)
    .sort()
    .join('|');
  return `${Object.keys(media).length}-${hashString(canonical)}`;
};

const adjustCount = (target: Record<string, number>, key: string, delta: number) => {
  const next = (target[key] || 0) + delta;
  if (next > 0) target[key] = next;
  else delete target[key];
};

const applyBaseState = (
  aggregate: ProfileAnalyticsAggregate,
  state: ProfileAnalyticsMediaState,
  direction: 1 | -1,
) => {
  if (state.favorite) aggregate.favoritesCount += direction;

  if (state.mediaType === 'movie') {
    if (!state.watched) return;
    aggregate.totalMoviesSeen += direction;
    aggregate.totalMinutes += 110 * direction;
    adjustCount(aggregate.platformCounts, state.platform, direction);
    return;
  }

  aggregate.totalEpisodesSeen += state.seenEpisodes * direction;
  aggregate.totalMinutes += state.seenEpisodes * 45 * direction;
  if (state.completed) aggregate.completedTvCount += direction;
  if (state.seenEpisodes > 0 || state.watched) {
    adjustCount(aggregate.platformCounts, state.platform, direction);
  }
};

const applyPersonContribution = (
  target: Record<string, ProfileAnalyticsPersonAggregate>,
  mediaKey: string,
  people: AnalyticsPersonContribution[],
  direction: 1 | -1,
) => {
  people.forEach((person, position) => {
    const personKey = String(person.id);
    if (direction === 1) {
      const aggregate = target[personKey] || { works: {} };
      aggregate.works[mediaKey] = { person, position };
      target[personKey] = aggregate;
      return;
    }

    const aggregate = target[personKey];
    if (!aggregate) return;
    delete aggregate.works[mediaKey];
    if (Object.keys(aggregate.works).length === 0) delete target[personKey];
  });
};

const applyMetadataContribution = (
  aggregate: ProfileAnalyticsAggregate,
  state: ProfileAnalyticsMediaState,
  contribution: AnalyticsMediaContribution,
  direction: 1 | -1,
) => {
  contribution.genres.forEach((genre) => adjustCount(aggregate.genreCounts, genre, direction));
  applyPersonContribution(aggregate.actors, state.key, contribution.actors, direction);
  applyPersonContribution(aggregate.directors, state.key, contribution.directors, direction);
};

export function getArchetypeForGenre(genreName: string): string {
  const genre = (genreName || '').toLowerCase();
  if (genre.includes('thriller') || genre.includes('drame') || genre.includes('drama')) return '🔥 Marathonneur de Thrillers';
  if (genre.includes('science-fiction') || genre.includes('sci-fi') || genre.includes('sf')) return '🚀 Explorateur Sci-Fi';
  if (genre.includes('action') || genre.includes('aventure') || genre.includes('adventure')) return '💥 Amateur d\'Adrénaline';
  if (genre.includes('comédie') || genre.includes('comedy')) return '😂 Amateur de Comédies';
  if (genre.includes('animation') || genre.includes('anime')) return '🎨 Passionné d\'Animation';
  if (genre.includes('crime') || genre.includes('policier')) return '🕵️ Enquêteur du Crime';
  if (genre.includes('horreur') || genre.includes('horror')) return '👻 Chasseur de Frissons';
  if (genre.includes('romance')) return '💌 Romantique Incurable';
  if (genre.includes('fantastique') || genre.includes('fantasy')) return '🧙 Quintessence Fantasy';
  if (genre.includes('doc')) return '🔍 Curieux de Réel';
  return '🍿 Cinéphile Aguerri';
}

const buildPersonStats = (
  people: Record<string, ProfileAnalyticsPersonAggregate>,
  role: 'actor' | 'director',
  media: Record<string, ProfileAnalyticsMediaState>,
): PersonStat[] => Object.entries(people)
  .map(([id, aggregate]) => {
    const works = Object.entries(aggregate.works);
    const movieCount = works.filter(([mediaKey]) => mediaKey.startsWith('movie:')).length;
    const tvCount = works.length - movieCount;
    const metadata = works
      .map(([mediaKey, work]) => ({
        mediaKey,
        ...work,
        mediaOrder: media[mediaKey]?.order ?? Number.MAX_SAFE_INTEGER,
      }))
      .sort((left, right) => (
        left.mediaOrder - right.mediaOrder
        || left.position - right.position
        || left.mediaKey.localeCompare(right.mediaKey)
      ));
    const primary = metadata[0]?.person;
    const profile = metadata.find(({ person }) => person.profile_path)?.person.profile_path || null;
    const popularity = metadata.reduce((maximum, { person }) => Math.max(maximum, person.popularity), 0);
    let subtitle = '';
    if (role === 'director') {
      if (tvCount > 0 && movieCount === 0) subtitle = `${tvCount} ${tvCount > 1 ? 'séries créées' : 'série créée'}`;
      else if (movieCount > 0 && tvCount === 0) subtitle = `${movieCount} ${movieCount > 1 ? 'films vus' : 'film vu'}`;
      else subtitle = `${tvCount} ${tvCount > 1 ? 'séries créées' : 'série créée'} · ${movieCount} ${movieCount > 1 ? 'films vus' : 'film vu'}`;
    } else if (tvCount > 0 && movieCount === 0) subtitle = `${tvCount} ${tvCount > 1 ? 'séries vues' : 'série vue'}`;
    else if (movieCount > 0 && tvCount === 0) subtitle = `${movieCount} ${movieCount > 1 ? 'films vus' : 'film vu'}`;
    else subtitle = `${movieCount} ${movieCount > 1 ? 'films' : 'film'} · ${tvCount} ${tvCount > 1 ? 'séries' : 'série'} vus`;

    return {
      firstMediaOrder: metadata[0]?.mediaOrder ?? Number.MAX_SAFE_INTEGER,
      firstPosition: metadata[0]?.position ?? Number.MAX_SAFE_INTEGER,
      stat: {
        id: Number(id),
        name: primary?.name || '',
        count: works.length,
        movieCount,
        tvCount,
        profile_path: profile,
        popularity,
        subtitle,
      },
    };
  })
  .filter(({ stat }) => stat.count > 0)
  .sort((left, right) => (
    right.stat.count - left.stat.count
    || right.stat.popularity - left.stat.popularity
    || left.firstMediaOrder - right.firstMediaOrder
    || left.firstPosition - right.firstPosition
    || left.stat.id - right.stat.id
  ))
  .slice(0, 20)
  .map(({ stat }) => stat);

const buildData = (
  snapshot: Pick<ProfileAnalyticsSnapshot, 'aggregate' | 'media' | 'data'>,
  rebuildAdvanced: boolean,
): AnalyticsData => {
  const { aggregate } = snapshot;
  const totalPlatformItems = Object.values(aggregate.platformCounts).reduce((sum, count) => sum + count, 0) || 1;
  const platforms = Object.entries(aggregate.platformCounts)
    .map(([name, count]) => ({ name, count, percentage: Math.round((count / totalPlatformItems) * 100) }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
    .slice(0, 4);

  const orderedTv = Object.values(snapshot.media)
    .filter((state) => state.mediaType === 'tv')
    .sort((left, right) => left.order - right.order || left.key.localeCompare(right.key));
  const topShow = orderedTv.reduce<ProfileAnalyticsMediaState | null>((current, state) => (
    !current || state.seenEpisodes > current.seenEpisodes ? state : current
  ), null);
  const binge = orderedTv.reduce<ProfileAnalyticsMediaState | null>((current, state) => {
    if (state.status !== 'watching') return current;
    const remaining = state.totalEpisodes - state.seenEpisodes;
    const currentRemaining = current ? current.totalEpisodes - current.seenEpisodes : 0;
    return remaining > currentRemaining ? state : current;
  }, null);

  let genres = snapshot.data.genres;
  let topActors = snapshot.data.topActors;
  let topDirectors = snapshot.data.topDirectors;
  let dominantGenre = snapshot.data.dominantGenre;
  let cinephileArchetype = snapshot.data.cinephileArchetype;
  if (rebuildAdvanced) {
    const totalGenreWeight = Object.values(aggregate.genreCounts).reduce((sum, count) => sum + count, 0) || 1;
    genres = Object.entries(aggregate.genreCounts)
      .map(([name, count]) => ({ name, count, percentage: Math.round((count / totalGenreWeight) * 100) }))
      .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
      .slice(0, 4);
    dominantGenre = genres[0]?.name || (Object.keys(snapshot.media).length === 0 ? 'Aucun' : 'Général');
    cinephileArchetype = getArchetypeForGenre(dominantGenre);
    topActors = buildPersonStats(aggregate.actors, 'actor', snapshot.media);
    topDirectors = buildPersonStats(aggregate.directors, 'director', snapshot.media);
  }

  const bingeRemaining = binge ? binge.totalEpisodes - binge.seenEpisodes : 0;
  return {
    totalMinutes: Math.max(0, aggregate.totalMinutes),
    totalEpisodesSeen: Math.max(0, aggregate.totalEpisodesSeen),
    totalMoviesSeen: Math.max(0, aggregate.totalMoviesSeen),
    completedTvCount: Math.max(0, aggregate.completedTvCount),
    favoritesCount: Math.max(0, aggregate.favoritesCount),
    topShowTitle: topShow?.title || 'Aucune',
    cinephileArchetype,
    dominantGenre,
    platforms,
    genres,
    topActors,
    topDirectors,
    bingeTime: binge && bingeRemaining > 0
      ? { title: binge.title, remainingMinutes: bingeRemaining * 45 }
      : null,
  };
};

const isRecord = (value: unknown): value is Record<string, any> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const isValidAnalyticsContribution = (value: unknown): value is AnalyticsMediaContribution => {
  if (!isRecord(value) || !Array.isArray(value.genres) || !Array.isArray(value.actors) || !Array.isArray(value.directors)) return false;
  const validPerson = (person: unknown) => isRecord(person)
    && Number.isFinite(Number(person.id))
    && typeof person.name === 'string'
    && (person.profile_path === null || typeof person.profile_path === 'string')
    && Number.isFinite(Number(person.popularity));
  return value.genres.every((genre: unknown) => typeof genre === 'string')
    && value.actors.every(validPerson)
    && value.directors.every(validPerson);
};

const isFiniteNonNegative = (value: unknown) => Number.isFinite(value) && Number(value) >= 0;

const isValidCountRecord = (value: unknown) => isRecord(value)
  && Object.values(value).every((count) => Number.isFinite(count) && Number(count) > 0);

const isValidPersonAggregate = (value: unknown) => isRecord(value)
  && isRecord(value.works)
  && Object.values(value.works).every((work) => isRecord(work)
    && isFiniteNonNegative(work.position)
    && isRecord(work.person)
    && Number.isFinite(Number(work.person.id))
    && typeof work.person.name === 'string'
    && (work.person.profile_path === null || typeof work.person.profile_path === 'string')
    && Number.isFinite(Number(work.person.popularity)));

const isValidAggregate = (value: unknown) => isRecord(value)
  && isFiniteNonNegative(value.totalMinutes)
  && isFiniteNonNegative(value.totalEpisodesSeen)
  && isFiniteNonNegative(value.totalMoviesSeen)
  && isFiniteNonNegative(value.completedTvCount)
  && isFiniteNonNegative(value.favoritesCount)
  && isValidCountRecord(value.platformCounts)
  && isValidCountRecord(value.genreCounts)
  && isRecord(value.actors)
  && Object.values(value.actors).every(isValidPersonAggregate)
  && isRecord(value.directors)
  && Object.values(value.directors).every(isValidPersonAggregate);

const isValidMediaState = (value: unknown, key: string) => isRecord(value)
  && value.key === key
  && (value.mediaType === 'movie' || value.mediaType === 'tv')
  && Number.isFinite(value.tmdbId)
  && Number(value.tmdbId) > 0
  && typeof value.watched === 'boolean'
  && isFiniteNonNegative(value.seenEpisodes)
  && typeof value.completed === 'boolean'
  && typeof value.favorite === 'boolean'
  && typeof value.platform === 'string'
  && typeof value.title === 'string'
  && typeof value.status === 'string'
  && isFiniteNonNegative(value.totalEpisodes)
  && isFiniteNonNegative(value.metadataRevision)
  && isFiniteNonNegative(value.order)
  && typeof value.fingerprint === 'string';

const isValidData = (value: unknown) => isRecord(value)
  && isFiniteNonNegative(value.totalMinutes)
  && isFiniteNonNegative(value.totalEpisodesSeen)
  && isFiniteNonNegative(value.totalMoviesSeen)
  && isFiniteNonNegative(value.completedTvCount)
  && isFiniteNonNegative(value.favoritesCount)
  && typeof value.topShowTitle === 'string'
  && typeof value.cinephileArchetype === 'string'
  && typeof value.dominantGenre === 'string'
  && Array.isArray(value.platforms)
  && Array.isArray(value.genres)
  && Array.isArray(value.topActors)
  && Array.isArray(value.topDirectors)
  && (value.bingeTime === null || isRecord(value.bingeTime));

export const isValidProfileAnalyticsSnapshot = (
  value: unknown,
  uid: string,
): value is ProfileAnalyticsSnapshot => {
  if (!isRecord(value)
    || value.version !== PROFILE_ANALYTICS_SNAPSHOT_VERSION
    || value.algorithm !== PROFILE_ANALYTICS_ALGORITHM
    || value.uid !== uid
    || typeof value.signature !== 'string'
    || !isRecord(value.media)
    || !isRecord(value.contributions)
    || !isValidAggregate(value.aggregate)
    || !isValidData(value.data)
    || !Number.isFinite(value.updatedAt)) return false;

  return Object.entries(value.media).every(([key, state]) => isValidMediaState(state, key))
    && Object.values(value.contributions).every((entry: any) => (
    isRecord(entry)
      && Number.isFinite(entry.fetchedAt)
      && isFiniteNonNegative(entry.metadataRevision)
      && isValidAnalyticsContribution(entry.value)
  ));
};

export const readProfileAnalyticsSnapshot = (uid: string): ProfileAnalyticsSnapshot | null => {
  const stored = readUserScopedJson<unknown>(uid, PROFILE_ANALYTICS_STORAGE_FIELD, null);
  if (isValidProfileAnalyticsSnapshot(stored, uid)) return stored;
  if (stored !== null) removeUserScopedValue(uid, PROFILE_ANALYTICS_STORAGE_FIELD);
  return null;
};

export const writeProfileAnalyticsSnapshot = (snapshot: ProfileAnalyticsSnapshot): void => {
  writeUserScopedJson(snapshot.uid, PROFILE_ANALYTICS_STORAGE_FIELD, snapshot);
};

const createEmptySnapshot = (uid: string, now: number): ProfileAnalyticsSnapshot => ({
  version: PROFILE_ANALYTICS_SNAPSHOT_VERSION,
  algorithm: PROFILE_ANALYTICS_ALGORITHM,
  uid,
  signature: '',
  media: {},
  contributions: {},
  aggregate: emptyAggregate(),
  data: emptyData(),
  updatedAt: now,
});

const pruneContributions = (snapshot: ProfileAnalyticsSnapshot) => {
  const entries = Object.entries(snapshot.contributions);
  if (entries.length <= MAX_PERSISTED_CONTRIBUTIONS) return;
  const retained = new Set(Object.keys(snapshot.media));
  entries
    .filter(([key]) => !retained.has(key))
    .sort((left, right) => left[1].fetchedAt - right[1].fetchedAt)
    .slice(0, entries.length - MAX_PERSISTED_CONTRIBUTIONS)
    .forEach(([key]) => { delete snapshot.contributions[key]; });
};

export const reconcileProfileAnalyticsSnapshot = ({
  uid,
  shows,
  isWatched,
  previous,
  now = Date.now(),
}: {
  uid: string;
  shows: Show[];
  isWatched: (show: Show) => boolean;
  previous?: ProfileAnalyticsSnapshot | null;
  now?: number;
}): ProfileAnalyticsReconciliation => {
  const currentMedia = buildMediaMap(shows, isWatched);
  const signature = buildMediaSignature(currentMedia);
  const reusable = previous && isValidProfileAnalyticsSnapshot(previous, uid);
  const snapshot = reusable ? previous : createEmptySnapshot(uid, now);
  const changedMediaKeys = new Set<string>();
  const metadataKeys = new Set<string>();
  let advancedDirty = !reusable;

  if (reusable && snapshot.signature === signature) {
    Object.entries(currentMedia).forEach(([key, state]) => {
      snapshot.media[key].order = state.order;
      const contribution = snapshot.contributions[key];
      if (state.watched && (
        !contribution
        || contribution.metadataRevision !== state.metadataRevision
        || now - contribution.fetchedAt >= PROFILE_ANALYTICS_METADATA_TTL_MS
      )) {
        metadataKeys.add(key);
      }
    });
    snapshot.updatedAt = now;
    return {
      snapshot,
      mode: 'snapshot-exact',
      changedMediaKeys: [],
      metadataKeys: Array.from(metadataKeys),
      scannedMediaCount: Object.keys(currentMedia).length,
    };
  }

  const previousMedia = snapshot.media;
  Object.entries(previousMedia).forEach(([key, oldState]) => {
    const nextState = currentMedia[key];
    if (nextState && nextState.fingerprint === oldState.fingerprint) return;
    changedMediaKeys.add(key);
    applyBaseState(snapshot.aggregate, oldState, -1);
    const contribution = snapshot.contributions[key];
    if (oldState.watched && contribution && (!nextState || !nextState.watched)) {
      applyMetadataContribution(snapshot.aggregate, oldState, contribution.value, -1);
      advancedDirty = true;
    }
  });

  Object.entries(currentMedia).forEach(([key, nextState]) => {
    const oldState = previousMedia[key];
    const contribution = snapshot.contributions[key];
    const baseChanged = !oldState || oldState.fingerprint !== nextState.fingerprint;
    if (baseChanged) {
      changedMediaKeys.add(key);
      applyBaseState(snapshot.aggregate, nextState, 1);
      if (nextState.watched && contribution && (!oldState || !oldState.watched)) {
        applyMetadataContribution(snapshot.aggregate, nextState, contribution.value, 1);
        advancedDirty = true;
      }
    }

    if (nextState.watched && (
      !contribution
      || contribution.metadataRevision !== nextState.metadataRevision
      || now - contribution.fetchedAt >= PROFILE_ANALYTICS_METADATA_TTL_MS
    )) metadataKeys.add(key);
  });

  snapshot.media = currentMedia;
  snapshot.signature = signature;
  snapshot.updatedAt = now;
  snapshot.data = buildData(snapshot, advancedDirty);
  pruneContributions(snapshot);

  return {
    snapshot,
    mode: reusable ? 'snapshot-delta' : 'full-rebuild',
    changedMediaKeys: Array.from(changedMediaKeys),
    metadataKeys: Array.from(metadataKeys),
    scannedMediaCount: Object.keys(currentMedia).length,
  };
};

export const applyProfileAnalyticsContributions = (
  snapshot: ProfileAnalyticsSnapshot,
  entries: Array<{ mediaKey: string; contribution: AnalyticsMediaContribution }>,
  fetchedAt = Date.now(),
): ProfileAnalyticsSnapshot => {
  let changed = false;
  entries.forEach(({ mediaKey, contribution }) => {
    if (!isValidAnalyticsContribution(contribution)) return;
    const state = snapshot.media[mediaKey];
    const previous = snapshot.contributions[mediaKey];
    if (state?.watched && previous) {
      applyMetadataContribution(snapshot.aggregate, state, previous.value, -1);
    }
    snapshot.contributions[mediaKey] = {
      value: contribution,
      fetchedAt,
      metadataRevision: state?.metadataRevision || 0,
    };
    if (state?.watched) applyMetadataContribution(snapshot.aggregate, state, contribution, 1);
    changed = true;
  });
  if (!changed) return snapshot;
  snapshot.updatedAt = fetchedAt;
  snapshot.data = buildData(snapshot, true);
  pruneContributions(snapshot);
  return snapshot;
};

export const applyProfileAnalyticsContribution = (
  snapshot: ProfileAnalyticsSnapshot,
  mediaKey: string,
  contribution: AnalyticsMediaContribution,
  fetchedAt = Date.now(),
): ProfileAnalyticsSnapshot => applyProfileAnalyticsContributions(
  snapshot,
  [{ mediaKey, contribution }],
  fetchedAt,
);

export const repairProfileAnalyticsSnapshot = (
  snapshot: ProfileAnalyticsSnapshot,
  now = Date.now(),
): ProfileAnalyticsSnapshot => {
  snapshot.aggregate = emptyAggregate();
  Object.values(snapshot.media).forEach((state) => {
    applyBaseState(snapshot.aggregate, state, 1);
    const contribution = snapshot.contributions[state.key];
    if (state.watched && contribution) {
      applyMetadataContribution(snapshot.aggregate, state, contribution.value, 1);
    }
  });
  snapshot.data = buildData(snapshot, true);
  snapshot.updatedAt = now;
  return snapshot;
};
