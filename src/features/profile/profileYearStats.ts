import type { Show } from '../../types.ts';
import { historyEpisodeEntries } from '../history/historyRecords.ts';
import { historyLocalDayKey, resolveHistoryTimestamp } from '../history/historyPresentation.ts';
import { getProfilePlatformName } from './profileAnalyticsSnapshot.ts';

// Mêmes estimations que les compteurs du Profil lorsque la durée réelle manque.
const EPISODE_MINUTES = 45;
const MOVIE_MINUTES = 110;
const DAY_MS = 86_400_000;
const PROJECTION_WINDOW_DAYS = 28;
const MAX_DAY_MINUTES = 24 * 60;

export const PROFILE_MONTH_LABELS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
export const PROFILE_MONTH_SHORT = ['JAN', 'FÉV', 'MAR', 'AVR', 'MAI', 'JUIN', 'JUIL', 'AOÛ', 'SEP', 'OCT', 'NOV', 'DÉC'];
export const PROFILE_WEEKDAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const WEEKDAY_NAMES = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
// SEENIT-PROFILE-003 : la semaine entière en huit tranches de trois heures, sans fenêtre glissante.
const PUNCH_SLOT_HOURS = 3;
const PUNCH_SLOTS = 24 / PUNCH_SLOT_HOURS;
const PROFILE_PLATFORM_LIMIT = 6;
// Retour terrain v1.4.291 : marquer Vu le matin ne veut pas dire regarder le matin. Dès vingt lectures Plex à
// l'heure réelle, la grille ne compte qu'elles ; sinon elle dit qu'elle montre l'heure des Vu.
export const PROFILE_PUNCH_PLEX_MIN = 20;
export const PROFILE_UNKNOWN_PLATFORM = 'Autres';

export interface ProfileViewing {
  showId: string;
  title: string;
  posterPath: string | null;
  mediaType: 'tv' | 'movie';
  season: number;
  platform: string;
  watchedAt: number;
  timeKnown: boolean;
  /** L'heure vient d'une lecture Plex (heure réelle), pas d'un Vu marqué dans l'app (heure du geste). */
  plexTime?: boolean;
  minutes: number;
}

export function formatProfileHours(minutes: number): string {
  return minutes > 0 && minutes < 60 ? `${Math.round(minutes)} min` : `${Math.round(minutes / 60).toLocaleString('fr-FR')} h`;
}

const asPositiveNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

/**
 * Seule une preuve de visionnage date un visionnage : la date de l'épisode ou du film, ou pour un film
 * la dernière action « vu ». `updatedAt`/`createdAt` datent le document (synchro des fiches, import),
 * pas le visionnage : les utiliser plaçait des dizaines de films importés au mois d'une synchro.
 */
function resolveViewingTime(show: Show, record: Record<string, unknown> | null) {
  const resolved = show.mediaType === 'movie'
    ? resolveHistoryTimestamp(record?.watchedAt, show.lastWatchedAt)
    : resolveHistoryTimestamp(record?.watchedAt);
  if (!resolved) return null;
  return { watchedAt: resolved.watchedAt, timeKnown: record?.watchedTimeKnown === false ? false : resolved.timeKnown };
}

/** Films et épisodes vus sans date de visionnage prouvée (typiquement l'import TV Time des films). */
export function countUndatedProfileViewings(shows: readonly Show[]): number {
  let undated = 0;
  for (const show of shows) {
    if (!show?.id) continue;
    if (show.mediaType === 'movie') {
      if (!show.seenEpisodes?.includes('movie') && show.status !== 'completed') continue;
      if (!resolveViewingTime(show, asRecord(show.episodeRecords?.movie))) undated++;
      continue;
    }
    for (const { record } of historyEpisodeEntries(show)) if (!resolveViewingTime(show, record)) undated++;
  }
  return undated;
}

export function formatProfileUndatedNote(undated: number): string | null {
  if (undated <= 0) return null;
  return `${undated.toLocaleString('fr-FR')} ${undated > 1 ? 'visionnages sans date ne sont pas comptés' : 'visionnage sans date n’est pas compté'} (import sans date de visionnage).`;
}

