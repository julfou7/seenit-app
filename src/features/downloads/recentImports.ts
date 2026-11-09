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
 * Import de la rangée « Téléchargés ». `arrId` est l'identifiant Sonarr (série) ou Radarr (film) du serveur lu ;
 * `year` et `rating` alimentent la carte d'Explorer reprise depuis la v1.4.284.
 */
export type RecentImport =
  | { kind: 'series'; key: string; arrId: number; tmdbId?: number; title: string; posterUrl?: string; year?: number; rating?: number; date: number; episodes: Array<{ season: number; episode: number }> }
  | { kind: 'movie'; key: string; arrId: number; tmdbId?: number; title: string; posterUrl?: string; year?: number; rating?: number; date: number };

export interface RecentImports { items: RecentImport[]; failures: string[] }
export type RecentImportsGet = (url: string, headers: Record<string, string>) => Promise<unknown>;

const DAY = 86_400_000;
const poster = (images?: ArrImage[]) => images?.find(image => image.coverType === 'poster')?.remoteUrl;
const headersFor = (apiKey: string) => ({ 'X-Api-Key': apiKey, Accept: 'application/json' });
// 3 = downloadFolderImported : le fichier est réellement dans la bibliothèque (Sonarr comme Radarr).
const imported = (record: HistoryRecord) => Number(record.eventType) === 3 || /downloadfolderimported/i.test(String(record.eventType || ''));
const when = (record: HistoryRecord) => { const time = Date.parse(record.date || ''); return Number.isFinite(time) ? time : 0; };
const positive = (value: unknown) => { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : undefined; };

/**
 * Rangée « Téléchargés · 7 derniers jours » de l'onglet Télécharger (maquette DlOngletSuivi) : les imports
 * réels de Sonarr/Radarr (historique `downloadFolderImported`), y compris ce qu'ils ont récupéré seuls
 * à la sortie. Une série regroupe ses épisodes importés ; un même épisode importé deux fois (nouvelle
 * version) ne compte qu'une fois. Une source injoignable est rendue dans `failures`, jamais confondue
 * avec « rien de téléchargé ».
 */
export async function fetchRecentImports(config: DownloadConfig, { now = Date.now(), days = 7, get = executeGet as RecentImportsGet }: { now?: number; days?: number; get?: RecentImportsGet } = {}): Promise<RecentImports> {
  const result: RecentImports = { items: [], failures: [] };
  if (!isDownloadFeatureEnabled(config)) return result;
  const since = `date=${encodeURIComponent(new Date(now - days * DAY).toISOString())}&eventType=3`;
  const series = new Map<number, Extract<RecentImport, { kind: 'series' }>>();
  const movies = new Map<number, Extract<RecentImport, { kind: 'movie' }>>();
  const tasks: Promise<void>[] = [];
  if (config.sonarrUrl && config.sonarrApiKey) {
    tasks.push(get(`${cleanUrl(config.sonarrUrl)}/api/v3/history/since?${since}&includeSeries=true&includeEpisode=true`, headersFor(config.sonarrApiKey)).then(list => {
      if (!Array.isArray(list)) { result.failures.push('Sonarr'); return; }
      for (const record of list as HistoryRecord[]) {
        const season = Number(record.episode?.seasonNumber), episode = Number(record.episode?.episodeNumber), seriesId = Number(record.seriesId);
        if (!imported(record) || !seriesId || !Number.isInteger(season) || !Number.isInteger(episode)) continue;
        const entry = series.get(seriesId) || { kind: 'series' as const, key: `s${seriesId}`, arrId: seriesId, tmdbId: record.series?.tmdbId || undefined, title: record.series?.title || 'Série', posterUrl: poster(record.series?.images), year: positive(record.series?.year), rating: positive(record.series?.ratings?.value), date: 0, episodes: [] };
        if (!entry.episodes.some(value => value.season === season && value.episode === episode)) entry.episodes.push({ season, episode });
        entry.date = Math.max(entry.date, when(record));
        series.set(seriesId, entry);
      }
    }, () => { result.failures.push('Sonarr'); }));
  }
  if (config.radarrUrl && config.radarrApiKey) {
    tasks.push(get(`${cleanUrl(config.radarrUrl)}/api/v3/history/since?${since}&includeMovie=true`, headersFor(config.radarrApiKey)).then(list => {
      if (!Array.isArray(list)) { result.failures.push('Radarr'); return; }
      for (const record of list as HistoryRecord[]) {
        const movieId = Number(record.movieId);
        if (!imported(record) || !movieId) continue;
        const entry = movies.get(movieId) || { kind: 'movie' as const, key: `m${movieId}`, arrId: movieId, tmdbId: record.movie?.tmdbId || undefined, title: record.movie?.title || 'Film', posterUrl: poster(record.movie?.images), year: positive(record.movie?.year), rating: positive(record.movie?.ratings?.tmdb?.value ?? record.movie?.ratings?.imdb?.value), date: 0 };
        entry.date = Math.max(entry.date, when(record));
        movies.set(movieId, entry);
      }
    }, () => { result.failures.push('Radarr'); }));
  }
  await Promise.all(tasks);
  for (const entry of series.values()) entry.episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
  result.items = [...series.values(), ...movies.values()].sort((a, b) => b.date - a.date);
  return result;
}

