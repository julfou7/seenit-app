import { cleanUrl, executeDelete, executeGet } from '../../services/sonarrRadarr';
import { isDownloadFeatureEnabled } from './downloadFeatureVisibility';
import type { useDownloadConfigStore } from '../../store/downloadConfigStore';

type DownloadConfig = ReturnType<typeof useDownloadConfigStore.getState>;
type ArrImage = { coverType?: string; remoteUrl?: string };
type HistoryRecord = {
  eventType?: unknown; date?: string; seriesId?: number; movieId?: number;
  series?: { title?: string; tmdbId?: number; tvdbId?: number; year?: number; images?: ArrImage[]; ratings?: { value?: number } };
  episode?: { seasonNumber?: number; episodeNumber?: number };
  movie?: { title?: string; tmdbId?: number; year?: number; images?: ArrImage[]; ratings?: { tmdb?: { value?: number }; imdb?: { value?: number } } };
};

/**
 * Titre de « Téléchargés » ou de « À décider ». `arrId` est l'identifiant Sonarr (série) ou Radarr (film) du serveur
 * lu ; `year` et `rating` alimentent la carte d'Explorer reprise depuis la v1.4.284 ; `episodes` liste les épisodes
 * importés récemment (historique), vide sinon.
 */
export type RecentImport =
  | { kind: 'series'; key: string; arrId: number; tmdbId?: number; title: string; posterUrl?: string; year?: number; rating?: number; date: number; episodes: Array<{ season: number; episode: number }> }
  | { kind: 'movie'; key: string; arrId: number; tmdbId?: number; title: string; posterUrl?: string; year?: number; rating?: number; date: number };

/**
 * Titre que Sonarr/Radarr détiennent sans fichier (SEENIT-DOWNLOAD-023) : surveillé ou non, avec les dates de sortie
 * d'un film. Il apparaît dans Programmés s'il y est déjà ou s'il est surveillé, sinon dans « À décider ».
 */
export type ArrPendingTitle = RecentImport & { monitored: boolean; release?: { digitalRelease?: string; physicalRelease?: string; inCinemas?: string; isAvailable?: boolean }; profileId?: number };

export interface RecentImports { items: RecentImport[]; failures: string[]; pending: ArrPendingTitle[] }
export type RecentImportsGet = (url: string, headers: Record<string, string>) => Promise<unknown>;

type SonarrSeries = { id?: number; title?: string; tmdbId?: number; year?: number; monitored?: boolean; added?: string; qualityProfileId?: number; ratings?: { value?: number }; images?: ArrImage[]; statistics?: { episodeFileCount?: number } };
type RadarrMovie = { id?: number; title?: string; tmdbId?: number; year?: number; monitored?: boolean; hasFile?: boolean; added?: string; qualityProfileId?: number; isAvailable?: boolean; inCinemas?: string; digitalRelease?: string; physicalRelease?: string; movieFile?: { dateAdded?: string }; ratings?: { tmdb?: { value?: number }; imdb?: { value?: number } }; images?: ArrImage[] };

const DAY = 86_400_000;
const poster = (images?: ArrImage[]) => images?.find(image => image.coverType === 'poster')?.remoteUrl;
const headersFor = (apiKey: string) => ({ 'X-Api-Key': apiKey, Accept: 'application/json' });
// 3 = downloadFolderImported : le fichier est réellement dans la bibliothèque (Sonarr comme Radarr).
const imported = (record: HistoryRecord) => Number(record.eventType) === 3 || /downloadfolderimported/i.test(String(record.eventType || ''));
const when = (record: HistoryRecord) => { const time = Date.parse(record.date || ''); return Number.isFinite(time) ? time : 0; };
const timeOf = (value?: string) => { const time = Date.parse(value || ''); return Number.isFinite(time) ? time : 0; };
const positive = (value: unknown) => { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : undefined; };