/** Un visionnage daté par épisode ou film vu, uniquement sur preuve de date. */
export function collectProfileViewings(shows: readonly Show[]): ProfileViewing[] {
  const viewings: ProfileViewing[] = [];
  for (const show of shows) {
    if (!show?.id) continue;
    const platform = getProfilePlatformName(show);
    const base = { showId: show.id, title: show.title || '', posterPath: show.posterPath || null };
    if (show.mediaType === 'movie') {
      if (!show.seenEpisodes?.includes('movie') && show.status !== 'completed') continue;
      const record = asRecord(show.episodeRecords?.movie);
      const timing = resolveViewingTime(show, record);
      if (!timing) continue;
      viewings.push({
        ...base,
        mediaType: 'movie',
        season: 0,
        platform: record?.plexImported === true ? 'Plex' : platform,
        ...timing,
        plexTime: record?.plexImported === true,
        minutes: asPositiveNumber(record?.runtime) || MOVIE_MINUTES,
      });
      continue;
    }
    for (const { key, record } of historyEpisodeEntries(show)) {
      const season = Number(key.split('x')[0]);
      const timing = resolveViewingTime(show, record);
      if (!timing) continue;
      viewings.push({
        ...base,
        mediaType: 'tv',
        season,
        platform: record?.plexImported === true ? 'Plex' : platform,
        ...timing,
        plexTime: record?.plexImported === true,
        minutes: asPositiveNumber(record?.runtime) || EPISODE_MINUTES,
      });
    }
  }
  return viewings;
}

export interface ProfileImportDay {
  day: string;
  watchedAt: number;
  minutes: number;
  count: number;
}

/**
 * Plus de 24 h de visionnage le même jour n'est pas un vrai jour de visionnage :
 * c'est un import (TV Time date chaque épisode au moment de l'import) ou un rattrapage
 * en masse. Ces journées sortent des chiffres par période sans toucher aux totaux du Profil.
 */
export function partitionProfileViewings(viewings: readonly ProfileViewing[]): { viewings: ProfileViewing[]; imports: ProfileImportDay[] } {
  const days = new Map<string, ProfileImportDay>();
  for (const viewing of viewings) {
    const key = historyLocalDayKey(viewing.watchedAt);
    const day = days.get(key) || { day: key, watchedAt: viewing.watchedAt, minutes: 0, count: 0 };
    day.minutes += viewing.minutes;
    day.count++;
    days.set(key, day);
  }
  const imports = [...days.values()].filter(day => day.minutes > MAX_DAY_MINUTES).sort((left, right) => left.watchedAt - right.watchedAt);
  if (imports.length === 0) return { viewings: [...viewings], imports };
  const excluded = new Set(imports.map(day => day.day));
  return { viewings: viewings.filter(viewing => !excluded.has(historyLocalDayKey(viewing.watchedAt))), imports };
}

// SEENIT-PROFILE-006 : trois épisodes ou plus d'une même série marqués à moins de cinq minutes d'écart ne sont
// pas un marathon mais un rattrapage (saison ou série marquée d'un coup, série vue par le passé).
export const PROFILE_CATCH_UP_GAP_MS = 5 * 60_000;
export const PROFILE_CATCH_UP_MIN = 3;

/** Visionnages marqués en rafale, série par série ; les films ne sont jamais groupés. */
export function findProfileCatchUps(viewings: readonly ProfileViewing[]): Set<ProfileViewing> {
  const byShow = new Map<string, ProfileViewing[]>();
  for (const viewing of viewings) {
    // Revue Codex #949 : une heure inconnue (midi par défaut) ne prouve aucune rafale.
    if (viewing.mediaType !== 'tv' || !viewing.timeKnown) continue;
    const list = byShow.get(viewing.showId);
    if (list) list.push(viewing); else byShow.set(viewing.showId, [viewing]);
  }
  const catchUps = new Set<ProfileViewing>();
  for (const list of byShow.values()) {
    if (list.length < PROFILE_CATCH_UP_MIN) continue;
    list.sort((left, right) => left.watchedAt - right.watchedAt);
    let start = 0;
    for (let index = 1; index <= list.length; index++) {
      if (index < list.length && list[index].watchedAt - list[index - 1].watchedAt <= PROFILE_CATCH_UP_GAP_MS) continue;
      if (index - start >= PROFILE_CATCH_UP_MIN) for (let member = start; member < index; member++) catchUps.add(list[member]);
      start = index;
    }
  }
  return catchUps;
}

