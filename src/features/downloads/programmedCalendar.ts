import { cleanUrl, executeGet } from '../../services/sonarrRadarr';
import { executePut } from '../../services/sonarrRadarrTransport';
import { isDownloadFeatureEnabled } from './downloadFeatureVisibility';
import { resolveEffectiveQualityProfileId, type QualityProfileSummary } from './qualityProfileSelection';
import type { useDownloadConfigStore } from '../../store/downloadConfigStore';
import { parseDiskRules, proveDiskFull, type DiskRules } from './arrDiskSpace';
import { diskFullRejection, type ArrRelease } from './downloadNoRelease';

type DownloadConfig = ReturnType<typeof useDownloadConfigStore.getState>;
type ArrImage = { coverType?: string; remoteUrl?: string; url?: string };
type CalendarEpisode = { id?: number; runtime?: number; seriesId?: number; seasonNumber?: number; episodeNumber?: number; title?: string; airDateUtc?: string; airDate?: string; monitored?: boolean; hasFile?: boolean; series?: { title?: string; tmdbId?: number; tvdbId?: number; monitored?: boolean; qualityProfileId?: number; images?: ArrImage[]; added?: string; path?: string; runtime?: number } };
type CalendarMovie = { id?: number; title?: string; tmdbId?: number; monitored?: boolean; hasFile?: boolean; isAvailable?: boolean; qualityProfileId?: number; digitalRelease?: string; physicalRelease?: string; inCinemas?: string; images?: ArrImage[]; added?: string; path?: string; runtime?: number };

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
  | { kind: 'episode'; id: number; seriesId: number; tmdbId?: number; tvdbId?: number; seriesTitle: string; season: number; episode: number; title: string; date?: string; posterUrl?: string; quality?: ProgrammedQuality; profileId?: number; wanted?: boolean; diskFull?: boolean; releaseCheckedAt?: number; releaseAttemptAt?: number; releaseScope?: string; addedAt?: number }
  | { kind: 'movie'; id: number; tmdbId?: number; title: string; date?: string; dateKind?: ReleaseKind; posterUrl?: string; quality?: ProgrammedQuality; profileId?: number; wanted?: boolean; diskFull?: boolean; releaseCheckedAt?: number; releaseAttemptAt?: number; releaseScope?: string; inCinemasPast?: boolean; addedAt?: number };

/** `movieQuality` : libellé de qualité d'un profil Radarr de ce serveur (revue Codex #933 : films ajoutés hors calendrier). */
export interface ProgrammedCalendar { items: ProgrammedItem[]; failures: string[]; movieQuality?: (profileId?: number) => ProgrammedQuality | undefined }

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
/** Date d'ajout dans Sonarr (série) ou Radarr (film), pour l'ordre « ajouté récemment » (retour du 15/11). */
const addedAt = (value?: string) => { const time = value ? Date.parse(value) : NaN; return Number.isFinite(time) ? { addedAt: time } : {}; };
/** Page `wanted/missing` (Sonarr v4, Radarr v5) : `{ records: [...] }` ; toute autre réponse est une panne. */
const wantedRecords = <T,>(page: unknown): T[] | null => {
  const records = (page as { records?: unknown } | null)?.records;
  return Array.isArray(records) ? records as T[] : null;
};
const WANTED_PAGE = 'page=1&pageSize=100&monitored=true';
/** Règles d'espace disque du serveur (voir `arrDiskSpace`) ; une lecture échouée ne prouve rien. */
const readDiskRules = async (io: CalendarIo, base: string, apiKey: string): Promise<DiskRules | null> => {
  const read = (path: string) => io.get(`${base}/api/v3/${path}`, headersFor(apiKey)).catch(() => null);
  const [roots, management, definitions, profiles] = await Promise.all([read('rootfolder'), read('config/mediamanagement'), read('qualitydefinition'), read('qualityprofile')]);
  return parseDiskRules(roots, management, definitions, profiles);
};
/**
 * Retour terrain du 15/11 (Dexter : Résurrection S02E03, « sortie demain » alors qu'elle sortait le jour même) :
 * le jour affiché est le jour de diffusion de la chaîne (`airDate`), comme sur le reste de l'app ; l'heure UTC
 * (`airDateUtc`) ne sert qu'à savoir si l'épisode est déjà sorti. Une date seule est lue comme un jour local.
 */