/**
 * Section « Téléchargés » de l'onglet Télécharger. Depuis la v1.4.289 (retour terrain du 09/11 : « il ne faut plus
 * de limite à 7 jours d'historique afin de ne pas laisser de données orphelines dans Sonarr/Radarr ») : tout ce que
 * Sonarr et Radarr détiennent avec au moins un fichier, lu dans leur bibliothèque, quelle que soit la date. L'historique
 * (`downloadFolderImported`, 30 jours) ne sert plus qu'à dater et détailler les imports récents ; sans lui, la date est
 * celle du fichier (film) ou de l'ajout. Les titres sans fichier vont dans `pending` (Programmés ou « À décider »).
 * Une bibliothèque illisible est une panne de la source (`failures`), jamais « rien de téléchargé ».
 */
export async function fetchRecentImports(config: DownloadConfig, { now = Date.now(), days = 30, get = executeGet as RecentImportsGet }: { now?: number; days?: number; get?: RecentImportsGet } = {}): Promise<RecentImports> {
  const result: RecentImports = { items: [], failures: [], pending: [] };
  if (!isDownloadFeatureEnabled(config)) return result;
  const since = `date=${encodeURIComponent(new Date(now - days * DAY).toISOString())}&eventType=3`;
  const tasks: Promise<void>[] = [];
  if (config.sonarrUrl && config.sonarrApiKey) {
    const base = cleanUrl(config.sonarrUrl), headers = headersFor(config.sonarrApiKey);
    // Revue Codex #923 : deux lectures indépendantes ; l'historique en panne n'efface pas la bibliothèque.
    tasks.push(Promise.all([get(`${base}/api/v3/series`, headers).catch(() => null), get(`${base}/api/v3/history/since?${since}&includeSeries=true&includeEpisode=true`, headers).catch(() => null)]).then(([library, history]) => {
      if (!Array.isArray(library)) { result.failures.push('Sonarr'); return; }
      const recent = new Map<number, { date: number; episodes: Array<{ season: number; episode: number }> }>();
      for (const record of Array.isArray(history) ? history as HistoryRecord[] : []) {
        const season = Number(record.episode?.seasonNumber), episode = Number(record.episode?.episodeNumber), seriesId = Number(record.seriesId);
        if (!imported(record) || !seriesId || !Number.isInteger(season) || !Number.isInteger(episode)) continue;
        const entry = recent.get(seriesId) || { date: 0, episodes: [] };
        if (!entry.episodes.some(value => value.season === season && value.episode === episode)) entry.episodes.push({ season, episode });
        entry.date = Math.max(entry.date, when(record));
        recent.set(seriesId, entry);
      }
      for (const series of library as SonarrSeries[]) {
        const id = Number(series.id);
        if (!(id > 0)) continue;
        const known = recent.get(id);
        const item = { kind: 'series' as const, key: `s${id}`, arrId: id, tmdbId: positive(series.tmdbId), title: series.title || 'Série', posterUrl: poster(series.images), year: positive(series.year), rating: positive(series.ratings?.value), date: known?.date || timeOf(series.added), episodes: (known?.episodes || []).sort((a, b) => a.season - b.season || a.episode - b.episode) };
        if (Number(series.statistics?.episodeFileCount) > 0) result.items.push(item);
        else result.pending.push({ ...item, monitored: series.monitored === true, profileId: positive(series.qualityProfileId) });
      }
    }));
  }
  if (config.radarrUrl && config.radarrApiKey) {
    const base = cleanUrl(config.radarrUrl), headers = headersFor(config.radarrApiKey);
    tasks.push(Promise.all([get(`${base}/api/v3/movie`, headers).catch(() => null), get(`${base}/api/v3/history/since?${since}&includeMovie=true`, headers).catch(() => null)]).then(([library, history]) => {
      if (!Array.isArray(library)) { result.failures.push('Radarr'); return; }
      const recent = new Map<number, number>();
      for (const record of Array.isArray(history) ? history as HistoryRecord[] : []) {
        const movieId = Number(record.movieId);
        if (imported(record) && movieId) recent.set(movieId, Math.max(recent.get(movieId) || 0, when(record)));
      }
      for (const movie of library as RadarrMovie[]) {
        const id = Number(movie.id);
        if (!(id > 0)) continue;
        const item = { kind: 'movie' as const, key: `m${id}`, arrId: id, tmdbId: positive(movie.tmdbId), title: movie.title || 'Film', posterUrl: poster(movie.images), year: positive(movie.year), rating: positive(movie.ratings?.tmdb?.value ?? movie.ratings?.imdb?.value), date: recent.get(id) || timeOf(movie.movieFile?.dateAdded) || timeOf(movie.added) };
        if (movie.hasFile === true) result.items.push(item);
        else result.pending.push({ ...item, monitored: movie.monitored === true, profileId: positive(movie.qualityProfileId), release: { digitalRelease: movie.digitalRelease, physicalRelease: movie.physicalRelease, inCinemas: movie.inCinemas, isAvailable: movie.isAvailable === true } });
      }
    }));
  }
  await Promise.all(tasks);
  result.items.sort((a, b) => b.date - a.date);
  result.pending.sort((a, b) => b.date - a.date);
  return result;
}

