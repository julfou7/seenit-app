import { auth } from '../lib/firebase';
import { tmdb } from '../features/shows/tmdb';
import { findExactSonarrSeries, resolveCanonicalSeriesBridge } from '../features/downloads/sonarrCanonicalIdentity';
import { getReleaseAudio } from '../features/downloads/releaseAudio';
import { isStrongTorrentHash, normalizeDownloadClientId, normalizeQualityLabel } from '../features/downloads/downloadIdentity';
import { cleanUrl, executeGet, executeArrInteractiveGet, executeArrInteractivePost } from './sonarrRadarrTransport';

export interface ManualReleaseScope {
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  seasonNumber?: number;
  episodeNumber?: number;
}
export interface ManualReleaseCandidate {
  key: string;
  title: string;
  audio: ReturnType<typeof getReleaseAudio>;
  quality?: string;
  size: number;
  seeders: number;
  indexer: string;
  rejections: string[];
  selectable: boolean;
  infoHash?: string;
}
export interface ManualReleaseSearch {
  scope: ManualReleaseScope;
  candidates: ManualReleaseCandidate[];
}
interface Grant {
  uid: string;
  base: string;
  headers: Record<string, string>;
  expiresAt: number;
  payloads: Map<string, Record<string, unknown>>;
  selectableKeys: Set<string>;
  submission?: Promise<void>;
}
const grants = new WeakMap<ManualReleaseSearch, Grant>();
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
function records(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
    throw new Error('Réponse du client invalide. Relancez la recherche.');
  }
  return value.map(record);
}
function assertOwner(uid: string): void {
  if (!uid || auth.currentUser?.uid !== uid) throw new Error('Le compte a changé. Rouvrez la recherche.');
}
function positive(value: unknown): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/** Consultation seule : aucun ajout de média, changement de profil ou commande automatique. */
export async function searchManualArrReleases(scope: ManualReleaseScope, config: {
  sonarrUrl?: string; sonarrApiKey?: string; radarrUrl?: string; radarrApiKey?: string;
  scopeUid?: string | null;
}): Promise<ManualReleaseSearch> {
  const uid = auth.currentUser?.uid || '';
  assertOwner(uid);
  if (config.scopeUid !== undefined && config.scopeUid !== uid) throw new Error('La configuration du compte est en cours de synchronisation.');
  if (!positive(scope.tmdbId)) throw new Error('Le TMDB ID exact est requis.');
  const isMovie = scope.mediaType === 'movie';
  const base = cleanUrl((isMovie ? config.radarrUrl : config.sonarrUrl) || '');
  const apiKey = (isMovie ? config.radarrApiKey : config.sonarrApiKey) || '';
  if (!base || !apiKey) throw new Error(`Configurez ${isMovie ? 'Radarr' : 'Sonarr'} pour chercher une autre release.`);
  const headers = { 'X-Api-Key': apiKey, Accept: 'application/json' };
  let query: string;
  let context: Record<string, number>;
  if (isMovie) {
    const movies = records(await executeGet(`${base}/api/v3/movie`, headers));
    const exact = movies.filter(movie => Number(movie.tmdbId) === scope.tmdbId && positive(movie.id));
    if (exact.length !== 1) throw new Error('Ce film doit être présent et identifié sans ambiguïté dans Radarr.');
    context = { movieId: positive(exact[0].id) };
    query = `movieId=${context.movieId}`;
  } else {
    if (!Number.isInteger(scope.seasonNumber) || Number(scope.seasonNumber) < 0) {
      throw new Error('Choisissez la saison à rechercher.');
    }
    const details = await tmdb.getShowDetails(scope.tmdbId);
    const canonical = details.ok ? resolveCanonicalSeriesBridge(scope.tmdbId, details.value) : null;
    if (!canonical) throw new Error('Le pont TMDB vers cette série Sonarr ne peut pas être vérifié.');
    const matching = records(await executeGet(`${base}/api/v3/series`, headers))
      .filter(series => findExactSonarrSeries([series], canonical));
    const series = matching.length === 1 ? matching[0] : null;
    if (!positive(series?.id)) throw new Error('Cette série exacte doit déjà être présente dans Sonarr.');
    context = { seriesId: positive(series?.id) };
    query = `seriesId=${context.seriesId}&seasonNumber=${scope.seasonNumber}`;
    if (scope.episodeNumber != null) {
      if (!positive(scope.episodeNumber)) throw new Error('Épisode invalide.');
      const episodes = records(await executeGet(`${base}/api/v3/episode?seriesId=${context.seriesId}`, headers));
      const exact = episodes.filter(ep => Number(ep.seriesId) === context.seriesId
        && Number(ep.seasonNumber) === scope.seasonNumber && Number(ep.episodeNumber) === scope.episodeNumber);
      if (exact.length !== 1 || !positive(exact[0].id)) throw new Error('Cet épisode exact est introuvable dans Sonarr.');
      context.episodeId = positive(exact[0].id);
      query = `episodeId=${context.episodeId}`;
    }
  }
  assertOwner(uid);
  const raw = records(await executeArrInteractiveGet(`${base}/api/v3/release?${query}`, headers));
  assertOwner(uid);
  const payloads = new Map<string, Record<string, unknown>>();
  const selectableKeys = new Set<string>();
  const candidates = raw.flatMap(release => {
    const guid = typeof release.guid === 'string' ? release.guid.trim() : '';
    const indexerId = positive(release.indexerId);
    const title = typeof release.title === 'string' ? release.title.trim() : '';
    if (!guid || !indexerId || !title || typeof release.approved !== 'boolean') return [];
    const key = JSON.stringify([indexerId, guid]);
    if (payloads.has(key)) return [];
    const rejections = Array.isArray(release.rejections) ? release.rejections.map(String) : [];
    const mappedId = isMovie ? release.mappedMovieId : release.mappedSeriesId;
    const exactContext = Object.entries(context).every(([field, id]) => !release[field] || Number(release[field]) === id)
      && (!positive(mappedId) || positive(mappedId) === (context.movieId || context.seriesId))
      && (isMovie || release.mappedSeasonNumber == null || Number(release.mappedSeasonNumber) === scope.seasonNumber)
      && (scope.episodeNumber == null || (!release.fullSeason && (!Array.isArray(release.mappedEpisodeNumbers)
        || release.mappedEpisodeNumbers.length === 0
        || (release.mappedEpisodeNumbers.length === 1 && Number(release.mappedEpisodeNumbers[0]) === scope.episodeNumber))));
    const selectable = exactContext && (release.approved === true
      || (rejections.length > 0 && rejections.every(reason => /existing file/i.test(reason))));
    payloads.set(key, { guid, indexerId, ...context });
    if (selectable) selectableKeys.add(key);
    const quality = record(record(release.quality).quality);
    return [{ key, title, audio: getReleaseAudio(title),
      quality: normalizeQualityLabel(title, quality.name), size: Math.max(0, Number(release.size) || 0),
      seeders: Math.max(0, Number(release.seeders) || 0), indexer: String(release.indexer || ''),
      rejections: exactContext ? rejections : ['Identité du résultat incompatible.'], selectable,
      infoHash: isStrongTorrentHash(release.infoHash) ? normalizeDownloadClientId(release.infoHash) || undefined : undefined }];
  }).sort((a, b) => Number(b.audio.vff) - Number(a.audio.vff) || b.seeders - a.seeders);
  const session: ManualReleaseSearch = { scope: { ...scope }, candidates };
  grants.set(session, { uid, base, headers, payloads, selectableKeys, expiresAt: Date.now() + 20 * 60_000 });
  return session;
}