export interface ProfileViewingScope {
  /** Visionnages réels : depuis l'inscription, hors rattrapages et journées d'import. */
  viewings: ProfileViewing[];
  imports: ProfileImportDay[];
  catchUp: { count: number; minutes: number };
  /** Début du jour où SeenIt a commencé à suivre les visionnages, ou null s'il est inconnu. */
  since: number | null;
  /** `import` : la première journée d'import (chargement de la bibliothèque) est postérieure à la création du compte. */
  sinceSource: 'signup' | 'import' | null;
  beforeSince: number;
}

/**
 * SEENIT-PROFILE-006 : les chiffres par période (mois, semaines, rythme, records, marathons, top de l'année)
 * ne décrivent que ce qui a été regardé avec SeenIt : rien avant le jour de l'inscription, ni les rattrapages
 * marqués d'un coup, ni les journées d'import. Les totaux du Profil, eux, comptent tout.
 */
export function scopeProfileViewings(shows: readonly Show[], since: number | null = null): ProfileViewingScope {
  // Revue Codex #949 : les journées d'import se lisent sur tous les visionnages, avant de retirer les rafales.
  const { viewings: dated, imports } = partitionProfileViewings(collectProfileViewings(shows));
  const catchUps = findProfileCatchUps(dated);
  let minutes = 0;
  for (const viewing of catchUps) minutes += viewing.minutes;
  const signupDay = since !== null && Number.isFinite(since) && since > 0 ? new Date(since).setHours(0, 0, 0, 0) : null;
  // Retour terrain v1.4.293 : un compte peut exister des mois avant le vrai démarrage ; la première journée d'import
  // (bibliothèque chargée) marque ce démarrage, et l'historique Plex daté d'avant n'est pas de la vie SeenIt.
  const firstImport = imports.length > 0 ? new Date(imports[0].watchedAt).setHours(0, 0, 0, 0) : null;
  // Revue Codex #952 : ce n'est un démarrage que si aucun Vu marqué dans l'app ne le précède (seules des lectures
  // Plex datées peuvent exister avant) ; sinon c'est un rattrapage tardif et l'historique d'avant reste compté.
  const usedBefore = firstImport !== null && dated.some(viewing => !viewing.plexTime && viewing.watchedAt < firstImport && (signupDay === null || viewing.watchedAt >= signupDay));
  const importDay = usedBefore ? null : firstImport;
  const sinceSource = importDay !== null && (signupDay === null || importDay > signupDay) ? 'import' : signupDay !== null ? 'signup' : null;
  const sinceDay = sinceSource === 'import' ? importDay : signupDay;
  let beforeSince = 0;
  const viewings = dated.filter(viewing => {
    if (catchUps.has(viewing)) return false;
    if (sinceDay !== null && viewing.watchedAt < sinceDay) { beforeSince++; return false; }
    return true;
  });
  return { viewings, imports, catchUp: { count: catchUps.size, minutes }, since: sinceDay, sinceSource, beforeSince };
}

const sinceDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

/** « Depuis ton arrivée sur SeenIt le 3 juillet 2026 · sans 16 épisodes marqués d'un coup », ou null. */
export function formatProfileScopeNote(scope: Pick<ProfileViewingScope, 'since' | 'sinceSource' | 'beforeSince' | 'catchUp'>, year: number): string | null {
  const parts: string[] = [];
  if (scope.since !== null && scope.beforeSince > 0 && new Date(scope.since).getFullYear() === year) {
    const date = sinceDate.format(new Date(scope.since));
    parts.push(scope.sinceSource === 'import' ? `Depuis ton arrivée sur SeenIt le ${date} (premier import)` : `Depuis ton inscription le ${date}`);
  }
  if (scope.catchUp.count > 0) parts.push(`sans ${scope.catchUp.count.toLocaleString('fr-FR')} ${scope.catchUp.count > 1 ? 'épisodes marqués' : 'épisode marqué'} d’un coup`);
  if (parts.length === 0) return null;
  const text = parts.join(' · ');
  return text[0].toUpperCase() + text.slice(1);
}

const importDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });

/** « Sans l'import du 14 juillet (4 586 h) » pour l'année affichée, sinon null. */
export function formatProfileImportNote(imports: readonly ProfileImportDay[], year: number): string | null {
  const inYear = imports.filter(day => new Date(day.watchedAt).getFullYear() === year);
  if (inYear.length === 0) return null;
  const minutes = inYear.reduce((sum, day) => sum + day.minutes, 0);
  return inYear.length === 1
    ? `Sans l’import du ${importDate.format(new Date(inYear[0].watchedAt))} (${formatProfileHours(minutes)})`
    : `Sans ${inYear.length} journées d’import (${formatProfileHours(minutes)})`;
}