/**
 * Retour terrain du 15/11 sur la v1.4.314 (« La Guerre des mondes » et S02E03 disponibles mais sans « Disque
 * plein ») : la preuve par la taille minimale du profil ne voit pas un disque qui garde un peu de place, alors
 * que les vraies versions sont plus grosses. Pour un recherché, SeenIt lit donc les versions réellement proposées
 * par Sonarr/Radarr (comme au lancement, `diskFullRejection`) : une version de la qualité demandée refusée pour le
 * seul espace disque prouve le blocage. Pour ménager les indexeurs : au plus `RELEASE_CHECKS_PER_SYNC` titres par
 * synchronisation, chacun relu au plus toutes les `RELEASE_CHECK_TTL_MS` ; entre deux lectures, le dernier résultat
 * (gardé avec la copie) est repris. Une lecture en échec ne prouve rien et sera retentée.
 */
export const RELEASE_CHECK_TTL_MS = 3 * 3_600_000;
export const RELEASE_CHECKS_PER_SYNC = 8;
const qualityPreference = (quality?: string) => /4k|2160/i.test(quality || '') ? '4k' as const : /1080/.test(quality || '') ? '1080p' as const : undefined;
export async function checkWantedReleases(items: ProgrammedItem[], previous: readonly ProgrammedItem[], now: number, read: (item: ProgrammedItem) => Promise<unknown>): Promise<void> {
  const prior = new Map(previous.map(item => [`${item.kind}:${item.id}`, item]));
  // Revue Codex #1053 : une preuve ne vaut que pour la qualité et le profil vérifiés ; un changement la refait.
  const scopeOf = (item: ProgrammedItem) => `${item.profileId || ''}|${item.quality || ''}`;
  const due: ProgrammedItem[] = [];
  for (const item of items) {
    if (!item.wanted) continue;
    const before = prior.get(`${item.kind}:${item.id}`);
    // Revue Codex #1053 : la tentative (même échouée) est gardée pour faire tourner la file des vérifications.
    if (before?.releaseAttemptAt) item.releaseAttemptAt = before.releaseAttemptAt;
    if (before?.releaseCheckedAt && before.releaseScope === scopeOf(item) && now - before.releaseCheckedAt < RELEASE_CHECK_TTL_MS) {
      item.releaseCheckedAt = before.releaseCheckedAt;
      item.releaseScope = before.releaseScope;
      if (before.diskFull) item.diskFull = true;
    } else if (!item.diskFull) due.push(item);
  }
  // Les plus anciennement tentés d'abord : chaque recherché finit par être relu, même si d'autres échouent.
  due.sort((a, b) => (a.releaseAttemptAt || 0) - (b.releaseAttemptAt || 0));
  await Promise.all(due.slice(0, RELEASE_CHECKS_PER_SYNC).map(async item => {
    item.releaseAttemptAt = now;
    const releases = await read(item).catch(() => null);
    if (!Array.isArray(releases)) return;
    item.releaseCheckedAt = now;
    item.releaseScope = scopeOf(item);
    if (diskFullRejection(releases as ArrRelease[], qualityPreference(item.quality))) item.diskFull = true;
  }));
}

export const dayTime = (date: string) => {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])).getTime() : Date.parse(date);
};

/**
 * #879 — Section « Programmés » de l'onglet Télécharger (maquette DlOngletSuivi) : ce que Sonarr et
 * Radarr récupéreront à la sortie, lu dans leur calendrier. Seuls les épisodes et films surveillés,
 * sans fichier, dont la série est elle-même surveillée, sont listés. Une source injoignable est rendue
 * dans `failures`, jamais confondue avec « rien de programmé ».
 */
