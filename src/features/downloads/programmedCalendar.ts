import { cleanUrl, executeGet } from '../../services/sonarrRadarr';
import { executePut } from '../../services/sonarrRadarrTransport';
import { isDownloadFeatureEnabled } from './downloadFeatureVisibility';
import { resolveEffectiveQualityProfileId, type QualityProfileSummary } from './qualityProfileSelection';
import type { useDownloadConfigStore } from '../../store/downloadConfigStore';

type DownloadConfig = ReturnType<typeof useDownloadConfigStore.getState>;
type ArrImage = { coverType?: string; remoteUrl?: string; url?: string };
type CalendarEpisode = { id?: number; seriesId?: number; seasonNumber?: number; episodeNumber?: number; title?: string; airDateUtc?: string; airDate?: string; monitored?: boolean; hasFile?: boolean; series?: { title?: string; tmdbId?: number; tvdbId?: number; monitored?: boolean; qualityProfileId?: number; images?: ArrImage[] } };
type CalendarMovie = { id?: number; title?: string; tmdbId?: number; monitored?: boolean; hasFile?: boolean; isAvailable?: boolean; qualityProfileId?: number; digitalRelease?: string; physicalRelease?: string; inCinemas?: string; images?: ArrImage[] };

/** Retour terrain du 08/11 : la date d'un film dit de quelle sortie il s'agit (seule une version numérique ou
 * physique se télécharge ; une sortie au cinéma seule ne donne pas encore de version). */
export type ReleaseKind = 'air' | 'digital' | 'physical' | 'cinema';
/** Qualité réellement demandée à Sonarr/Radarr (profil de la série ou du film). */
export type ProgrammedQuality = string;

/**
 * `wanted` : déjà sorti, surveillé et sans fichier — Sonarr/Radarr le cherchent encore (« Recherché », décision du
 * propriétaire du 09/11, `USR-2026-11-09-009`). `inCinemasPast` : film sorti en salle sans date numérique connue.
 */
export type ProgrammedItem =
  | { kind: 'episode'; id: number; seriesId: number; tmdbId?: number; tvdbId?: number; seriesTitle: string; season: number; episode: number; title: string; date?: string; posterUrl?: string; quality?: ProgrammedQuality; profileId?: number; wanted?: boolean }
  | { kind: 'movie'; id: number; tmdbId?: number; title: string; date?: string; dateKind?: ReleaseKind; posterUrl?: string; quality?: ProgrammedQuality; profileId?: number; wanted?: boolean; inCinemasPast?: boolean };

export interface ProgrammedCalendar { items: ProgrammedItem[]; failures: string[] }

export interface CalendarIo {
  get: (url: string, headers: Record<string, string>) => Promise<unknown>;
  put: (url: string, body: unknown, headers: Record<string, string>) => Promise<unknown>;
}
const defaultIo: CalendarIo = { get: executeGet, put: executePut };

const poster = (images?: ArrImage[]) => images?.find(image => image.coverType === 'poster')?.remoteUrl;

/** Prochaine sortie téléchargeable d'un film : numérique, puis physique ; le cinéma seul sinon. */
export function movieRelease(movie: { digitalRelease?: string; physicalRelease?: string; inCinemas?: string }, now = Date.now()): { date?: string; kind?: ReleaseKind; inCinemasPast: boolean } {
  const future = (value?: string) => Boolean(value) && Date.parse(value!) >= now;
  const candidates: Array<[string | undefined, ReleaseKind]> = [[movie.digitalRelease, 'digital'], [movie.physicalRelease, 'physical'], [movie.inCinemas, 'cinema']];
  const next = candidates.filter(([value]) => future(value)).sort((a, b) => Date.parse(a[0]!) - Date.parse(b[0]!));
  // Au cinéma puis en numérique : la date utile est celle de la version, pas celle de la salle.
  const download = next.find(([, kind]) => kind !== 'cinema') || next[0];
  return { date: download?.[0], kind: download?.[1], inCinemasPast: Boolean(movie.inCinemas) && !future(movie.inCinemas) };
}

/** « 1080p » ou « 4K » quand le profil est celui que SeenIt utilise pour ce choix ; sinon le nom du profil. */
export function profileQualityLabel(profileId: number | undefined, profiles: readonly QualityProfileSummary[], configured: { hd?: number | null; uhd?: number | null } = {}): ProgrammedQuality | undefined {
  if (!profileId) return undefined;
  if (profileId === resolveEffectiveQualityProfileId([...profiles], '4k', configured.uhd)) return '4K';
  if (profileId === resolveEffectiveQualityProfileId([...profiles], '1080p', configured.hd)) return '1080p';
  return profiles.find(profile => profile.id === profileId)?.name || undefined;
}