const FIRST_PLAUSIBLE_YEAR = 2000;

/** Années proposées avec leur temps, la plus récente d'abord ; l'année courante est toujours présente. */
export function listProfileYearTotals(viewings: readonly ProfileViewing[], now = Date.now()): { year: number; minutes: number }[] {
  const current = new Date(now).getFullYear();
  const totals = new Map<number, number>([[current, 0]]);
  for (const viewing of viewings) {
    const year = new Date(viewing.watchedAt).getFullYear();
    // Une date avant 2000 ou dans le futur est une horloge fausse, pas une année à proposer.
    if (year < FIRST_PLAUSIBLE_YEAR || year > current) continue;
    totals.set(year, (totals.get(year) || 0) + viewing.minutes);
  }
  return [...totals.entries()].map(([year, minutes]) => ({ year, minutes })).sort((left, right) => right.year - left.year);
}

export function listProfileYears(viewings: readonly ProfileViewing[], now = Date.now()): number[] {
  return listProfileYearTotals(viewings, now).map(entry => entry.year);
}

/** L'année courante si elle a des visionnages, sinon la plus récente qui en a. */
export function defaultProfileYear(viewings: readonly ProfileViewing[], now = Date.now()): number {
  const current = new Date(now).getFullYear();
  let latest: number | null = null;
  for (const viewing of viewings) {
    const year = new Date(viewing.watchedAt).getFullYear();
    if (year === current) return current;
    if (year >= FIRST_PLAUSIBLE_YEAR && year < current && (latest === null || year > latest)) latest = year;
  }
  return latest ?? current;
}

export interface ProfilePunchCard {
  /** Début de chaque tranche de trois heures : 0, 3, … 21. */
  hours: number[];
  /** `plex` : heures réelles de lecture Plex ; `mark` : heure à laquelle les Vu ont été marqués. */
  source: 'plex' | 'mark';
  rows: number[][];
  slot: { day: number; fromHour: number; toHour: number } | null;
}

export interface ProfileYearStats {
  year: number;
  minutes: number;
  episodes: number;
  films: number;
  months: number[];
  monthEpisodes: number[];
  monthFilms: number[];
  seriesMinutes: number;
  filmMinutes: number;
  recordMonth: number | null;
  punch: ProfilePunchCard;
  /** Six plateformes au plus, en part du temps total ; le temps sans plateforme connue est à part. */
  platforms: { name: string; minutes: number; share: number }[];
  unknownPlatformShare: number;
  days: number;
}

const yearViewings = (viewings: readonly ProfileViewing[], year: number) =>
  viewings.filter(viewing => new Date(viewing.watchedAt).getFullYear() === year);

/** Semaine en tranches de trois heures ; le créneau est la case la plus regardée. */
function buildPunchCard(all: readonly ProfileViewing[]): ProfilePunchCard {
  const timed = all.filter(viewing => viewing.timeKnown);
  const plex = timed.filter(viewing => viewing.plexTime);
  const source = plex.length >= PROFILE_PUNCH_PLEX_MIN ? 'plex' : 'mark';
  const viewings = source === 'plex' ? plex : timed;
  const grid = Array.from({ length: 7 }, () => new Array<number>(PUNCH_SLOTS).fill(0));
  for (const viewing of viewings) {
    const date = new Date(viewing.watchedAt);
    grid[(date.getDay() + 6) % 7][Math.floor(date.getHours() / PUNCH_SLOT_HOURS)] += viewing.minutes;
  }
  const hours = Array.from({ length: PUNCH_SLOTS }, (_, index) => index * PUNCH_SLOT_HOURS);
  const max = Math.max(0, ...grid.flat());
  const rows = grid.map(row => row.map(value => max > 0 ? value / max : 0));
  let slot: ProfilePunchCard['slot'] = null;
  if (max > 0) {
    let bestDay = 0, bestSlot = 0;
    grid.forEach((row, day) => row.forEach((value, index) => { if (value > grid[bestDay][bestSlot]) { bestDay = day; bestSlot = index; } }));
    slot = { day: bestDay, fromHour: hours[bestSlot], toHour: (hours[bestSlot] + PUNCH_SLOT_HOURS) % 24 };
  }
  return { hours, source, rows, slot };
}

