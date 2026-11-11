import type { Show } from '../../types.ts';
import { historyLocalDayKey } from '../history/historyPresentation.ts';
import { PROFILE_MONTH_LABELS, type ProfileViewing } from './profileYearStats.ts';

/** « Mon année » (SEENIT-PROFILE-004) : calendrier, records, année en séries, films ou séries, top. */
const DAY_MS = 86_400_000;
const MARATHON_EPISODES = 6;
const COMEBACK_DAYS = 30;
const SHARE_SWING_POINTS = 10;

const dayOrdinal = (key: string) => { const [year, month, day] = key.split('-').map(Number); return Date.UTC(year, month - 1, day) / DAY_MS; };
const ordinalDate = (ordinal: number) => { const date = new Date(ordinal * DAY_MS); return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()); };
const plural = (count: number, singular: string, pluralForm = `${singular}s`) => `${count.toLocaleString('fr-FR')} ${count > 1 ? pluralForm : singular}`;
const inYear = (viewings: readonly ProfileViewing[], year: number) => viewings.filter(viewing => new Date(viewing.watchedAt).getFullYear() === year);

interface DayBucket { key: string; ordinal: number; minutes: number; films: number; episodes: number; shows: Map<string, { title: string; episodes: number }> }

function dayBuckets(viewings: readonly ProfileViewing[]): DayBucket[] {
  const days = new Map<string, DayBucket>();
  for (const viewing of viewings) {
    const key = historyLocalDayKey(viewing.watchedAt);
    const day = days.get(key) || { key, ordinal: dayOrdinal(key), minutes: 0, films: 0, episodes: 0, shows: new Map() };
    day.minutes += viewing.minutes;
    if (viewing.mediaType === 'movie') day.films++;
    else { day.episodes++; const entry = day.shows.get(viewing.showId) || { title: viewing.title, episodes: 0 }; entry.episodes++; day.shows.set(viewing.showId, entry); }
    days.set(key, day);
  }
  return [...days.values()].sort((a, b) => a.ordinal - b.ordinal);
}

export interface ProfileCalendarMonth { month: number; offset: number; days: { day: number; level: 0 | 1 | 2 | 3 | 4; future: boolean }[] }

/** Douze mois, une case par jour : 1 jusqu'à 45 min, 2 jusqu'à 2 h, 3 au-delà, 4 pour la journée record. */
export function buildProfileCalendar(viewings: readonly ProfileViewing[], year: number, now: number): { months: ProfileCalendarMonth[]; record: { date: Date; minutes: number; films: number; episodes: number } | null } {
  const days = dayBuckets(inYear(viewings, year));
  const byKey = new Map(days.map(day => [day.key, day]));
  const best = days.reduce<DayBucket | null>((current, day) => !current || day.minutes > current.minutes ? day : current, null);
  const today = historyLocalDayKey(now);
  const months = Array.from({ length: 12 }, (_, month) => {
    const offset = (new Date(year, month, 1).getDay() + 6) % 7;
    const count = new Date(year, month + 1, 0).getDate();
    return { month, offset, days: Array.from({ length: count }, (_, index) => {
      const key = historyLocalDayKey(new Date(year, month, index + 1, 12).getTime());
      const minutes = byKey.get(key)?.minutes || 0;
      const level = best && key === best.key ? 4 : minutes <= 0 ? 0 : minutes <= 45 ? 1 : minutes <= 120 ? 2 : 3;
      return { day: index + 1, level: level as 0 | 1 | 2 | 3 | 4, future: key > today };
    }) };
  });
  return { months, record: best ? { date: ordinalDate(best.ordinal), minutes: best.minutes, films: best.films, episodes: best.episodes } : null };
}

export interface ProfileYearRecords {
  month: { month: number; minutes: number; films: number; episodes: number } | null;
  streak: { length: number; from: Date; to: Date } | null;
  marathon: { title: string; episodes: number; date: Date } | null;
  pause: { days: number; from: Date; to: Date } | null;
}

