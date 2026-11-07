import { cleanUrl, executeGet } from '../../services/sonarrRadarr';
import { executePut } from '../../services/sonarrRadarrTransport';
import { isDownloadFeatureEnabled } from './downloadFeatureVisibility';
import type { useDownloadConfigStore } from '../../store/downloadConfigStore';

type DownloadConfig = ReturnType<typeof useDownloadConfigStore.getState>;
type ArrImage = { coverType?: string; remoteUrl?: string; url?: string };
type CalendarEpisode = { id?: number; seriesId?: number; seasonNumber?: number; episodeNumber?: number; title?: string; airDateUtc?: string; airDate?: string; monitored?: boolean; hasFile?: boolean; series?: { title?: string; tmdbId?: number; tvdbId?: number; monitored?: boolean; images?: ArrImage[] } };
type CalendarMovie = { id?: number; title?: string; tmdbId?: number; monitored?: boolean; hasFile?: boolean; digitalRelease?: string; physicalRelease?: string; inCinemas?: string; images?: ArrImage[] };

export type ProgrammedItem =
  | { kind: 'episode'; id: number; seriesId: number; tmdbId?: number; tvdbId?: number; seriesTitle: string; season: number; episode: number; title: string; date?: string; posterUrl?: string }
  | { kind: 'movie'; id: number; tmdbId?: number; title: string; date?: string; posterUrl?: string };

export interface ProgrammedCalendar { items: ProgrammedItem[]; failures: string[] }

export interface CalendarIo {
  get: (url: string, headers: Record<string, string>) => Promise<unknown>;
  put: (url: string, body: unknown, headers: Record<string, string>) => Promise<unknown>;
}
const defaultIo: CalendarIo = { get: executeGet, put: executePut };

const poster = (images?: ArrImage[]) => images?.find(image => image.coverType === 'poster')?.remoteUrl;
const headersFor = (apiKey: string) => ({ 'X-Api-Key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' });
const iso = (time: number) => new Date(time).toISOString();

/**
 * #879 — Section « Programmés » de l'onglet Télécharger (maquette DlOngletSuivi) : ce que Sonarr et
 * Radarr récupéreront à la sortie, lu dans leur calendrier. Seuls les épisodes et films surveillés,
 * sans fichier, dont la série est elle-même surveillée, sont listés. Une source injoignable est rendue
 * dans `failures`, jamais confondue avec « rien de programmé ».
 */
export async function fetchProgrammedCalendar(config: DownloadConfig, { now = Date.now(), days = 120, io = defaultIo }: { now?: number; days?: number; io?: CalendarIo } = {}): Promise<ProgrammedCalendar> {
  const result: ProgrammedCalendar = { items: [], failures: [] };
  if (!isDownloadFeatureEnabled(config)) return result;
  const range = `start=${encodeURIComponent(iso(now))}&end=${encodeURIComponent(iso(now + days * 86_400_000))}&unmonitored=false`;
  const tasks: Promise<void>[] = [];
  if (config.sonarrUrl && config.sonarrApiKey) {
    tasks.push(io.get(`${cleanUrl(config.sonarrUrl)}/api/v3/calendar?${range}&includeSeries=true`, headersFor(config.sonarrApiKey)).then(list => {
      // Une page de connexion HTML ou toute réponse non tableau est une panne, pas un calendrier vide.
      if (!Array.isArray(list)) { result.failures.push('Sonarr'); return; }
      for (const entry of list as CalendarEpisode[]) {
        if (!entry.id || entry.monitored !== true || entry.hasFile === true || entry.series?.monitored === false) continue;
        result.items.push({ kind: 'episode', id: entry.id, seriesId: Number(entry.seriesId) || 0, tmdbId: entry.series?.tmdbId || undefined, tvdbId: entry.series?.tvdbId || undefined, seriesTitle: entry.series?.title || 'Série', season: Number(entry.seasonNumber), episode: Number(entry.episodeNumber), title: entry.title || `Épisode ${entry.episodeNumber}`, date: entry.airDateUtc || entry.airDate, posterUrl: poster(entry.series?.images) });
      }
    }, () => { result.failures.push('Sonarr'); }));
  }
  if (config.radarrUrl && config.radarrApiKey) {
    tasks.push(io.get(`${cleanUrl(config.radarrUrl)}/api/v3/calendar?${range}`, headersFor(config.radarrApiKey)).then(list => {
      if (!Array.isArray(list)) { result.failures.push('Radarr'); return; }
      for (const movie of list as CalendarMovie[]) {
        if (!movie.id || movie.monitored !== true || movie.hasFile === true) continue;
        const date = [movie.digitalRelease, movie.physicalRelease, movie.inCinemas].filter((value): value is string => Boolean(value) && Date.parse(value!) >= now).sort()[0];
        result.items.push({ kind: 'movie', id: movie.id, tmdbId: movie.tmdbId || undefined, title: movie.title || 'Film', date, posterUrl: poster(movie.images) });
      }
    }, () => { result.failures.push('Radarr'); }));
  }
  await Promise.all(tasks);
  result.items.sort((a, b) => (a.date ? Date.parse(a.date) : Infinity) - (b.date ? Date.parse(b.date) : Infinity));
  return result;
}

/** Portée serveur d'une liste « Programmés » : les identifiants Sonarr/Radarr n'ont de sens que sur ce serveur. */
export const programmedScope = (config: DownloadConfig) => [isDownloadFeatureEnabled(config), cleanUrl(config.sonarrUrl || ''), config.sonarrApiKey || '', cleanUrl(config.radarrUrl || ''), config.radarrApiKey || ''].join('\n');

/** Déprogrammer : l'épisode (ou le film) n'est plus surveillé ; rien n'est supprimé. */
export async function unprogramItem(config: DownloadConfig, item: ProgrammedItem, io: CalendarIo = defaultIo): Promise<void> {
  const isEpisode = item.kind === 'episode';
  const url = isEpisode ? config.sonarrUrl : config.radarrUrl;
  const apiKey = isEpisode ? config.sonarrApiKey : config.radarrApiKey;
  if (!isDownloadFeatureEnabled(config) || !url || !apiKey) throw new Error('Téléchargements non configurés.');
  const resource = `${cleanUrl(url)}/api/v3/${isEpisode ? 'episode' : 'movie'}/${item.id}`;
  const current = await io.get(resource, headersFor(apiKey)) as Record<string, unknown> | null;
  if (!current || typeof current !== 'object') throw new Error(`${isEpisode ? 'Sonarr' : 'Radarr'} n’a pas retrouvé cet élément.`);
  await io.put(resource, { ...current, monitored: false }, headersFor(apiKey));
}

/** « ven. 14 nov. » ; le jour même ou le lendemain en toutes lettres. */
export function programmedDateLabel(date: string | undefined, now = Date.now()): string {
  if (!date) return 'Date à venir';
  const day = (time: number) => Math.floor((time - new Date(time).getTimezoneOffset() * 60_000) / 86_400_000);
  const delta = day(Date.parse(date)) - day(now);
  if (delta <= 0) return "Aujourd'hui";
  if (delta === 1) return 'Demain';
  return new Date(date).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}