const readProfiles = async (io: CalendarIo, url: string, apiKey: string): Promise<QualityProfileSummary[]> => {
  const list = await io.get(`${cleanUrl(url)}/api/v3/qualityprofile`, headersFor(apiKey)).catch(() => null);
  return Array.isArray(list) ? (list as Array<{ id?: number; name?: string }>).filter(entry => Number(entry.id) > 0).map(entry => ({ id: Number(entry.id), name: String(entry.name || '') })) : [];
};
const headersFor = (apiKey: string) => ({ 'X-Api-Key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' });
const iso = (time: number) => new Date(time).toISOString();
/** Page `wanted/missing` (Sonarr v4, Radarr v5) : `{ records: [...] }` ; toute autre réponse est une panne. */
const wantedRecords = <T,>(page: unknown): T[] | null => {
  const records = (page as { records?: unknown } | null)?.records;
  return Array.isArray(records) ? records as T[] : null;
};
const WANTED_PAGE = 'page=1&pageSize=100&monitored=true';

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
    const { sonarrUrl, sonarrApiKey } = config;
    const base = cleanUrl(sonarrUrl);
    tasks.push(Promise.all([io.get(`${base}/api/v3/calendar?${range}&includeSeries=true`, headersFor(sonarrApiKey)).catch(() => null), readProfiles(io, sonarrUrl, sonarrApiKey),
      io.get(`${base}/api/v3/wanted/missing?${WANTED_PAGE}&includeSeries=true&sortKey=episodes.airDateUtc&sortDirection=descending`, headersFor(sonarrApiKey)).catch(() => null)]).then(([list, profiles, wantedPage]) => {
      // Une page de connexion HTML ou toute réponse non tableau est une panne, pas un calendrier vide. Revue Codex
      // #923 : calendrier et recherchés sont lus indépendamment — une panne de l'un garde l'autre et signale la source.
      const calendar = Array.isArray(list) ? list as CalendarEpisode[] : null;
      const wanted = wantedRecords<CalendarEpisode>(wantedPage);
      if (!calendar || !wanted) result.failures.push('Sonarr');
      const seen = new Set<number>();
      for (const entry of [...calendar || [], ...wanted || []]) {
        if (!entry.id || seen.has(entry.id) || entry.monitored !== true || entry.hasFile === true || entry.series?.monitored === false) continue;
        seen.add(entry.id);
        const profileId = Number(entry.series?.qualityProfileId) || undefined;
        const date = entry.airDateUtc || entry.airDate;
        result.items.push({ kind: 'episode', id: entry.id, seriesId: Number(entry.seriesId) || 0, tmdbId: entry.series?.tmdbId || undefined, tvdbId: entry.series?.tvdbId || undefined, seriesTitle: entry.series?.title || 'Série', season: Number(entry.seasonNumber), episode: Number(entry.episodeNumber), title: entry.title || `Épisode ${entry.episodeNumber}`, date, posterUrl: poster(entry.series?.images), profileId, quality: profileQualityLabel(profileId, profiles, { hd: config.sonarr1080pProfileId, uhd: config.sonarr4kProfileId }), ...(date && Date.parse(date) < now ? { wanted: true } : {}) });
      }
    }, () => { result.failures.push('Sonarr'); }));
  }
  if (config.radarrUrl && config.radarrApiKey) {
    const { radarrUrl, radarrApiKey } = config;
    const base = cleanUrl(radarrUrl);
    tasks.push(Promise.all([io.get(`${base}/api/v3/calendar?${range}`, headersFor(radarrApiKey)).catch(() => null), readProfiles(io, radarrUrl, radarrApiKey),
      io.get(`${base}/api/v3/wanted/missing?${WANTED_PAGE}`, headersFor(radarrApiKey)).catch(() => null)]).then(([list, profiles, wantedPage]) => {
      const calendar = Array.isArray(list) ? list as CalendarMovie[] : null;
      const wanted = wantedRecords<CalendarMovie>(wantedPage);
      if (!calendar || !wanted) result.failures.push('Radarr');
      const seen = new Set<number>();
      for (const movie of [...calendar || [], ...wanted || []]) {
        if (!movie.id || seen.has(movie.id) || movie.monitored !== true || movie.hasFile === true) continue;
        seen.add(movie.id);
        const release = movieRelease(movie, now);
        const profileId = Number(movie.qualityProfileId) || undefined;
        // Sans sortie à venir : disponible selon Radarr → recherché ; sinon sorti en salle, version pas encore annoncée.
        const extra = release.date ? {} : movie.isAvailable === true ? { wanted: true } : release.inCinemasPast ? { inCinemasPast: true } : {};
        result.items.push({ kind: 'movie', id: movie.id, tmdbId: movie.tmdbId || undefined, title: movie.title || 'Film', date: release.date, dateKind: release.kind, posterUrl: poster(movie.images), profileId, quality: profileQualityLabel(profileId, profiles, { hd: config.radarr1080pProfileId, uhd: config.radarr4kProfileId }), ...extra });
      }
    }, () => { result.failures.push('Radarr'); }));
  }
  await Promise.all(tasks);
  result.items = sortProgrammedItems(result.items);
  return result;
}

