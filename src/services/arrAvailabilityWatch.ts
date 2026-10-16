import { auth } from '../lib/firebase';
import { tmdb } from '../features/shows/tmdb';
import { resolveCanonicalSeriesBridge } from '../features/downloads/sonarrCanonicalIdentity';
import type { DownloadAvailability } from '../features/downloads/downloadAvailability';
import { cleanUrl, executeGet, executePut } from './sonarrRadarrTransport';

interface WatchScope {
  ownerUid: string | undefined;
  service: 'sonarr' | 'radarr';
  url: string;
  apiKey: string;
  tmdbId?: number | string;
  season?: number;
  episode?: number;
}

type ArrRecord = Record<string, unknown>;
const positiveId = (value: unknown) => Number.isInteger(Number(value)) && Number(value) > 0;
function records(value: unknown): ArrRecord[] {
  if (!Array.isArray(value) || value.some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
    throw new Error('Réponse de surveillance invalide.');
  }
  return value as ArrRecord[];
}

async function updateWatch(scope: WatchScope, enabled: boolean): Promise<boolean> {
  const ownerUid = scope.ownerUid;
  const base = cleanUrl(scope.url);
  const tmdbId = Number(scope.tmdbId);
  if (!ownerUid || ownerUid !== auth.currentUser?.uid || !base || !scope.apiKey || !Number.isInteger(tmdbId) || tmdbId <= 0) {
    throw new Error('Identité de surveillance incomplète.');
  }
  if ((scope.season !== undefined && (!Number.isInteger(scope.season) || scope.season < 0))
    || (scope.episode !== undefined && (scope.season === undefined || !Number.isInteger(scope.episode) || scope.episode <= 0))) {
    throw new Error('Scope de surveillance invalide.');
  }
  const headers = { 'X-Api-Key': scope.apiKey, 'Content-Type': 'application/json' };
  const read = (path: string): Promise<unknown> => executeGet(`${base}/api/v3/${path}`, headers);
  const write = async (path: string, body: ArrRecord) => {
    if (auth.currentUser?.uid !== ownerUid) throw new Error('Le compte a changé.');
    await executePut(`${base}/api/v3/${path}`, body, headers);
  };
  let missing = false;
  if (scope.service === 'radarr') {
    const movies = records(await read('movie')).filter(item => Number(item.tmdbId) === tmdbId);
    if (!enabled && movies.length === 0) return false;
    if (movies.length !== 1 || !positiveId(movies[0].id)) throw new Error('Film exact non vérifié.');
    const movie = movies[0];
    if (movie.monitored !== enabled) await write(`movie/${movie.id}`, { ...movie, monitored: enabled });
    const verified = records(await read('movie')).find(item => Number(item.id) === Number(movie.id) && Number(item.tmdbId) === tmdbId);
    if (verified?.monitored !== enabled) throw new Error('Surveillance Radarr non confirmée.');
    missing = verified.hasFile === false;
  } else {
    const details = await tmdb.getShowDetails(tmdbId);
    const bridge = details.ok ? resolveCanonicalSeriesBridge(tmdbId, details.value) : null;
    if (!bridge) throw new Error('Pont TMDB → TVDB non vérifié.');
    const series = records(await read('series')).filter(item => Number(item.tvdbId) === bridge.tvdbId);
    if (!enabled && series.length === 0) return false;
    if (series.length !== 1 || !positiveId(series[0].id)) throw new Error('Série exacte non vérifiée.');
    const target = series[0];
    const seriesId = Number(target.id);
    const allSeasons = records(target.seasons);
    const scopedSeasons = allSeasons.filter(item => scope.season === undefined ? Number(item.seasonNumber) > 0 : Number(item.seasonNumber) === scope.season);
    if (!scopedSeasons.length) throw new Error('Saison exacte non vérifiée.');
    const seasons = allSeasons.map(item => scopedSeasons.includes(item) && scope.episode === undefined
      ? { ...item, monitored: enabled } : item);
    await write(`series/${seriesId}`, { ...target, seasons,
      monitored: enabled ? true : scope.season === undefined ? false : target.monitored });
    const inScope = (item: ArrRecord) => Number(item.seriesId) === seriesId
      && (scope.season === undefined ? Number(item.seasonNumber) > 0 : Number(item.seasonNumber) === scope.season)
      && (scope.episode === undefined || Number(item.episodeNumber) === scope.episode);
    const episodes = records(await read(`episode?seriesId=${seriesId}`)).filter(inScope);
    if (scope.episode !== undefined && episodes.length !== 1) throw new Error('Épisode exact non vérifié.');
    for (const episode of episodes) {
      if (!positiveId(episode.id)) throw new Error('Identité épisode invalide.');
      if (episode.monitored !== enabled) await write(`episode/${episode.id}`, { ...episode, monitored: enabled });
    }
    const verified = records(await read(`episode?seriesId=${seriesId}`)).filter(inScope);
    const verifiedSeries = records(await read('series')).find(item => Number(item.id) === seriesId && Number(item.tvdbId) === bridge.tvdbId);
    if (verified.length !== episodes.length || verified.some(item => item.monitored !== enabled)
      || (enabled && verifiedSeries?.monitored !== true)
      || (!enabled && scope.season === undefined && verifiedSeries?.monitored !== false)) throw new Error('Surveillance Sonarr non confirmée.');
    if (scope.episode === undefined) {
      const confirmedSeasons = records(verifiedSeries?.seasons).filter(item => scopedSeasons.some(season => Number(season.seasonNumber) === Number(item.seasonNumber)));
      if (confirmedSeasons.length !== scopedSeasons.length || confirmedSeasons.some(item => item.monitored !== enabled)) {
        throw new Error('Surveillance de saison non confirmée.');
      }
    }
    missing = verified.some(item => item.hasFile === false);
  }
  if (auth.currentUser?.uid !== ownerUid) throw new Error('Le compte a changé.');
  if (!enabled) return false;
  const [indexers, config] = await Promise.all([read('indexer'), read('config/indexer')]);
  if (auth.currentUser?.uid !== ownerUid) throw new Error('Le compte a changé.');
  const interval = config && typeof config === 'object' ? Number((config as ArrRecord).rssSyncInterval) : 0;
  return missing && records(indexers).some(item => item.enableRss === true) && Number.isInteger(interval) && interval > 0;
}

export async function enableArrAvailabilityWatch(scope: WatchScope): Promise<DownloadAvailability> {
  try { return { reason: 'no_release', automatic: await updateWatch(scope, true) }; }
  catch { return { reason: 'no_release', automatic: false }; }
}

export async function cancelArrAvailabilityWatch(scope: WatchScope): Promise<void> {
  await updateWatch(scope, false);
}
