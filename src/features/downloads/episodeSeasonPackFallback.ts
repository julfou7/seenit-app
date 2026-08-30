import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { authenticatedFetch } from '../../lib/apiAuth';
import {
  cleanUrl,
  executeDelete,
  executeGet,
  isLocalNetworkUrl,
  loginQBittorrent,
  searchAndDownloadInSonarr
} from '../../services/sonarrRadarr';
import { normalizeDownloadClientId } from './downloadIdentity';
import {
  extractReleaseTorrentHash,
  hasCompatibleIndividualEpisodeRelease,
  rankSeasonPackReleases,
  selectEpisodeFiles,
  type TorrentFileLike
} from './episodePackSelection';

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
  qbittorrentUrl?: string;
  qbittorrentUsername?: string;
  qbittorrentPassword?: string;
}

export interface EpisodeDownloadWithFallbackResult {
  success: boolean;
  message: string;
  status?: 'searching' | 'queued';
  fallbackUsed?: boolean;
  downloadId?: string;
  selectedFile?: string;
}

interface SonarrTarget {
  series: any;
  episode: any;
}

interface TransferCandidate {
  downloadId: string;
  queueIds: number[];
  title?: string;
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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
  let json: any = {};
  try { json = JSON.parse(raw); } catch {}
  if (json.ok && !json.error) return json.data;
  throw new Error(json.message || json.error || `Erreur proxy ${json.status || response.status}`);
}

function findExactSeries(seriesList: any[], params: EpisodeDownloadWithFallbackParams): any | null {
  if (!Array.isArray(seriesList)) return null;
  return seriesList.find(series => {
    if (params.tvdbId && series?.tvdbId && Number(series.tvdbId) === Number(params.tvdbId)) return true;
    if (params.imdbId && series?.imdbId && String(series.imdbId).toLowerCase() === String(params.imdbId).toLowerCase()) return true;
    if (params.tmdbId && series?.tmdbId && Number(series.tmdbId) === Number(params.tmdbId)) return true;
    return false;
  }) || null;
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
      if (episode?.id) return { series, episode };
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
  release: any
): Promise<{ downloadId: string; queueIds: number[] } | null> {
  const releaseHash = extractReleaseTorrentHash(release);
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const [queue, torrents] = await Promise.all([
      fetchSonarrQueue(base, sonarrHeaders).catch(() => []),
      fetchQbitTorrents(params, qHeaders).catch(() => [])
    ]);
    const qbitHashes = new Set(
      torrents
        .map(torrent => normalizeDownloadClientId(torrent?.hash))
        .filter(Boolean) as string[]
    );
    const newQbitHashes = Array.from(qbitHashes).filter(hash => !beforeQbitHashes.has(hash));
    const candidates = collectSeasonTransfers(queue, seriesId, params.season, beforeQueueIds);

    if (releaseHash && qbitHashes.has(releaseHash)) {
      const exactQueue = candidates.find(candidate => candidate.downloadId === releaseHash);
      return { downloadId: releaseHash, queueIds: exactQueue?.queueIds || [] };
    }

    const intersected = candidates.filter(candidate => qbitHashes.has(candidate.downloadId));
    if (intersected.length === 1) {
      return { downloadId: intersected[0].downloadId, queueIds: intersected[0].queueIds };
    }

    if (candidates.length === 1 && newQbitHashes.length === 1 && candidates[0].downloadId === newQbitHashes[0]) {
      return { downloadId: candidates[0].downloadId, queueIds: candidates[0].queueIds };
    }

    await delay(650);
  }
  return null;
}

async function selectOnlyEpisodeInQbit(
  params: EpisodeDownloadWithFallbackParams,
  qHeaders: Record<string, string>,
  downloadId: string
): Promise<{ success: boolean; selectedFile?: string; error?: string }> {
  const base = cleanUrl(params.qbittorrentUrl || '');
  const body = `hashes=${encodeURIComponent(downloadId)}`;
  const paused = await tryQbitAction(params, qHeaders, ['stop', 'pause'], body);

  let files: TorrentFileLike[] = [];
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await executeGet(
      `${base}/api/v2/torrents/files?hash=${encodeURIComponent(downloadId)}`,
      qHeaders
    ).catch(() => []);
    if (Array.isArray(response) && response.length > 0) {
      files = response.map(file => ({
        index: Number(file.index),
        name: String(file.name || ''),
        size: Number(file.size || 0),
        priority: Number(file.priority || 0)
      }));
      break;
    }
    await delay(500);
  }

  const selection = selectEpisodeFiles(files, Number(params.season), Number(params.episode));
  if (selection.targetIndexes.length !== 1 || selection.ambiguous) {
    return {
      success: false,
      error: selection.ambiguous
        ? 'Plusieurs fichiers du pack correspondent à l’épisode demandé.'
        : 'Le fichier exact de l’épisode est introuvable dans le pack.'
    };
  }

  const targetIndex = selection.targetIndexes[0];
  const unwanted = files.map(file => file.index).filter(index => index !== targetIndex);
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
    `hash=${encodeURIComponent(downloadId)}&id=${targetIndex}&priority=1`
  );

  if (paused) {
    const resumed = await tryQbitAction(params, qHeaders, ['start', 'resume'], body);
    if (!resumed) {
      return { success: false, selectedFile: selection.targetNames[0], error: 'Épisode sélectionné mais reprise qBittorrent impossible.' };
    }
  }

  return { success: true, selectedFile: selection.targetNames[0] };
}