/** À venir d'abord, par date ; puis les recherchés, les plus récents en tête ; enfin les dates inconnues. */
export function sortProgrammedItems(items: readonly ProgrammedItem[]): ProgrammedItem[] {
  const rank = (item: ProgrammedItem) => item.wanted ? 1 : item.date ? 0 : 2;
  const time = (item: ProgrammedItem) => item.date ? Date.parse(item.date) : 0;
  return [...items].sort((a, b) => rank(a) - rank(b) || (rank(a) === 1 ? time(b) - time(a) : time(a) - time(b)));
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

/**
 * Film suivi sans entrée au calendrier (« Le Chat Chapeauté », retour terrain du 08/11) : ses dates sont lues
 * dans Radarr par l'identifiant TMDB exact, avec sa qualité. Une panne rend `null`, jamais une fausse date.
 */
export async function fetchWatchedMovie(config: DownloadConfig, tmdbId: number, io: CalendarIo = defaultIo, now = Date.now()): Promise<{ id?: number; date?: string; dateKind?: ReleaseKind; inCinemasPast: boolean; quality?: ProgrammedQuality } | null> {
  if (!isDownloadFeatureEnabled(config) || !config.radarrUrl || !config.radarrApiKey || !(tmdbId > 0)) return null;
  const [list, profiles] = await Promise.all([io.get(`${cleanUrl(config.radarrUrl)}/api/v3/movie?tmdbId=${tmdbId}`, headersFor(config.radarrApiKey)).catch(() => null), readProfiles(io, config.radarrUrl, config.radarrApiKey)]);
  const movie = Array.isArray(list) ? (list as CalendarMovie[]).find(entry => Number(entry.tmdbId) === tmdbId) : null;
  if (!movie) return null;
  const release = movieRelease(movie, now);
  return { id: movie.id, date: release.date, dateKind: release.kind, inCinemasPast: release.inCinemasPast, quality: profileQualityLabel(Number(movie.qualityProfileId) || undefined, profiles, { hd: config.radarr1080pProfileId, uhd: config.radarr4kProfileId }) };
}

/**
 * « Changer la qualité » (menu ⋯ de Programmés, retour terrain du 08/11) : le profil 1080p ou 4K de SeenIt est
 * appliqué au film Radarr ou à la série Sonarr (toute la série, comme lors d'un lancement). Rien n'est recherché.
 */
export async function changeProgrammedQuality(config: DownloadConfig, target: { kind: 'movie'; id: number } | { kind: 'series'; id: number }, preference: '1080p' | '4k', io: CalendarIo = defaultIo): Promise<void> {
  const isMovie = target.kind === 'movie';
  const url = isMovie ? config.radarrUrl : config.sonarrUrl;
  const apiKey = isMovie ? config.radarrApiKey : config.sonarrApiKey;
  if (!isDownloadFeatureEnabled(config) || !url || !apiKey) throw new Error('Téléchargements non configurés.');
  const explicit = isMovie ? (preference === '4k' ? config.radarr4kProfileId : config.radarr1080pProfileId) : (preference === '4k' ? config.sonarr4kProfileId : config.sonarr1080pProfileId);
  const profileId = resolveEffectiveQualityProfileId(await readProfiles(io, url, apiKey), preference, explicit);
  if (!profileId) throw new Error(`Aucun profil ${preference === '4k' ? '4K' : '1080p'} n’est disponible dans ${isMovie ? 'Radarr' : 'Sonarr'}.`);
  const resource = `${cleanUrl(url)}/api/v3/${isMovie ? 'movie' : 'series'}/${target.id}`;
  const current = await io.get(resource, headersFor(apiKey)) as Record<string, unknown> | null;
  if (!current || typeof current !== 'object') throw new Error(`${isMovie ? 'Radarr' : 'Sonarr'} n’a pas retrouvé cet élément.`);
  if (Number(current.qualityProfileId) === profileId) return;
  await io.put(resource, { ...current, qualityProfileId: profileId }, headersFor(apiKey));
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
