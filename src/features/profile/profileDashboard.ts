import type { Show } from '../../types.ts';
import { historyEpisodeEntries } from '../history/historyRecords.ts';
import { historyLocalDayKey } from '../history/historyPresentation.ts';
import { formatProfileHours, type ProfileViewing } from './profileYearStats.ts';

/** Sections de « Mes chiffres » (SEENIT-PROFILE-003) : uniquement des fonctions pures, testées une à une. */
const DAY_MS = 86_400_000;
const WINDOW_DAYS = 28;
const MIN_WINDOW_VIEWINGS = 10;
const TREND_WEEKS = 12;
const SHARE_RECENT_DAYS = 60;
const SHARE_BEFORE_DAYS = 120;

const localDayStart = (time: number) => { const date = new Date(time); return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime(); };
const dayOrdinal = (key: string) => { const [year, month, day] = key.split('-').map(Number); return Date.UTC(year, month - 1, day) / DAY_MS; };
const sum = (values: readonly ProfileViewing[]) => values.reduce((total, viewing) => total + viewing.minutes, 0);
const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const between = (viewings: readonly ProfileViewing[], from: number, to: number) => viewings.filter(viewing => viewing.watchedAt >= from && viewing.watchedAt < to);

export interface ProfileRhythm { perWeekMinutes: number; recentMinutes: number; previousMinutes: number; change: number | null }

/** Heures par semaine sur 28 jours, et variation contre les 28 jours précédents quand les deux fenêtres comptent. */
export function buildProfileRhythm(viewings: readonly ProfileViewing[], now: number): ProfileRhythm {
  const end = localDayStart(now) + DAY_MS, middle = end - WINDOW_DAYS * DAY_MS, start = middle - WINDOW_DAYS * DAY_MS;
  const recent = between(viewings, middle, end), previous = between(viewings, start, middle);
  const recentMinutes = sum(recent), previousMinutes = sum(previous);
  const comparable = recent.length >= MIN_WINDOW_VIEWINGS && previous.length >= MIN_WINDOW_VIEWINGS && previousMinutes > 0;
  return { perWeekMinutes: recentMinutes / (WINDOW_DAYS / 7), recentMinutes, previousMinutes, change: comparable ? Math.round((recentMinutes - previousMinutes) / previousMinutes * 100) : null };
}

export interface ProfileTypicalDay { minutes: number; titles: number; days: number }

/** Journée type : durée et nombre de titres médians d'un jour avec visionnage. */
export function buildTypicalDay(viewings: readonly ProfileViewing[]): ProfileTypicalDay | null {
  const days = new Map<string, { minutes: number; titles: Set<string> }>();
  for (const viewing of viewings) {
    const key = historyLocalDayKey(viewing.watchedAt);
    const day = days.get(key) || { minutes: 0, titles: new Set<string>() };
    day.minutes += viewing.minutes; day.titles.add(viewing.showId); days.set(key, day);
  }
  if (!days.size) return null;
  const list = [...days.values()];
  return { minutes: Math.round(median(list.map(day => day.minutes))), titles: Math.round(median(list.map(day => day.titles.size))), days: list.length };
}

export interface ProfileStreaks { current: number; record: number; recordEnd: number | null }

/** Jours d'affilée : la suite en cours (aujourd'hui ou hier) et la plus longue. */
export function buildProfileStreaks(viewings: readonly ProfileViewing[], now: number): ProfileStreaks {
  const ordinals = [...new Set(viewings.map(viewing => dayOrdinal(historyLocalDayKey(viewing.watchedAt))))].sort((a, b) => a - b);
  let record = 0, recordEnd: number | null = null, run = 0;
  ordinals.forEach((ordinal, index) => {
    run = index > 0 && ordinal === ordinals[index - 1] + 1 ? run + 1 : 1;
    if (run > record) { record = run; recordEnd = ordinal; }
  });
  const today = dayOrdinal(historyLocalDayKey(now));
  const set = new Set(ordinals);
  let cursor = set.has(today) ? today : today - 1, current = 0;
  while (set.has(cursor)) { current++; cursor--; }
  return { current, record, recordEnd: recordEnd === null ? null : recordEnd * DAY_MS };
}

