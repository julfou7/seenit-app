import type { Show } from '../../types.ts';
import { historyEpisodeEntries } from '../history/historyRecords.ts';
import { historyLocalDayKey, resolveHistoryTimestamp } from '../history/historyPresentation.ts';
import { getProfilePlatformName, type AnalyticsData } from './profileAnalyticsSnapshot.ts';

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
const PUNCH_WINDOW_HOURS = 8;
const DEFAULT_PUNCH_START = 18;

export interface ProfileViewing {
  showId: string;
  title: string;
  posterPath: string | null;
  mediaType: 'tv' | 'movie';
  season: number;
  platform: string;
  watchedAt: number;
  timeKnown: boolean;
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
  startHour: number;
  hours: number[];
  rows: number[][];
  slot: { day: number; fromHour: number; toHour: number } | null;
}

export interface ProfileYearStats {
  year: number;
  minutes: number;
  episodes: number;
  films: number;
  months: number[];
  recordMonth: number | null;
  punch: ProfilePunchCard;
  platforms: { name: string; minutes: number; share: number }[];
}

const yearViewings = (viewings: readonly ProfileViewing[], year: number) =>
  viewings.filter(viewing => new Date(viewing.watchedAt).getFullYear() === year);

/** Fenêtre de huit heures consécutives la plus regardée ; 18 h – 2 h par défaut. */
function buildPunchCard(viewings: readonly ProfileViewing[]): ProfilePunchCard {
  const grid = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const byHour = new Array<number>(24).fill(0);
  for (const viewing of viewings) {
    if (!viewing.timeKnown) continue;
    const date = new Date(viewing.watchedAt);
    const day = (date.getDay() + 6) % 7;
    grid[day][date.getHours()] += viewing.minutes;
    byHour[date.getHours()] += viewing.minutes;
  }

  // Parcours depuis 18 h : à égalité, la fenêtre de soirée de la maquette l'emporte.
  let startHour = DEFAULT_PUNCH_START;
  let best = 0;
  for (let step = 0; step < 24; step++) {
    const start = (DEFAULT_PUNCH_START + step) % 24;
    let sum = 0;
    for (let offset = 0; offset < PUNCH_WINDOW_HOURS; offset++) sum += byHour[(start + offset) % 24];
    if (sum > best) { best = sum; startHour = start; }
  }
  const hours = Array.from({ length: PUNCH_WINDOW_HOURS }, (_, offset) => (startHour + offset) % 24);
  const max = Math.max(0, ...grid.flatMap(row => hours.map(hour => row[hour])));
  const rows = grid.map(row => hours.map(hour => max > 0 ? row[hour] / max : 0));

  let slot: ProfilePunchCard['slot'] = null;
  if (max > 0) {
    let bestDay = 0, bestIndex = 0;
    grid.forEach((row, day) => hours.forEach((hour, index) => {
      if (row[hour] > grid[bestDay][hours[bestIndex]]) { bestDay = day; bestIndex = index; }
    }));
    const value = (index: number) => index >= 0 && index < hours.length ? grid[bestDay][hours[index]] : -1;
    const fromIndex = value(bestIndex - 1) > value(bestIndex + 1) ? bestIndex - 1 : bestIndex;
    slot = { day: bestDay, fromHour: hours[fromIndex], toHour: (hours[fromIndex] + 2) % 24 };
  }
  return { startHour, hours, rows, slot };
}

export function formatProfilePunchSlot(slot: NonNullable<ProfilePunchCard['slot']>): string {
  return `${WEEKDAY_NAMES[slot.day]}, ${slot.fromHour} h – ${slot.toHour} h`;
}

