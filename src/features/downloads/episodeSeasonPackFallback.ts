import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { authenticatedFetch } from '../../lib/apiAuth';
import { auth } from '../../lib/firebase';
import {
  cleanUrl,
  executeDelete,
  executeGet,
  isLocalNetworkUrl,
  loginQBittorrent,
  searchAndDownloadInSonarr
} from '../../services/sonarrRadarr';
import { executePut, executeArrInteractivePost } from '../../services/sonarrRadarrTransport';
import { tmdb } from '../shows/tmdb';
import { normalizeDownloadClientId } from './downloadIdentity';
import {
  findExactSonarrSeries,
  resolveCanonicalSeriesBridge
} from './sonarrCanonicalIdentity';
import {
  chooseExactCleanupTorrentId,
  extractReleaseTorrentHash,
  findExactNewTorrentIds,
  hasCompatibleIndividualEpisodeRelease,
  rankSeasonPackReleases,
  selectEpisodeFiles,
  type TorrentFileLike
} from './episodePackSelection';
import { registerTrackedSeasonPack } from './episodeSeasonPackCleanup';
import { confirmNoArrRelease, isCompatibleArrRelease, requireArrReleaseArray, type DownloadFailureCode } from './downloadNoRelease';
import { enableArrAvailabilityWatch } from '../../services/arrAvailabilityWatch';
import type { DownloadAvailability } from './downloadAvailability';

export interface EpisodeDownloadWithFallbackParams {
  url: string;
  apiKey: string;
  title: string;
  tmdbId?: number | string;
  tvdbId?: number | string;
  imdbId?: string;
  season: number;
  episode: number;
  qualityProfileId?: number;
  qualityPreference?: '1080p' | '4k';
  replaceExisting?: boolean;
  qbittorrentUrl?: string;
  qbittorrentUsername?: string;
  qbittorrentPassword?: string;
  /**
   * #879 — Autres épisodes de la même saison demandés dans le même lot. Si le pack de saison est utilisé,
   * leurs fichiers sont sélectionnés ensemble dans ce transfert exactement identifié (jamais un torrent
   * préexistant), au lieu d'un repli indépendant par épisode qui ne garderait que le premier.
   */
  packEpisodes?: number[];
}

export interface EpisodeDownloadWithFallbackResult {
  success: boolean;
  message: string;
  failureCode?: DownloadFailureCode;
  availability?: DownloadAvailability;
  status?: 'searching' | 'queued';
  fallbackUsed?: boolean;
  downloadId?: string;
  selectedFile?: string;
  seriesId?: number;
  episodeId?: number;
  season?: number;
  episode?: number;
  /** Épisodes du lot sélectionnés en plus dans le même pack. */
  packEpisodes?: number[];
}

interface SonarrEpisodeLike { id: number; seasonNumber?: number; episodeNumber?: number; hasFile?: boolean }

interface SonarrTarget {
  series: any;
  episode: SonarrEpisodeLike;
  episodes: SonarrEpisodeLike[];
}

interface TransferCandidate {
  downloadId: string;
  queueIds: number[];
  title?: string;
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function enrichExactExternalIds(
  params: EpisodeDownloadWithFallbackParams
): Promise<EpisodeDownloadWithFallbackParams | null> {
  const tmdbId = Number(params.tmdbId);
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) return null;
  try {
    const details = await tmdb.getShowDetails(tmdbId);
    const canonical = details.ok
      ? resolveCanonicalSeriesBridge(tmdbId, details.value)
      : null;
    if (!canonical) return null;
    return {
      ...params,
      tmdbId: canonical.tmdbId,
      tvdbId: canonical.tvdbId,
      imdbId: canonical.imdbId
    };
  } catch {
    return null;
  }
}

async function interactiveGet(url: string, headers: Record<string, string>): Promise<any> {
  if (!Capacitor.isNativePlatform()) return executeGet(url, headers);
  const nativeHeaders = { ...headers };
  if (headers['X-Api-Key']) nativeHeaders['x-api-key'] = headers['X-Api-Key'];
  const response = await CapacitorHttp.get({
    url,
    headers: nativeHeaders,
    connectTimeout: 10000,
    readTimeout: 30000
  });
  if (response.status < 200 || response.status >= 300) throw new Error(`Erreur HTTP ${response.status}`);
  if (typeof response.data !== 'string') return response.data;
  try { return JSON.parse(response.data); } catch { return response.data; }
}