const hourLabel = (hour: number) => hour === 0 ? 'minuit' : `${hour} h`;

/** « le dimanche, de 21 h à minuit ». */
export function formatProfilePunchSlot(slot: NonNullable<ProfilePunchCard['slot']>): string {
  return `le ${WEEKDAY_NAMES[slot.day]}, de ${hourLabel(slot.fromHour)} à ${hourLabel(slot.toHour)}`;
}

export function buildProfileYearStats(viewings: readonly ProfileViewing[], year: number, now = Date.now()): ProfileYearStats {
  const current = new Date(now);
  const inYear = yearViewings(viewings, year);
  const monthCount = year === current.getFullYear() ? current.getMonth() + 1 : 12;
  const months = new Array<number>(monthCount).fill(0);
  const monthEpisodes = new Array<number>(monthCount).fill(0);
  const monthFilms = new Array<number>(monthCount).fill(0);
  const platformMinutes = new Map<string, number>();
  const dayKeys = new Set<string>();
  let minutes = 0, episodes = 0, films = 0, seriesMinutes = 0, filmMinutes = 0;
  for (const viewing of inYear) {
    minutes += viewing.minutes;
    const month = new Date(viewing.watchedAt).getMonth();
    if (viewing.mediaType === 'tv') { episodes++; seriesMinutes += viewing.minutes; if (month < monthCount) monthEpisodes[month]++; }
    else { films++; filmMinutes += viewing.minutes; if (month < monthCount) monthFilms[month]++; }
    if (month < monthCount) months[month] += viewing.minutes;
    platformMinutes.set(viewing.platform, (platformMinutes.get(viewing.platform) || 0) + viewing.minutes);
    dayKeys.add(historyLocalDayKey(viewing.watchedAt));
  }

  const recordValue = Math.max(0, ...months);
  const share = (value: number) => minutes > 0 ? Math.round(value / minutes * 100) : 0;
  const platforms = [...platformMinutes.entries()]
    .filter(([name]) => name !== PROFILE_UNKNOWN_PLATFORM)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, PROFILE_PLATFORM_LIMIT)
    .map(([name, value]) => ({ name, minutes: value, share: share(value) }));

  return {
    year,
    minutes,
    episodes,
    films,
    months,
    monthEpisodes,
    monthFilms,
    seriesMinutes,
    filmMinutes,
    recordMonth: recordValue > 0 ? months.indexOf(recordValue) : null,
    punch: buildPunchCard(inYear),
    platforms,
    unknownPlatformShare: share(platformMinutes.get(PROFILE_UNKNOWN_PLATFORM) || 0),
    days: dayKeys.size,
  };
}

export interface ProfileProjection {
  title: string;
  finishDate: string;
  remaining: number;
  perWeek: number;
}

const projectionDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });
const projectionDateYear = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

/** « Tu finis X le… » : la série en cours la plus regardée ces quatre dernières semaines. */
export function buildProfileProjection(shows: readonly Show[], viewings: readonly ProfileViewing[], now = Date.now()): ProfileProjection | null {
  const since = now - PROJECTION_WINDOW_DAYS * DAY_MS;
  const recent = new Map<string, number>();
  for (const viewing of viewings) {
    if (viewing.mediaType !== 'tv' || !viewing.timeKnown || viewing.watchedAt < since || viewing.watchedAt > now) continue;
    recent.set(viewing.showId, (recent.get(viewing.showId) || 0) + 1);
  }

  let best: ProfileProjection | null = null;
  let bestCount = 0;
  for (const show of shows) {
    const count = recent.get(show.id) || 0;
    if (count < 2 || show.mediaType !== 'tv' || show.status === 'dropped' || show.isArchived) continue;
    const seen = (show.seenEpisodes || []).filter(episode => episode !== 'movie').length;
    const remaining = (Number(show.totalAiredEpisodes) || Number(show.totalEpisodes) || 0) - seen;
    if (remaining <= 0 || count <= bestCount) continue;
    const perWeek = count / (PROJECTION_WINDOW_DAYS / 7);
    const finish = new Date(now + Math.ceil(remaining / perWeek * 7) * DAY_MS);
    bestCount = count;
    best = {
      title: show.title,
      finishDate: (finish.getFullYear() === new Date(now).getFullYear() ? projectionDate : projectionDateYear).format(finish),
      remaining,
      perWeek: Math.round(perWeek * 10) / 10,
    };
  }
  return best;
}