export function assertManualReleaseSearchCurrent(session: ManualReleaseSearch): void {
  const grant = grants.get(session);
  if (!grant) throw new Error('Relancez la recherche.');
  assertOwner(grant.uid);
  if (Date.now() > grant.expiresAt) throw new Error('Résultats expirés. Relancez la recherche.');
}

/** Un seul choix par consultation, y compris après une réponse réseau ambiguë. */
export function grabManualArrRelease(session: ManualReleaseSearch, key: string, requestId: string): Promise<void> {
  const grant = grants.get(session);
  if (!grant) return Promise.reject(new Error('Relancez la recherche.'));
  assertOwner(grant.uid);
  if (grant.submission) return grant.submission;
  if (Date.now() > grant.expiresAt) return Promise.reject(new Error('Résultats expirés. Relancez la recherche.'));
  const candidate = session.candidates.find(item => item.key === key);
  const payload = grant.payloads.get(key);
  if (!candidate || !grant.selectableKeys.has(key) || !payload || !requestId) return Promise.reject(new Error('Cette release ne peut pas être lancée.'));
  grant.submission = executeArrInteractivePost(`${grant.base}/api/v3/release`, payload,
    { ...grant.headers, 'X-SeenIt-Request-Id': requestId }).then(() => { assertOwner(grant.uid); });
  return grant.submission;
}