/** Douze semaines glissantes se terminant aujourd'hui, en minutes, la plus ancienne d'abord. */
export function buildWeeklyTrend(viewings: readonly ProfileViewing[], now: number): { start: number; minutes: number }[] {
  const end = localDayStart(now) + DAY_MS;
  return Array.from({ length: TREND_WEEKS }, (_, index) => {
    const from = end - (TREND_WEEKS - index) * 7 * DAY_MS;
    return { start: from, minutes: sum(between(viewings, from, from + 7 * DAY_MS)) };
  });
}

export interface ProfileInsight { id: 'rhythm' | 'films' | 'genre'; title: string; detail: string; value: string }

const filmShare = (viewings: readonly ProfileViewing[]) => { const total = sum(viewings); return total > 0 ? sum(viewings.filter(viewing => viewing.mediaType === 'movie')) / total * 100 : 0; };

function genreShares(viewings: readonly ProfileViewing[], genreOf: (showId: string) => string | null) {
  const shares = new Map<string, number>();
  const total = sum(viewings);
  for (const viewing of viewings) { const genre = genreOf(viewing.showId); if (genre) shares.set(genre, (shares.get(genre) || 0) + viewing.minutes); }
  return { total, share: (genre: string) => total > 0 ? (shares.get(genre) || 0) / total * 100 : 0, genres: [...shares.keys()] };
}