const pad = (value: number) => String(value).padStart(2, '0');
const code = ({ season, episode }: { season: number; episode: number }) => `S${pad(season)}E${pad(episode)}`;
const localDay = (time: number) => { const date = new Date(time); return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY; };

/** « aujourd'hui », « hier », le jour de la semaine abrégé (« lun. ») dans la semaine, sinon la date (« 12 oct. »). */
export function importDayLabel(time: number, now = Date.now()): string {
  const delta = localDay(now) - localDay(time);
  if (delta <= 0) return "aujourd'hui";
  if (delta === 1) return 'hier';
  if (delta < 7) return new Date(time).toLocaleDateString('fr-FR', { weekday: 'short' });
  return new Date(time).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

/** « 2 épisodes · S02E09–E10 », « S01E03 · hier », « Film · lun. » ; « Série » sans import récent. */
export function recentImportLabel(item: RecentImport, now = Date.now()): string {
  if (item.kind === 'movie') return item.date ? `Film · ${importDayLabel(item.date, now)}` : 'Film';
  if (!item.episodes.length) return 'Série';
  const [first] = item.episodes, last = item.episodes[item.episodes.length - 1];
  if (item.episodes.length === 1) return `${code(first)} · ${importDayLabel(item.date, now)}`;
  const end = last.season === first.season ? `E${pad(last.episode)}` : code(last);
  return `${item.episodes.length} épisodes · ${code(first)}–${end}`;
}

/** Même média que l'import (TMDB exact ; épisode exact pour une série) — jamais par le titre. */
export function coveredByRecentImport(imports: RecentImport[], media: { mediaType: 'tv' | 'movie'; tmdbId?: number; seasonNumber?: number; episodeNumber?: number }): boolean {
  if (!media.tmdbId) return false;
  return imports.some(item => item.tmdbId === media.tmdbId && (item.kind === 'movie'
    ? media.mediaType === 'movie'
    : media.mediaType === 'tv' && item.episodes.some(value => value.season === media.seasonNumber && value.episode === media.episodeNumber)));
}

/**
 * Clé d'un retrait mémorisé (revue Codex #923) : `s7` ou `m40` n'ont de sens que sur leur serveur ; la clé
 * porte donc l'adresse du Sonarr (série) ou du Radarr (film) d'origine, sans clé d'API.
 */
export const recentImportServerKey = (config: Pick<DownloadConfig, 'sonarrUrl' | 'radarrUrl'>, item: Pick<RecentImport, 'kind' | 'key'>) =>
  `${cleanUrl((item.kind === 'movie' ? config.radarrUrl : config.sonarrUrl) || '')}|${item.key}`;
/** Imports visibles : après « Vider » et hors retraits mémorisés pour ce serveur (clé → date de l'import retiré). */
export const visibleRecentImports = (items: readonly RecentImport[], clearedAt: number, removed: Readonly<Record<string, number>> = {}, keyOf: (item: RecentImport) => string = item => item.key) =>
  items.filter(item => item.date > clearedAt && item.date > (removed[keyOf(item)] || 0));

/** Portée serveur : une liste lue sur un serveur n'est jamais affichée pour un autre. */
export const recentImportsScope = (config: DownloadConfig) => [isDownloadFeatureEnabled(config), cleanUrl(config.sonarrUrl || ''), config.sonarrApiKey || '', cleanUrl(config.radarrUrl || ''), config.radarrApiKey || ''].join('\n');

type ArrEpisode = { monitored?: boolean; hasFile?: boolean };
export type RecentImportsDelete = (url: string, headers: Record<string, string>) => Promise<unknown>;
/** `removed` : sorti de Sonarr/Radarr ; `kept` : série gardée dans Sonarr car des épisodes y sont encore programmés. */
export type RemoveOutcome = 'removed' | 'kept';

/**
 * « Retirer » d'une carte Téléchargés ou « À décider » (retour terrain et décision du propriétaire du 09/11,
 * `USR-2026-11-09-008`) :
 * - film : retiré de Radarr ;
 * - série : retirée de Sonarr, sauf si la série est surveillée et qu'un épisode y est encore attendu (surveillé sans
 *   fichier, donc programmé) : elle y reste et la suite continue d'arriver. Revue Codex #933 : une série non
 *   surveillée n'attend rien, même si des épisodes restent cochés — elle est retirée, jamais masquée sans retrait.
 *   Depuis « À décider » (`keepAwaited: false`), le titre n'est par construction pas programmé : toujours retiré ;
 * - les fichiers sont toujours gardés (`deleteFiles=false`) : Plex garde le titre.
 * L'identifiant vient de la copie synchronisée du même compte et du même serveur (vérifié par l'appelant).
 */
export async function removeRecentImport(config: DownloadConfig, item: RecentImport, { get = executeGet as RecentImportsGet, del = executeDelete as RecentImportsDelete, keepAwaited = true }: { get?: RecentImportsGet; del?: RecentImportsDelete; keepAwaited?: boolean } = {}): Promise<RemoveOutcome> {
  if (item.kind === 'movie') {
    if (!config.radarrUrl || !config.radarrApiKey) throw new Error('Radarr n’est pas configuré.');
    await del(`${cleanUrl(config.radarrUrl)}/api/v3/movie/${item.arrId}?deleteFiles=false&addImportExclusion=false`, headersFor(config.radarrApiKey));
    return 'removed';
  }
  if (!config.sonarrUrl || !config.sonarrApiKey) throw new Error('Sonarr n’est pas configuré.');
  const base = cleanUrl(config.sonarrUrl), headers = headersFor(config.sonarrApiKey);
  if (keepAwaited) {
    const series = await get(`${base}/api/v3/series/${item.arrId}`, headers);
    if (!series || typeof series !== 'object' || Array.isArray(series)) throw new Error('Sonarr injoignable pour l’instant.');
    if ((series as { monitored?: boolean }).monitored === true) {
      const episodes = await get(`${base}/api/v3/episode?seriesId=${item.arrId}`, headers);
      if (!Array.isArray(episodes)) throw new Error('Sonarr injoignable pour l’instant.');
      if ((episodes as ArrEpisode[]).some(episode => episode.monitored === true && episode.hasFile !== true)) return 'kept';
    }
  }
  await del(`${base}/api/v3/series/${item.arrId}?deleteFiles=false&addImportListExclusion=false`, headers);
  return 'removed';
}