export async function downloadEpisodeWithSeasonPackFallback(
  params: EpisodeDownloadWithFallbackParams
): Promise<EpisodeDownloadWithFallbackResult> {
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

  let normalResult: { success: boolean; message: string } | null = null;
  if (!target) {
    normalResult = await searchAndDownloadInSonarr({
      url: params.url,
      apiKey: params.apiKey,
      title: params.title,
      tmdbId: params.tmdbId,
      tvdbId: params.tvdbId,
      imdbId: params.imdbId,
      season: params.season,
      episode: params.episode,
      qualityProfileId: params.qualityProfileId,
      qualityPreference: params.qualityPreference
    });
    if (!normalResult.success) return normalResult;
    try {
      target = await resolveExactTarget(base, sonarrHeaders, params, 5);
    } catch {}
    if (!target) return normalResult;
  }

  let episodeReleases: any[];
  try {
    const response = await interactiveGet(`${base}/api/v3/release?episodeId=${target.episode.id}`, sonarrHeaders);
    episodeReleases = Array.isArray(response) ? response : [];
  } catch (error: any) {
    return {
      success: false,
      message: `Sonarr n’a pas pu vérifier les releases de l’épisode : ${error?.message || 'recherche interactive impossible'}.`
    };
  }

  if (hasCompatibleIndividualEpisodeRelease(episodeReleases, params.qualityPreference)) {
    if (!normalResult) {
      normalResult = await searchAndDownloadInSonarr({
        url: params.url,
        apiKey: params.apiKey,
        title: params.title,
        tmdbId: params.tmdbId,
        tvdbId: params.tvdbId,
        imdbId: params.imdbId,
        season: params.season,
        episode: params.episode,
        qualityProfileId: params.qualityProfileId,
        qualityPreference: params.qualityPreference
      });
    }
    return { ...normalResult, status: normalResult.success ? 'searching' : undefined };
  }

  let seasonReleases: any[];
  try {
    const response = await interactiveGet(
      `${base}/api/v3/release?seriesId=${target.series.id}&seasonNumber=${params.season}`,
      sonarrHeaders
    );
    seasonReleases = rankSeasonPackReleases(Array.isArray(response) ? response : [], params.qualityPreference);
  } catch (error: any) {
    return {
      success: false,
      message: `Aucune release d’épisode isolée et la recherche du pack Saison ${params.season} a échoué : ${error?.message || 'erreur Sonarr'}.`
    };
  }

  if (!seasonReleases.length) {
    return {
      success: false,
      message: `Aucune release S${String(params.season).padStart(2, '0')}E${String(params.episode).padStart(2, '0')} isolée ni pack Saison ${params.season} compatible n’a été trouvé.`
    };
  }

  let qHeaders: Record<string, string>;
  let beforeQbit: any[];
  try {
    qHeaders = await qbitHeaders(params);
    beforeQbit = await fetchQbitTorrents(params, qHeaders);
  } catch (error: any) {
    return {
      success: false,
      message: `Un pack Saison ${params.season} est disponible, mais SeenIt ne peut pas piloter qBittorrent : ${error?.message || 'connexion impossible'}. Aucun pack n’a été lancé.`
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
    grabbedRelease
  );

  if (!transfer) {
    const queue = await fetchSonarrQueue(base, sonarrHeaders).catch(() => []);
    const newTransfers = collectSeasonTransfers(queue, Number(target.series.id), Number(params.season), beforeQueueIds);
    await removeSonarrTransfer(base, sonarrHeaders, newTransfers.flatMap(item => item.queueIds));
    return {
      success: false,
      message: 'Le pack a été lancé mais SeenIt n’a pas pu corréler son torrent qBittorrent de façon certaine. Il a été annulé par sécurité.'
    };
  }

  const selection = await selectOnlyEpisodeInQbit(params, qHeaders, transfer.downloadId);
  if (!selection.success) {
    await removeSonarrTransfer(base, sonarrHeaders, transfer.queueIds);
    return {
      success: false,
      message: `${selection.error || 'Impossible de sélectionner l’épisode dans le pack'} Le pack a été annulé par sécurité.`
    };
  }

  const code = `S${String(params.season).padStart(2, '0')}E${String(params.episode).padStart(2, '0')}`;
  return {
    success: true,
    fallbackUsed: true,
    status: 'queued',
    downloadId: transfer.downloadId,
    selectedFile: selection.selectedFile,
    message: `Aucune release ${code} isolée • pack Saison ${params.season} utilisé, seul ${code} sera téléchargé.`
  };
}