async function postService(
  url: string,
  body: any,
  headers: Record<string, string>,
  timeoutMs = 15000
): Promise<any> {
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.post({
      url,
      headers,
      data: body,
      connectTimeout: 10000,
      readTimeout: timeoutMs
    });
    if (response.status >= 200 && response.status < 300) return response.data || { success: true };
    throw new Error(`Erreur HTTP ${response.status}`);
  }

  if (isLocalNetworkUrl(url)) {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) throw new Error(`Erreur HTTP ${response.status}`);
    const text = await response.text();
    try { return JSON.parse(text); } catch { return text || { success: true }; }
  }

  const response = await authenticatedFetch('/api/service-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetUrl: url, method: 'POST', headers, body }),
    signal: AbortSignal.timeout(timeoutMs + 3000)
  });
  const raw = await response.text();
  let json: { ok?: boolean; error?: string; message?: string; status?: number; data?: unknown } = {};
  try { json = JSON.parse(raw); } catch {}
  if (json.ok && !json.error) return json.data;
  throw new Error(json.message || json.error || `Erreur proxy ${json.status || response.status}`);
}

function findExactSeries(seriesList: any[], params: EpisodeDownloadWithFallbackParams): any | null {
  const tmdbId = Number(params.tmdbId);
  const tvdbId = Number(params.tvdbId);
  if (!Number.isInteger(tmdbId) || tmdbId <= 0 || !Number.isInteger(tvdbId) || tvdbId <= 0) return null;
  return findExactSonarrSeries(seriesList, {
    tmdbId,
    tvdbId,
    imdbId: params.imdbId
  });
}

async function resolveExactTarget(
  base: string,
  headers: Record<string, string>,
  params: EpisodeDownloadWithFallbackParams,
  attempts = 1
): Promise<SonarrTarget | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const seriesList = await executeGet(`${base}/api/v3/series`, headers);
    const series = findExactSeries(Array.isArray(seriesList) ? seriesList : [], params);
    if (series?.id) {
      const episodes = await executeGet(`${base}/api/v3/episode?seriesId=${series.id}`, headers);
      const episode = Array.isArray(episodes)
        ? episodes.find(item =>
            Number(item?.seasonNumber) === Number(params.season)
            && Number(item?.episodeNumber) === Number(params.episode)
          )
        : null;
      if (episode?.id) return { series, episode, episodes: episodes as SonarrEpisodeLike[] };
    }
    if (attempt < attempts - 1) await delay(500 * (attempt + 1));
  }
  return null;
}

async function fetchSonarrQueue(base: string, headers: Record<string, string>): Promise<any[]> {
  const response = await executeGet(
    `${base}/api/v3/queue?pageSize=100&includeSeries=true&includeEpisode=true`,
    headers
  );
  return Array.isArray(response) ? response : (Array.isArray(response?.records) ? response.records : []);
}

async function fetchSonarrHistory(base: string, headers: Record<string, string>): Promise<any[]> {
  const response = await executeGet(
    `${base}/api/v3/history?page=1&pageSize=100&sortKey=date&sortDirection=descending&includeSeries=true&includeEpisode=true`,
    headers
  );
  return Array.isArray(response) ? response : (Array.isArray(response?.records) ? response.records : []);
}

function collectSeasonHistoryDownloadIds(
  records: any[],
  seriesId: number,
  season: number,
  excludedHistoryIds: Set<string>
): string[] {
  const ids = new Set<string>();
  for (const record of Array.isArray(records) ? records : []) {
    const historyId = String(record?.id ?? record?.historyId ?? '').trim();
    if (!historyId || excludedHistoryIds.has(historyId)) continue;
    const eventType = String(record?.eventType || '').toLowerCase();
    if (eventType && eventType !== 'grabbed') continue;
    const recordSeriesId = Number(record?.series?.id ?? record?.seriesId);
    const recordSeason = Number(record?.episode?.seasonNumber ?? record?.seasonNumber);
    if (recordSeriesId !== Number(seriesId) || recordSeason !== Number(season)) continue;
    const downloadId = normalizeDownloadClientId(record?.downloadId ?? record?.data?.downloadId);
    if (downloadId) ids.add(downloadId);
  }
  return Array.from(ids);
}