export async function fetchProgrammedCalendar(config: DownloadConfig, { now = Date.now(), days = 120, io = defaultIo, previous = [] }: { now?: number; days?: number; io?: CalendarIo; previous?: readonly ProgrammedItem[] } = {}): Promise<ProgrammedCalendar> {
  const result: ProgrammedCalendar = { items: [], failures: [] };
  if (!isDownloadFeatureEnabled(config)) return result;
  const range = `start=${encodeURIComponent(iso(now))}&end=${encodeURIComponent(iso(now + days * 86_400_000))}&unmonitored=false`;
  const tasks: Promise<void>[] = [];
  if (config.sonarrUrl && config.sonarrApiKey) {
    const { sonarrUrl, sonarrApiKey } = config;
    const base = cleanUrl(sonarrUrl);
    tasks.push(Promise.all([io.get(`${base}/api/v3/calendar?${range}&includeSeries=true`, headersFor(sonarrApiKey)).catch(() => null), readProfiles(io, sonarrUrl, sonarrApiKey),
      io.get(`${base}/api/v3/wanted/missing?${WANTED_PAGE}&includeSeries=true&sortKey=episodes.airDateUtc&sortDirection=descending`, headersFor(sonarrApiKey)).catch(() => null),
      readDiskRules(io, base, sonarrApiKey)]).then(([list, profiles, wantedPage, disk]) => {
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
        const date = entry.airDate || entry.airDateUtc;
        const airedAt = entry.airDateUtc || entry.airDate;
        // Retour terrain du 15/11 (S02E03 « Sortie aujourd'hui » alors que disponible) : sorti dès son jour de diffusion local.
        const wanted = Boolean(airedAt && Date.parse(airedAt) < now) || Boolean(entry.airDate && dayTime(entry.airDate) <= now);
        const diskFull = wanted && proveDiskFull(disk, { path: entry.series?.path, runtime: Number(entry.runtime) > 0 ? entry.runtime : entry.series?.runtime, profileId, special: Number(entry.seasonNumber) === 0 });
        result.items.push({ kind: 'episode', id: entry.id, seriesId: Number(entry.seriesId) || 0, tmdbId: entry.series?.tmdbId || undefined, tvdbId: entry.series?.tvdbId || undefined, seriesTitle: entry.series?.title || 'Série', season: Number(entry.seasonNumber), episode: Number(entry.episodeNumber), title: entry.title || `Épisode ${entry.episodeNumber}`, date, posterUrl: poster(entry.series?.images), profileId, quality: profileQualityLabel(profileId, profiles, { hd: config.sonarr1080pProfileId, uhd: config.sonarr4kProfileId }), ...(wanted ? { wanted: true } : {}), ...(diskFull ? { diskFull: true } : {}), ...addedAt(entry.series?.added) });
      }
    }, () => { result.failures.push('Sonarr'); }));
  }
  if (config.radarrUrl && config.radarrApiKey) {
    const { radarrUrl, radarrApiKey } = config;
    const base = cleanUrl(radarrUrl);
    tasks.push(Promise.all([io.get(`${base}/api/v3/calendar?${range}`, headersFor(radarrApiKey)).catch(() => null), readProfiles(io, radarrUrl, radarrApiKey),
      io.get(`${base}/api/v3/wanted/missing?${WANTED_PAGE}`, headersFor(radarrApiKey)).catch(() => null),
      readDiskRules(io, base, radarrApiKey)]).then(([list, profiles, wantedPage, disk]) => {
      result.movieQuality = profileId => profileQualityLabel(profileId, profiles, { hd: config.radarr1080pProfileId, uhd: config.radarr4kProfileId });
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
        const extra = release.date ? {} : movie.isAvailable === true ? { wanted: true, ...(proveDiskFull(disk, { path: movie.path, runtime: movie.runtime, profileId }) ? { diskFull: true } : {}) } : release.inCinemasPast ? { inCinemasPast: true } : {};
        result.items.push({ kind: 'movie', id: movie.id, tmdbId: movie.tmdbId || undefined, title: movie.title || 'Film', date: release.date, dateKind: release.kind, posterUrl: poster(movie.images), profileId, quality: profileQualityLabel(profileId, profiles, { hd: config.radarr1080pProfileId, uhd: config.radarr4kProfileId }), ...extra, ...addedAt(movie.added) });
      }
    }, () => { result.failures.push('Radarr'); }));
  }
  await Promise.all(tasks);
  await checkWantedReleases(result.items, previous, now, item => {
    const isEpisode = item.kind === 'episode';
    const url = isEpisode ? config.sonarrUrl : config.radarrUrl;
    const apiKey = isEpisode ? config.sonarrApiKey : config.radarrApiKey;
    return url && apiKey ? io.get(`${cleanUrl(url)}/api/v3/release?${isEpisode ? 'episodeId' : 'movieId'}=${item.id}`, headersFor(apiKey)) : Promise.resolve(null);
  });
  result.items = sortProgrammedItems(result.items);
  return result;
}

/** À venir d'abord, par date ; puis les recherchés, les plus récents en tête ; enfin les dates inconnues. */
export function sortProgrammedItems(items: readonly ProgrammedItem[]): ProgrammedItem[] {
  const rank = (item: ProgrammedItem) => item.wanted ? 1 : item.date ? 0 : 2;
  const time = (item: ProgrammedItem) => item.date ? dayTime(item.date) : 0;
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
  const delta = day(dayTime(date)) - day(now);
  if (delta <= 0) return "Aujourd'hui";
  if (delta === 1) return 'Demain';
  return new Date(dayTime(date)).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}