export function buildProfileYearRecords(viewings: readonly ProfileViewing[], year: number): ProfileYearRecords {
  const list = inYear(viewings, year);
  const months = new Map<number, { minutes: number; films: number; episodes: number }>();
  for (const viewing of list) {
    const month = new Date(viewing.watchedAt).getMonth();
    const entry = months.get(month) || { minutes: 0, films: 0, episodes: 0 };
    entry.minutes += viewing.minutes; if (viewing.mediaType === 'movie') entry.films++; else entry.episodes++;
    months.set(month, entry);
  }
  const bestMonth = [...months.entries()].sort((a, b) => b[1].minutes - a[1].minutes || a[0] - b[0])[0];
  const days = dayBuckets(list);
  let streak: ProfileYearRecords['streak'] = null, runStart = 0;
  let pause: ProfileYearRecords['pause'] = null;
  days.forEach((day, index) => {
    if (index > 0 && day.ordinal !== days[index - 1].ordinal + 1) {
      runStart = index;
      const gap = day.ordinal - days[index - 1].ordinal - 1;
      if (!pause || gap > pause.days) pause = { days: gap, from: ordinalDate(days[index - 1].ordinal + 1), to: ordinalDate(day.ordinal - 1) };
    }
    const length = index - runStart + 1;
    if (length >= 2 && (!streak || length > streak.length)) streak = { length, from: ordinalDate(days[runStart].ordinal), to: ordinalDate(day.ordinal) };
  });
  let marathon: ProfileYearRecords['marathon'] = null;
  for (const day of days) for (const entry of day.shows.values()) {
    if (entry.episodes >= 2 && (!marathon || entry.episodes > marathon.episodes)) marathon = { title: entry.title, episodes: entry.episodes, date: ordinalDate(day.ordinal) };
  }
  return { month: bestMonth ? { month: bestMonth[0], ...bestMonth[1] } : null, streak, marathon, pause };
}

export interface ProfileSeriesMonth { month: number; showId: string; title: string; posterPath: string | null; episodes: number; minutes: number; share: number; tag: { label: string; strong: boolean } | null }

/** Chaque mois, la série la plus regardée en temps, avec une étiquette tirée des données ; jamais de film. */
export function buildYearInSeries(viewings: readonly ProfileViewing[], shows: readonly Show[], year: number, now: number): ProfileSeriesMonth[] {
  const series = inYear(viewings, year).filter(viewing => viewing.mediaType === 'tv');
  const months = new Map<number, Map<string, { title: string; posterPath: string | null; minutes: number; episodes: number }>>();
  for (const viewing of series) {
    const month = new Date(viewing.watchedAt).getMonth();
    const bucket = months.get(month) || new Map();
    const entry = bucket.get(viewing.showId) || { title: viewing.title, posterPath: viewing.posterPath, minutes: 0, episodes: 0 };
    entry.minutes += viewing.minutes; entry.episodes++; bucket.set(viewing.showId, entry); months.set(month, bucket);
  }
  const allByShow = new Map<string, number[]>();
  for (const viewing of viewings) if (viewing.mediaType === 'tv') (allByShow.get(viewing.showId) || allByShow.set(viewing.showId, []).get(viewing.showId)!).push(viewing.watchedAt);
  const showsById = new Map(shows.map(show => [show.id, show]));
  const current = new Date(now);
  const tops = [...months.entries()].map(([month, bucket]) => {
    const [showId, top] = [...bucket.entries()].sort((a, b) => b[1].minutes - a[1].minutes || a[1].title.localeCompare(b[1].title))[0];
    return { month, showId, ...top };
  });
  const best = Math.max(1, ...tops.map(top => top.minutes));
  return tops.sort((a, b) => b.month - a.month).map(top => {
    const times = (allByShow.get(top.showId) || []).sort((a, b) => a - b);
    const monthStart = new Date(year, top.month, 1).getTime(), monthEnd = new Date(year, top.month + 1, 1).getTime();
    const inMonth = times.filter(time => time >= monthStart && time < monthEnd);
    const perDay = new Map<string, number>();
    inMonth.forEach(time => perDay.set(historyLocalDayKey(time), (perDay.get(historyLocalDayKey(time)) || 0) + 1));
    const maxDay = Math.max(0, ...perDay.values());
    const before = times.filter(time => time < monthStart).pop();
    const gap = before !== undefined && inMonth.length ? Math.floor((inMonth[0] - before) / DAY_MS) : 0;
    const show = showsById.get(top.showId);
    const finishedHere = show?.status === 'completed' && times.length > 0 && times[times.length - 1] >= monthStart && times[times.length - 1] < monthEnd;
    const tag = maxDay >= MARATHON_EPISODES ? { label: `Marathon · ${maxDay} épisodes en un jour`, strong: true }
      : finishedHere ? { label: 'Série terminée', strong: true }
      : gap >= COMEBACK_DAYS ? { label: `La reprise après ${gap} jours de pause`, strong: false }
      : year === current.getFullYear() && top.month === current.getMonth() ? { label: 'En cours', strong: false } : null;
    return { month: top.month, showId: top.showId, title: top.title, posterPath: top.posterPath, episodes: top.episodes, minutes: top.minutes, share: top.minutes / best, tag };
  });
}