function collectSeasonTransfers(
  records: any[],
  seriesId: number,
  season: number,
  excludedDownloadIds: Set<string>
): TransferCandidate[] {
  const groups = new Map<string, TransferCandidate>();
  for (const record of records) {
    const recordSeriesId = Number(record?.series?.id ?? record?.seriesId);
    const recordSeason = Number(record?.seasonNumber ?? record?.episode?.seasonNumber);
    if (recordSeriesId !== Number(seriesId) || recordSeason !== Number(season)) continue;
    const downloadId = normalizeDownloadClientId(record?.downloadId);
    if (!downloadId || excludedDownloadIds.has(downloadId)) continue;
    const existing = groups.get(downloadId) || { downloadId, queueIds: [], title: record?.title };
    if (Number.isFinite(Number(record?.id))) existing.queueIds.push(Number(record.id));
    groups.set(downloadId, existing);
  }
  return Array.from(groups.values());
}

async function qbitHeaders(params: EpisodeDownloadWithFallbackParams): Promise<Record<string, string>> {
  const base = cleanUrl(params.qbittorrentUrl || '');
  if (!base) throw new Error('qBittorrent n’est pas configuré dans SeenIt.');
  let cookie = '';
  if (params.qbittorrentUsername || params.qbittorrentPassword) {
    const login = await loginQBittorrent(base, params.qbittorrentUsername, params.qbittorrentPassword);
    if (!login.success) throw new Error(login.message || 'Authentification qBittorrent impossible');
    cookie = login.cookie || '';
  }
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Referer: base,
    Origin: base
  };
  if (cookie) headers.Cookie = cookie;
  return headers;
}

async function fetchQbitTorrents(params: EpisodeDownloadWithFallbackParams, headers: Record<string, string>): Promise<any[]> {
  const base = cleanUrl(params.qbittorrentUrl || '');
  const response = await executeGet(`${base}/api/v2/torrents/info?filter=all`, headers);
  return Array.isArray(response) ? response : [];
}

async function qbitAction(
  params: EpisodeDownloadWithFallbackParams,
  headers: Record<string, string>,
  endpoint: string,
  body: string
): Promise<void> {
  const base = cleanUrl(params.qbittorrentUrl || '');
  await postService(
    `${base}/api/v2/torrents/${endpoint}`,
    body,
    { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
    10000
  );
}

async function tryQbitAction(
  params: EpisodeDownloadWithFallbackParams,
  headers: Record<string, string>,
  endpoints: string[],
  body: string
): Promise<boolean> {
  for (const endpoint of endpoints) {
    try {
      await qbitAction(params, headers, endpoint, body);
      return true;
    } catch {}
  }
  return false;
}

async function removeExactQbitTorrent(
  params: EpisodeDownloadWithFallbackParams,
  headers: Record<string, string>,
  downloadId: string
): Promise<void> {
  try {
    await qbitAction(
      params,
      headers,
      'delete',
      `hashes=${encodeURIComponent(downloadId)}&deleteFiles=false`
    );
  } catch {}
}

async function removeSonarrTransfer(
  base: string,
  headers: Record<string, string>,
  queueIds: number[]
): Promise<void> {
  for (const queueId of Array.from(new Set(queueIds))) {
    try {
      await executeDelete(
        `${base}/api/v3/queue/${queueId}?removeFromClient=true&blocklist=false`,
        headers
      );
    } catch {}
  }
}

async function grabSeasonPack(
  base: string,
  headers: Record<string, string>,
  releases: any[],
  seriesId: number
): Promise<any | null> {
  for (const release of releases.slice(0, 8)) {
    try {
      await postService(
        `${base}/api/v3/release`,
        { ...release, seriesId },
        { ...headers, 'Content-Type': 'application/json' },
        30000
      );
      return release;
    } catch {}
  }
  return null;
}

async function waitForPackTransfer(
  base: string,
  sonarrHeaders: Record<string, string>,
  qHeaders: Record<string, string>,
  params: EpisodeDownloadWithFallbackParams,
  seriesId: number,
  beforeQueueIds: Set<string>,
  beforeQbitHashes: Set<string>,
  beforeHistoryIds: Set<string>,
  release: any
): Promise<{ downloadId: string; queueIds: number[] } | null> {
  const releaseHash = extractReleaseTorrentHash(release);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const [queue, history, torrents] = await Promise.all([
      fetchSonarrQueue(base, sonarrHeaders).catch(() => []),
      fetchSonarrHistory(base, sonarrHeaders).catch(() => []),
      fetchQbitTorrents(params, qHeaders).catch(() => [])
    ]);
    const qbitHashes = new Set(
      torrents
        .map(torrent => normalizeDownloadClientId(torrent?.hash))
        .filter(Boolean) as string[]
    );
    const candidates = collectSeasonTransfers(queue, seriesId, params.season, beforeQueueIds);
    const historyDownloadIds = collectSeasonHistoryDownloadIds(
      history,
      seriesId,
      params.season,
      beforeHistoryIds
    );
    const exactNewTorrentIds = findExactNewTorrentIds(
      [...candidates.map(candidate => candidate.downloadId), ...historyDownloadIds],
      Array.from(qbitHashes),
      Array.from(beforeQbitHashes),
      releaseHash
    );

    if (exactNewTorrentIds.length === 1) {
      const downloadId = exactNewTorrentIds[0];
      const exactQueue = candidates.find(candidate => candidate.downloadId === downloadId);
      return { downloadId, queueIds: exactQueue?.queueIds || [] };
    }

    await delay(650);
  }
  return null;
}