export function buildProfileYearStats(viewings: readonly ProfileViewing[], year: number, now = Date.now()): ProfileYearStats {
  const current = new Date(now);
  const inYear = yearViewings(viewings, year);
  const monthCount = year === current.getFullYear() ? current.getMonth() + 1 : 12;
  const months = new Array<number>(monthCount).fill(0);
  const platformMinutes = new Map<string, number>();
  let minutes = 0, episodes = 0, films = 0;
  for (const viewing of inYear) {
    minutes += viewing.minutes;
    if (viewing.mediaType === 'tv') episodes++; else films++;
    const month = new Date(viewing.watchedAt).getMonth();
    if (month < monthCount) months[month] += viewing.minutes;
    platformMinutes.set(viewing.platform, (platformMinutes.get(viewing.platform) || 0) + viewing.minutes);
  }

  const recordValue = Math.max(0, ...months);
  const ranked = [...platformMinutes.entries()]
    .filter(([name]) => name !== 'Autres')
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const others = (platformMinutes.get('Autres') || 0) + ranked.slice(4).reduce((sum, [, value]) => sum + value, 0);
  const platforms = [...ranked.slice(0, 4), ...(others > 0 ? [['Autres', others] as [string, number]] : [])]
    .map(([name, value]) => ({ name, minutes: value, share: minutes > 0 ? Math.round(value / minutes * 100) : 0 }));

  return {
    year,
    minutes,
    episodes,
    films,
    months,
    recordMonth: recordValue > 0 ? months.indexOf(recordValue) : null,
    punch: buildPunchCard(inYear),
    platforms,
  };
}

export interface ProfileStoryMonth {
  month: number;
  title: string;
  posterPath: string | null;
  minutes: number;
  share: number;
  event: string | null;
}

export interface ProfileYearStory {
  year: number;
  headline: string;
  months: ProfileStoryMonth[];
}

const plural = (count: number, singular: string, pluralForm = `${singular}s`) => `${count} ${count > 1 ? pluralForm : singular}`;

/** Le récit mois par mois : la série la plus regardée, ou le cinéma quand il domine. */
export function buildProfileYearStory(viewings: readonly ProfileViewing[], year: number): ProfileYearStory | null {
  const inYear = yearViewings(viewings, year);
  if (inYear.length === 0) return null;

  const showMinutes = new Map<string, { title: string; minutes: number }>();
  const months = new Map<number, { shows: Map<string, { title: string; posterPath: string | null; minutes: number; episodes: number }>; filmMinutes: number; films: number; filmPoster: string | null; minutes: number }>();
  const days = new Set<string>();
  for (const viewing of inYear) {
    const month = new Date(viewing.watchedAt).getMonth();
    days.add(historyLocalDayKey(viewing.watchedAt));
    let bucket = months.get(month);
    if (!bucket) { bucket = { shows: new Map(), filmMinutes: 0, films: 0, filmPoster: null, minutes: 0 }; months.set(month, bucket); }
    bucket.minutes += viewing.minutes;
    if (viewing.mediaType === 'movie') {
      bucket.films++;
      bucket.filmMinutes += viewing.minutes;
      bucket.filmPoster ??= viewing.posterPath;
      continue;
    }
    const entry = bucket.shows.get(viewing.showId) || { title: viewing.title, posterPath: viewing.posterPath, minutes: 0, episodes: 0 };
    entry.minutes += viewing.minutes;
    entry.episodes++;
    bucket.shows.set(viewing.showId, entry);
    const total = showMinutes.get(viewing.showId) || { title: viewing.title, minutes: 0 };
    total.minutes += viewing.minutes;
    showMinutes.set(viewing.showId, total);
  }

  const streak = longestDayStreak([...days]);
  const maxMinutes = Math.max(...[...months.values()].map(bucket => bucket.minutes));
  const storyMonths = [...months.entries()]
    .sort((left, right) => right[0] - left[0])
    .map(([month, bucket]): ProfileStoryMonth => {
      const topShow = [...bucket.shows.values()].sort((left, right) => right.minutes - left.minutes || left.title.localeCompare(right.title))[0];
      const cinema = bucket.films > 0 && (!topShow || bucket.filmMinutes > topShow.minutes);
      return {
        month,
        title: cinema ? `Mois cinéma · ${plural(bucket.films, 'film')}` : `${topShow.title} · ${plural(topShow.episodes, 'épisode')}`,
        posterPath: cinema ? bucket.filmPoster : topShow.posterPath,
        minutes: bucket.minutes,
        share: maxMinutes > 0 ? bucket.minutes / maxMinutes : 0,
        event: streak && streak.month === month ? `Record · ${streak.length} jours d’affilée` : null,
      };
    });

  const topTitles = [...showMinutes.values()]
    .sort((left, right) => right.minutes - left.minutes || left.title.localeCompare(right.title))
    .slice(0, 2)
    .map(entry => entry.title);
  const films = inYear.filter(viewing => viewing.mediaType === 'movie').length;
  const headline = topTitles.length === 2
    ? `L’année ${topTitles[0]}, puis ${topTitles[1]}.`
    : topTitles.length === 1 ? `L’année ${topTitles[0]}.` : `L’année cinéma · ${plural(films, 'film')}.`;

  return { year, headline, months: storyMonths };
}