export interface ProfileMediaMonths { series: number[]; films: number[]; insight: string | null }

/** Temps des séries et des films par mois, et un constat si la part des films bascule de dix points. */
export function buildMediaMonths(viewings: readonly ProfileViewing[], year: number, now: number): ProfileMediaMonths {
  const current = new Date(now);
  const count = year === current.getFullYear() ? current.getMonth() + 1 : 12;
  const series = new Array<number>(count).fill(0), films = new Array<number>(count).fill(0);
  for (const viewing of inYear(viewings, year)) {
    const month = new Date(viewing.watchedAt).getMonth();
    if (month < count) (viewing.mediaType === 'movie' ? films : series)[month] += viewing.minutes;
  }
  let insight: string | null = null;
  if (count >= 6) {
    const split = count - 3;
    const share = (from: number, to: number) => { const f = films.slice(from, to).reduce((a, b) => a + b, 0), t = f + series.slice(from, to).reduce((a, b) => a + b, 0); return t > 0 ? Math.round(f / t * 100) : null; };
    const recent = share(split, count), before = share(0, split);
    if (recent !== null && before !== null && Math.abs(recent - before) >= SHARE_SWING_POINTS) {
      insight = `Depuis ${PROFILE_MONTH_LABELS[split].toLowerCase()}, ${recent} % de ton temps va aux films, contre ${before} % avant.`;
    }
  }
  return { series, films, insight };
}

/** Cinq séries au temps passé dans l'année. */
export function buildTopSeries(viewings: readonly ProfileViewing[], year: number): { showId: string; title: string; minutes: number; episodes: number }[] {
  const totals = new Map<string, { showId: string; title: string; minutes: number; episodes: number }>();
  for (const viewing of inYear(viewings, year)) {
    if (viewing.mediaType !== 'tv') continue;
    const entry = totals.get(viewing.showId) || { showId: viewing.showId, title: viewing.title, minutes: 0, episodes: 0 };
    entry.minutes += viewing.minutes; entry.episodes++; totals.set(viewing.showId, entry);
  }
  return [...totals.values()].sort((a, b) => b.minutes - a.minutes || a.title.localeCompare(b.title)).slice(0, 5);
}

/** « L'année X, puis Y » d'après les deux séries les plus regardées ; neutre sans série. */
export function buildYearHeadline(viewings: readonly ProfileViewing[], year: number): { lead: string | null; second: string | null; summary: string } {
  const list = inYear(viewings, year);
  const top = buildTopSeries(viewings, year);
  const minutes = list.reduce((total, viewing) => total + viewing.minutes, 0);
  const episodes = list.filter(viewing => viewing.mediaType === 'tv').length, films = list.length - episodes;
  const days = new Set(list.map(viewing => historyLocalDayKey(viewing.watchedAt))).size;
  const summary = [`${Math.round(minutes / 60).toLocaleString('fr-FR')} h`, plural(episodes, 'épisode'), plural(films, 'film'), plural(days, 'journée')].join(' · ');
  return { lead: top[0]?.title ?? null, second: top[1]?.title ?? null, summary };
}