async function fetchQbitFiles(
  params: EpisodeDownloadWithFallbackParams,
  headers: Record<string, string>,
  downloadId: string
): Promise<TorrentFileLike[]> {
  const base = cleanUrl(params.qbittorrentUrl || '');
  const response = await executeGet(
    `${base}/api/v2/torrents/files?hash=${encodeURIComponent(downloadId)}`,
    headers
  ).catch(() => []);
  if (!Array.isArray(response)) return [];
  return response.map(file => ({
    index: Number(file.index),
    name: String(file.name || ''),
    size: Number(file.size || 0),
    priority: Number(file.priority || 0)
  }));
}

async function selectEpisodesInQbit(
  params: EpisodeDownloadWithFallbackParams,
  qHeaders: Record<string, string>,
  downloadId: string,
  extraEpisodes: readonly number[] = []
): Promise<{ success: boolean; selectedFile?: string; packEpisodes: number[]; error?: string }> {
  const pauseBody = `hashes=${encodeURIComponent(downloadId)}`;
  const paused = await tryQbitAction(params, qHeaders, ['stop', 'pause'], pauseBody);
  if (!paused) {
    return { success: false, packEpisodes: [], error: 'SeenIt n’a pas pu mettre le pack en pause avant la sélection des fichiers.' };
  }

  let files: TorrentFileLike[] = [];
  for (let attempt = 0; attempt < 24; attempt += 1) {
    files = await fetchQbitFiles(params, qHeaders, downloadId);
    if (files.length > 0) break;
    await delay(500);
  }

  const selection = selectEpisodeFiles(files, Number(params.season), Number(params.episode));
  if (selection.targetIndexes.length !== 1 || selection.ambiguous || selection.extraEpisodeNumbers.length > 0) {
    return {
      success: false,
      packEpisodes: [],
      error: selection.ambiguous
        ? 'Plusieurs fichiers du pack correspondent à l’épisode demandé.'
        : selection.extraEpisodeNumbers.length > 0
          ? 'Le seul fichier trouvé contient plusieurs épisodes et ne peut pas être découpé sans télécharger les épisodes voisins.'
          : 'Le fichier exact de l’épisode est introuvable dans le pack.'
    };
  }

  // Épisodes du même lot : chacun doit désigner son propre fichier, unique et distinct ; sinon il reste
  // hors du pack et suit son propre parcours. Les règles de sélection sont celles de l'épisode principal.
  const kept = new Set<number>([selection.targetIndexes[0]]);
  const packEpisodes: number[] = [];
  for (const extra of extraEpisodes) {
    const extraSelection = selectEpisodeFiles(files, Number(params.season), extra);
    if (extraSelection.targetIndexes.length !== 1 || extraSelection.ambiguous || extraSelection.extraEpisodeNumbers.length > 0) continue;
    if (kept.has(extraSelection.targetIndexes[0])) continue;
    kept.add(extraSelection.targetIndexes[0]);
    packEpisodes.push(extra);
  }

  const targetIndexes = Array.from(kept);
  const unwanted = files.map(file => file.index).filter(index => !kept.has(index));
  if (unwanted.length > 0) {
    await qbitAction(
      params,
      qHeaders,
      'filePrio',
      `hash=${encodeURIComponent(downloadId)}&id=${encodeURIComponent(unwanted.join('|'))}&priority=0`
    );
  }
  await qbitAction(
    params,
    qHeaders,
    'filePrio',
    `hash=${encodeURIComponent(downloadId)}&id=${encodeURIComponent(targetIndexes.join('|'))}&priority=1`
  );

  const verifiedFiles = await fetchQbitFiles(params, qHeaders, downloadId);
  const targetsVerified = targetIndexes.every(index => verifiedFiles.some(file => file.index === index && Number(file.priority || 0) > 0));
  const unwantedStillEnabled = verifiedFiles.some(file => !kept.has(file.index) && Number(file.priority || 0) > 0);
  if (!targetsVerified || unwantedStillEnabled) {
    return { success: false, packEpisodes: [], selectedFile: selection.targetNames[0], error: 'qBittorrent n’a pas confirmé la sélection exclusive des épisodes demandés.' };
  }

  const resumed = await tryQbitAction(params, qHeaders, ['start', 'resume'], pauseBody);
  if (!resumed) {
    return { success: false, packEpisodes: [], selectedFile: selection.targetNames[0], error: 'Épisode sélectionné mais reprise qBittorrent impossible.' };
  }

  return { success: true, packEpisodes, selectedFile: selection.targetNames[0] };
}