const signed = (value: number, unit: string) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value)} ${unit}`;

/** Au plus trois constats, chacun seulement si l'écart est net et que chaque fenêtre compte au moins dix visionnages. */
export function buildProfileInsights(viewings: readonly ProfileViewing[], now: number, genreOf: (showId: string) => string | null): ProfileInsight[] {
  const insights: ProfileInsight[] = [];
  const rhythm = buildProfileRhythm(viewings, now);
  if (rhythm.change !== null && Math.abs(rhythm.change) >= 10) insights.push({
    id: 'rhythm', title: rhythm.change > 0 ? 'Tu repars à la hausse' : 'Ton rythme ralentit',
    detail: `${formatProfileHours(rhythm.recentMinutes)} ces 28 jours, ${formatProfileHours(rhythm.previousMinutes)} les 28 précédents`, value: signed(rhythm.change, '%'),
  });
  const end = localDayStart(now) + DAY_MS, middle = end - SHARE_RECENT_DAYS * DAY_MS;
  const recent = between(viewings, middle, end), before = between(viewings, middle - SHARE_BEFORE_DAYS * DAY_MS, middle);
  if (recent.length >= MIN_WINDOW_VIEWINGS && before.length >= MIN_WINDOW_VIEWINGS) {
    const now60 = Math.round(filmShare(recent)), then = Math.round(filmShare(before)), delta = now60 - then;
    if (Math.abs(delta) >= 10) insights.push({
      id: 'films', title: delta > 0 ? 'Le cinéma prend le dessus' : 'Les séries reprennent la main',
      detail: `${now60} % de films ces deux derniers mois, ${then} % avant`, value: signed(delta, 'pts'),
    });
    const recentGenres = genreShares(recent, genreOf), beforeGenres = genreShares(before, genreOf);
    const rising = recentGenres.genres
      .map(genre => ({ genre, now: Math.round(recentGenres.share(genre)), then: Math.round(beforeGenres.share(genre)) }))
      .filter(entry => entry.now - entry.then >= 10)
      .sort((a, b) => (b.now - b.then) - (a.now - a.then) || a.genre.localeCompare(b.genre))[0];
    if (rising) insights.push({ id: 'genre', title: `${rising.genre} monte`, detail: `${rising.now} % de ton temps ces deux derniers mois, ${rising.then} % avant`, value: signed(rising.now - rising.then, 'pts') });
  }
  return insights;
}

export interface ProfileGenreShare { name: string; share: number; trend: 'up' | 'down' | 'flat' | null }

/** Quatre genres en part du temps de l'année ; la flèche compare les 90 derniers jours au reste de l'année. */
export function buildGenreShares(yearViewings: readonly ProfileViewing[], now: number, genreOf: (showId: string) => string | null): ProfileGenreShare[] {
  const all = genreShares(yearViewings, genreOf);
  const cut = localDayStart(now) + DAY_MS - 90 * DAY_MS;
  const recent = genreShares(yearViewings.filter(viewing => viewing.watchedAt >= cut), genreOf);
  const before = genreShares(yearViewings.filter(viewing => viewing.watchedAt < cut), genreOf);
  const comparable = recent.total > 0 && before.total > 0;
  return all.genres
    .map(name => ({ name, share: Math.round(all.share(name)) }))
    .filter(entry => entry.share > 0)
    .sort((a, b) => b.share - a.share || a.name.localeCompare(b.name))
    .slice(0, 4)
    .map(entry => {
      if (!comparable) return { ...entry, trend: null };
      const delta = recent.share(entry.name) - before.share(entry.name);
      return { ...entry, trend: delta >= 3 ? 'up' : delta <= -3 ? 'down' : 'flat' };
    });
}

export const PROFILE_REACTIONS = [['adore', 'J’adore'], ['bien', 'Bien'], ['bof', 'Bof']] as const;
export type ProfileReaction = typeof PROFILE_REACTIONS[number][0];
export const PROFILE_REACTIONS_MIN = 10;

export interface ProfileReactions { total: number; counts: Record<ProfileReaction, number>; loved: { show: Show; count: number }[] }

/** Réactions des épisodes vus ; absentes sous dix épisodes notés. */
export function buildProfileReactions(shows: readonly Show[]): ProfileReactions | null {
  const counts: Record<ProfileReaction, number> = { adore: 0, bien: 0, bof: 0 };
  const loved: { show: Show; count: number }[] = [];
  for (const show of shows) {
    if (show.mediaType !== 'tv') continue;
    let showLoved = 0;
    for (const { record } of historyEpisodeEntries(show)) {
      const emotion = record?.emotion;
      if (emotion === 'adore' || emotion === 'bien' || emotion === 'bof') { counts[emotion]++; if (emotion === 'adore') showLoved++; }
    }
    if (showLoved > 0) loved.push({ show, count: showLoved });
  }
  const total = counts.adore + counts.bien + counts.bof;
  if (total < PROFILE_REACTIONS_MIN) return null;
  return { total, counts, loved: loved.sort((a, b) => b.count - a.count || a.show.title.localeCompare(b.show.title)).slice(0, 3) };
}

export interface ProfileLeadCast { id: number; name: string; profile_path: string | null }
export interface ProfileLeadActor extends ProfileLeadCast { minutes: number; titles: number; favorites: number }
export const PROFILE_LEAD_BILLING = 3;

/** Têtes d'affiche : acteurs des trois premiers rôles des titres vus, classés par temps de visionnage cumulé. */
export function buildLeadActors(viewings: readonly ProfileViewing[], shows: readonly Show[], leadsOf: (show: Show) => readonly ProfileLeadCast[] | null): ProfileLeadActor[] {
  const minutesByShow = new Map<string, number>();
  for (const viewing of viewings) minutesByShow.set(viewing.showId, (minutesByShow.get(viewing.showId) || 0) + viewing.minutes);
  const people = new Map<number, ProfileLeadActor>();
  for (const show of shows) {
    const minutes = minutesByShow.get(show.id);
    if (!minutes) continue;
    for (const lead of (leadsOf(show) || []).slice(0, PROFILE_LEAD_BILLING)) {
      if (!lead?.id || !lead.name) continue;
      const person = people.get(lead.id) || { ...lead, minutes: 0, titles: 0, favorites: 0 };
      person.minutes += minutes; person.titles++; if (show.isFavorite) person.favorites++;
      people.set(lead.id, person);
    }
  }
  const ranked = [...people.values()].sort((a, b) => b.minutes - a.minutes || b.titles - a.titles || a.name.localeCompare(b.name));
  return ranked.length >= 3 ? ranked.slice(0, 3) : [];
}

/** Trois premiers du générique, dans l'ordre TMDB ; pour une série, le cumul d'épisodes départage. */
export function leadCastFromDetails(details: unknown, mediaType: 'tv' | 'movie'): ProfileLeadCast[] | null {
  const value = details && typeof details === 'object' ? details as { credits?: { cast?: unknown[] }; aggregate_credits?: { cast?: unknown[] } } : null;
  const raw = (mediaType === 'tv' && value?.aggregate_credits?.cast?.length ? value.aggregate_credits.cast : value?.credits?.cast) || null;
  if (!Array.isArray(raw)) return null;
  const cast = raw.filter((item): item is { id: number; name: string; profile_path?: string | null; order?: number; total_episode_count?: number } => Boolean(item && typeof item === 'object' && Number((item as { id?: unknown }).id) > 0 && typeof (item as { name?: unknown }).name === 'string'));
  const ordered = mediaType === 'tv' && value?.aggregate_credits?.cast?.length
    ? [...cast].sort((a, b) => (b.total_episode_count || 0) - (a.total_episode_count || 0) || (a.order ?? 99) - (b.order ?? 99))
    : [...cast].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  return ordered.slice(0, PROFILE_LEAD_BILLING).map(item => ({ id: Number(item.id), name: item.name, profile_path: item.profile_path || null }));
}

export type ProfileBadgeId = 'centenaire' | 'night_owl' | 'big_screen' | 'binge_master';
export const PROFILE_BADGE_TIERS: Record<ProfileBadgeId, { title: string; unit: [string, string]; tiers: number[] }> = {
  centenaire: { title: 'Centenaire', unit: ['vu', 'vus'], tiers: [100, 500, 1_000, 2_500, 5_000, 7_500, 10_000] },
  night_owl: { title: 'Oiseau de nuit', unit: ['nuit', 'nuits'], tiers: [10, 25, 50, 100] },
  big_screen: { title: 'Grand écran', unit: ['film', 'films'], tiers: [1, 25, 75, 150, 300] },
  binge_master: { title: 'Binge-Master', unit: ['série finie', 'séries finies'], tiers: [1, 5, 15, 30] },
};

export interface ProfileTieredBadge { id: ProfileBadgeId; title: string; level: number; value: number; next: number | null; progress: number; detail: string }

/** Nuits distinctes avec un visionnage daté à la minute entre 23 h et 5 h (une nuit commence la veille). */
export function countNightViewings(viewings: readonly ProfileViewing[]): number {
  const nights = new Set<string>();
  for (const viewing of viewings) {
    if (!viewing.timeKnown) continue;
    const hour = new Date(viewing.watchedAt).getHours();
    if (hour >= 23 || hour < 5) nights.add(historyLocalDayKey(viewing.watchedAt - (hour < 5 ? DAY_MS : 0)));
  }
  return nights.size;
}

/** Badges à niveaux : l'anneau mesure la progression vers le palier suivant. */
export function buildTieredBadges(values: Record<ProfileBadgeId, number>): ProfileTieredBadge[] {
  return (Object.keys(PROFILE_BADGE_TIERS) as ProfileBadgeId[]).map(id => {
    const { title, unit, tiers } = PROFILE_BADGE_TIERS[id];
    const value = Math.max(0, Math.floor(values[id] || 0));
    const level = tiers.filter(tier => value >= tier).length;
    const next = tiers[level] ?? null;
    const floor = level > 0 ? tiers[level - 1] : 0;
    const progress = next === null ? 1 : Math.min(0.99, Math.max(0, (value - floor) / (next - floor)));
    const label = (count: number) => `${count.toLocaleString('fr-FR')} ${count > 1 ? unit[1] : unit[0]}`;
    const detail = next === null ? `${label(value)} · palier maximal` : `${value.toLocaleString('fr-FR')} sur ${label(next)}`;
    return { id, title, level, value, next, progress, detail };
  });
}