const pad = (value: number) => String(value).padStart(2, '0');
const code = ({ season, episode }: { season: number; episode: number }) => `S${pad(season)}E${pad(episode)}`;
const localDay = (time: number) => { const date = new Date(time); return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY; };

/** « aujourd'hui », « hier », sinon le jour de la semaine abrégé (« lun. ») : la rangée couvre 7 jours. */
export function importDayLabel(time: number, now = Date.now()): string {
  const delta = localDay(now) - localDay(time);
  if (delta <= 0) return "aujourd'hui";
  if (delta === 1) return 'hier';
  return new Date(time).toLocaleDateString('fr-FR', { weekday: 'short' });
}

/** « 2 épisodes · S02E09–E10 », « S01E03 · hier » ou « Film · lun. ». */
export function recentImportLabel(item: RecentImport, now = Date.now()): string {
  if (item.kind === 'movie') return `Film · ${importDayLabel(item.date, now)}`;
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
 * « Retirer » d'une carte Téléchargés (retour terrain et décision du propriétaire du 09/11, `USR-2026-11-09-008`) :
 * - film : retiré de Radarr ;
 * - série : retirée de Sonarr seulement si aucun épisode n'y est encore attendu (surveillé sans fichier, donc
 *   programmé) ; sinon elle y reste et la suite continue d'arriver ;
 * - les fichiers sont toujours gardés (`deleteFiles=false`) : Plex garde le titre.
 * L'identifiant vient de la copie synchronisée du même compte et du même serveur (vérifié par l'appelant).
 */
export async function removeRecentImport(config: DownloadConfig, item: RecentImport, { get = executeGet as RecentImportsGet, del = executeDelete as RecentImportsDelete }: { get?: RecentImportsGet; del?: RecentImportsDelete } = {}): Promise<RemoveOutcome> {
  if (item.kind === 'movie') {
    if (!config.radarrUrl || !config.radarrApiKey) throw new Error('Radarr n’est pas configuré.');
    await del(`${cleanUrl(config.radarrUrl)}/api/v3/movie/${item.arrId}?deleteFiles=false&addImportExclusion=false`, headersFor(config.radarrApiKey));
    return 'removed';
  }
  if (!config.sonarrUrl || !config.sonarrApiKey) throw new Error('Sonarr n’est pas configuré.');
  const base = cleanUrl(config.sonarrUrl), headers = headersFor(config.sonarrApiKey);
  const episodes = await get(`${base}/api/v3/episode?seriesId=${item.arrId}`, headers);
  if (!Array.isArray(episodes)) throw new Error('Sonarr injoignable pour l’instant.');
  if ((episodes as ArrEpisode[]).some(episode => episode.monitored === true && episode.hasFile !== true)) return 'kept';
  await del(`${base}/api/v3/series/${item.arrId}?deleteFiles=false&addImportListExclusion=false`, headers);
  return 'removed';
}