export async function downloadEpisodeWithSeasonPackFallback(
  initialParams: EpisodeDownloadWithFallbackParams
): Promise<EpisodeDownloadWithFallbackResult> {
  const ownerUid = auth.currentUser?.uid;
  const params = await enrichExactExternalIds(initialParams);
  if (!params) {
    return {
      success: false,
      message: 'Impossible de vérifier le pont TMDB → TVDB de cette série ; aucun téléchargement n’a été lancé.'
    };
  }
  const base = cleanUrl(params.url);
  const sonarrHeaders = {
    'X-Api-Key': params.apiKey,
    Accept: 'application/json',
    'Content-Type': 'application/json'
  };

  if (!base || !params.apiKey) {
    return { success: false, message: 'Configuration Sonarr incomplète.' };
  }

  let target: SonarrTarget | null = null;
  try {
    target = await resolveExactTarget(base, sonarrHeaders, params, 1);
  } catch {}

  if (!target) {
    const ensured = await searchAndDownloadInSonarr({
      url: params.url,
      apiKey: params.apiKey,
      title: params.title,
      tmdbId: params.tmdbId,
      tvdbId: params.tvdbId,
      imdbId: params.imdbId,
      season: params.season,
      episode: params.episode,
      qualityProfileId: params.qualityProfileId,
      qualityPreference: params.qualityPreference,
      ensureOnly: true
    });
    if (!ensured.success) return ensured;
    try {
      target = await resolveExactTarget(base, sonarrHeaders, params, 4);
    } catch (error: unknown) {
      return { success: false, message: error instanceof Error ? error.message : 'Sonarr indisponible.' };
    }
    if (!target) return { success: false, message: 'Sonarr n’a pas confirmé l’épisode exact.' };
  }

  if (target.episode.hasFile && params.replaceExisting !== true) return { success: false, message: 'Cet épisode est déjà disponible. Choisis explicitement son remplacement.' };
  if (params.qualityProfileId && target.series.qualityProfileId !== params.qualityProfileId) {
    try { await executePut(`${base}/api/v3/series`, { ...target.series, qualityProfileId: params.qualityProfileId }, sonarrHeaders); }
    catch { return { success: false, message: 'Impossible de confirmer le profil de qualité Sonarr.' }; }
  }
  let episodeReleases: any[];
  try {
    const response = await interactiveGet(`${base}/api/v3/release?episodeId=${target.episode.id}`, sonarrHeaders);
    episodeReleases = requireArrReleaseArray(response);
  } catch (error: unknown) {
    return {
      success: false,
      message: `Sonarr n’a pas pu vérifier les releases de l’épisode : ${error instanceof Error ? error.message : 'recherche interactive impossible'}.`
    };
  }

  if (hasCompatibleIndividualEpisodeRelease(episodeReleases, params.qualityPreference)) {
    const selected = episodeReleases.find(release => isCompatibleArrRelease(release, params.qualityPreference));
    if (!selected) return { success: false, message: 'Aucune release individuelle approuvée.' };
    try {
      await executeArrInteractivePost(`${base}/api/v3/release`, { ...selected, episodeId: target.episode.id }, sonarrHeaders);
      return { success: true, status: 'queued', message: 'Release de l’épisode envoyée au client.' };
    } catch (error: unknown) {
      return { success: false, message: `Résultat du lancement inconnu : ${error instanceof Error ? error.message : 'service indisponible'}. Vérifie le client avant de réessayer.` };
    }
  }

  let seasonReleases: any[];
  try {
    const response = await interactiveGet(
      `${base}/api/v3/release?seriesId=${target.series.id}&seasonNumber=${params.season}`,
      sonarrHeaders
    );
    seasonReleases = rankSeasonPackReleases(requireArrReleaseArray(response), params.qualityPreference);
  } catch (error: unknown) {
    return {
      success: false,
      message: `Aucune release d’épisode isolée et la recherche du pack Saison ${params.season} a échoué : ${error instanceof Error ? error.message : 'erreur Sonarr'}.`
    };
  }

  if (!seasonReleases.length) {
    const confirmed = await confirmNoArrRelease(path => executeGet(`${base}/api/v3/${path}`, sonarrHeaders));
    if (!confirmed.failureCode) return confirmed;
    return {
      success: false,
      failureCode: confirmed.failureCode,
      availability: await enableArrAvailabilityWatch({ ...params, service: 'sonarr', ownerUid }),
      message: `Aucune release S${String(params.season).padStart(2, '0')}E${String(params.episode).padStart(2, '0')} isolée ni pack Saison ${params.season} compatible n’a été trouvé.`
    };
  }

  let qHeaders: Record<string, string>;
  let beforeQbit: any[];
  try {
    qHeaders = await qbitHeaders(params);
    beforeQbit = await fetchQbitTorrents(params, qHeaders);
  } catch (error: unknown) {
    return {
      success: false,
      message: `Un pack Saison ${params.season} est disponible, mais SeenIt ne peut pas piloter qBittorrent : ${(error instanceof Error && error.message) || 'connexion impossible'}. Aucun pack n’a été lancé.`
    };
  }

  const beforeQueue = await fetchSonarrQueue(base, sonarrHeaders).catch(() => []);
  const beforeQueueIds = new Set(
    beforeQueue
      .map(record => normalizeDownloadClientId(record?.downloadId))
      .filter(Boolean) as string[]
  );
  const beforeQbitHashes = new Set(
    beforeQbit
      .map(torrent => normalizeDownloadClientId(torrent?.hash))
      .filter(Boolean) as string[]
  );
  const beforeHistory = await fetchSonarrHistory(base, sonarrHeaders).catch(() => []);
  const beforeHistoryIds = new Set(
    beforeHistory
      .map(record => String(record?.id ?? record?.historyId ?? '').trim())
      .filter(Boolean)
  );

  const grabbedRelease = await grabSeasonPack(base, sonarrHeaders, seasonReleases, Number(target.series.id));
  if (!grabbedRelease) {
    return { success: false, message: `Le pack Saison ${params.season} a été trouvé mais Sonarr n’a pas réussi à le lancer.` };
  }

  const transfer = await waitForPackTransfer(
    base,
    sonarrHeaders,
    qHeaders,
    params,
    Number(target.series.id),
    beforeQueueIds,
    beforeQbitHashes,
    beforeHistoryIds,
    grabbedRelease
  );

  if (!transfer) {
    const [queue, history, torrents] = await Promise.all([
      fetchSonarrQueue(base, sonarrHeaders).catch(() => []),
      fetchSonarrHistory(base, sonarrHeaders).catch(() => []),
      fetchQbitTorrents(params, qHeaders).catch(() => [])
    ]);
    const newTransfers = collectSeasonTransfers(queue, Number(target.series.id), Number(params.season), beforeQueueIds);
    const historyDownloadIds = collectSeasonHistoryDownloadIds(
      history,
      Number(target.series.id),
      Number(params.season),
      beforeHistoryIds
    );
    const currentQbitHashes = torrents
      .map(torrent => normalizeDownloadClientId(torrent?.hash))
      .filter(Boolean) as string[];
    const releaseHash = extractReleaseTorrentHash(grabbedRelease);
    const exactNewIds = findExactNewTorrentIds(
      [...newTransfers.map(item => item.downloadId), ...historyDownloadIds],
      currentQbitHashes,
      Array.from(beforeQbitHashes),
      releaseHash
    );

    const corroboratedSonarrIds = Array.from(new Set(
      newTransfers
        .map(item => item.downloadId)
        .filter(id => historyDownloadIds.includes(id))
    ));
    const exactCleanupId = chooseExactCleanupTorrentId(
      exactNewIds,
      corroboratedSonarrIds,
      Array.from(beforeQbitHashes),
      releaseHash
    );

    if (exactCleanupId) {
      const exactQueueIds = newTransfers
        .filter(item => item.downloadId === exactCleanupId)
        .flatMap(item => item.queueIds);
      await removeSonarrTransfer(base, sonarrHeaders, exactQueueIds);
      if (/^[a-f0-9]{40}$|^[a-f0-9]{64}$/i.test(exactCleanupId)) {
        await removeExactQbitTorrent(params, qHeaders, exactCleanupId);
        await delay(700);
        await removeExactQbitTorrent(params, qHeaders, exactCleanupId);
      }
      return {
        success: false,
        message: 'Le pack a été lancé mais sa corrélation n’a pas été confirmée à temps. Le transfert exact identifié a été annulé dans Sonarr et qBittorrent par sécurité.'
      };
    }

    return {
      success: false,
      message: 'Le pack a été lancé mais aucun identifiant technique unique ne permet de le corréler sans risque. SeenIt n’a modifié aucun torrent préexistant ; vérifie qBittorrent avant de relancer.'
    };
  }

  // Épisodes du lot encore sans fichier dans Sonarr : un épisode déjà présent n'est jamais réactivé.
  const seasonEpisodes = target.episodes;
  const extraEpisodes = Array.from(new Set((params.packEpisodes || []).map(Number)))
    .filter(extra => Number.isInteger(extra) && extra !== Number(params.episode))
    .filter(extra => seasonEpisodes.some(item =>
      Number(item?.seasonNumber) === Number(params.season)
      && Number(item?.episodeNumber) === extra
      && item?.hasFile !== true
    ));
  const selection = await selectEpisodesInQbit(params, qHeaders, transfer.downloadId, extraEpisodes);
  if (!selection.success) {
    await removeSonarrTransfer(base, sonarrHeaders, transfer.queueIds);
    await removeExactQbitTorrent(params, qHeaders, transfer.downloadId);
    return {
      success: false,
      message: `${selection.error || 'Impossible de sélectionner l’épisode dans le pack'} Le pack exact a été annulé par sécurité.`
    };
  }

  registerTrackedSeasonPack({
    downloadId: transfer.downloadId,
    seriesId: Number(target.series.id),
    episodeId: Number(target.episode.id),
    seasonNumber: Number(params.season),
    episodeNumber: Number(params.episode),
    title: params.title,
    extraEpisodes: selection.packEpisodes.map(extra => ({
      episodeNumber: extra,
      episodeId: seasonEpisodes.find(item => Number(item?.seasonNumber) === Number(params.season) && Number(item?.episodeNumber) === extra)?.id
    }))
  });

  const episodeCode = (episodeNumber: number) => `S${String(params.season).padStart(2, '0')}E${String(episodeNumber).padStart(2, '0')}`;
  const code = episodeCode(Number(params.episode));
  const selectedCodes = [code, ...selection.packEpisodes.map(episodeCode)];
  return {
    success: true,
    fallbackUsed: true,
    status: 'queued',
    downloadId: transfer.downloadId,
    selectedFile: selection.selectedFile,
    seriesId: Number(target.series.id),
    episodeId: Number(target.episode.id),
    season: params.season,
    episode: params.episode,
    packEpisodes: selection.packEpisodes,
    message: selection.packEpisodes.length
      ? `Aucune release ${code} isolée • pack Saison ${params.season} utilisé, seuls ${selectedCodes.join(', ')} seront téléchargés.`
      : `Aucune release ${code} isolée • pack Saison ${params.season} utilisé, seul ${code} sera téléchargé.`
  };
}