function longestDayStreak(dayKeys: string[]): { length: number; month: number } | null {
  const ordinals = dayKeys
    .map(key => { const [year, month, day] = key.split('-').map(Number); return Date.UTC(year, month - 1, day) / DAY_MS; })
    .sort((left, right) => left - right);
  let best: { length: number; end: number } | null = null;
  let runStart = 0;
  for (let index = 0; index < ordinals.length; index++) {
    if (index > 0 && ordinals[index] !== ordinals[index - 1] + 1) runStart = index;
    const length = index - runStart + 1;
    if (!best || length > best.length) best = { length, end: ordinals[index] };
  }
  if (!best || best.length < 3) return null;
  return { length: best.length, month: new Date(best.end * DAY_MS).getUTCMonth() };
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

export interface ProfileBadge {
  id: 'centenaire' | 'night_owl' | 'big_screen' | 'binge_master';
  title: string;
  progress: number;
  unlocked: boolean;
  detail: string;
}

/** Les quatre badges historiques, mêmes seuils, avec leur progression. */
export function buildProfileBadges(data: Pick<AnalyticsData, 'totalMinutes' | 'totalEpisodesSeen' | 'totalMoviesSeen' | 'completedTvCount'>): ProfileBadge[] {
  const { totalMinutes, totalEpisodesSeen: episodes, totalMoviesSeen: movies, completedTvCount: completedTv } = data;
  const seen = episodes + movies;
  const badge = (id: ProfileBadge['id'], title: string, progress: number, unlocked: boolean, detail: string): ProfileBadge =>
    ({ id, title, progress: unlocked ? 1 : Math.min(0.99, Math.max(0, progress)), unlocked, detail });
  return [
    badge('centenaire', 'Centenaire', seen / 100, seen >= 100, seen >= 100 ? `${seen.toLocaleString('fr-FR')} vus` : `${seen} / 100 vus`),
    badge('night_owl', 'Oiseau de nuit', Math.max(episodes / 10, totalMinutes / 500), episodes >= 10 || totalMinutes >= 500,
      episodes >= 10 || totalMinutes >= 500 ? `${Math.round(totalMinutes / 60).toLocaleString('fr-FR')} h` : `${episodes} / 10 épisodes`),
    badge('big_screen', 'Grand écran', movies, movies >= 1, movies >= 1 ? plural(movies, 'film') : '0 / 1 film'),
    badge('binge_master', 'Binge-Master', Math.max(completedTv, episodes / 20), completedTv >= 1 || episodes >= 20,
      completedTv >= 1 ? plural(completedTv, 'série finie', 'séries finies') : episodes >= 20 ? `${episodes} épisodes` : `${episodes} / 20 épisodes`),
  ];
}
