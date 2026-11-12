/**
 * SEENIT-UX-019 — Calculs purs des fiches série, film et épisode (prototype du 24/10) : heure de fin
 * « si tu lances maintenant », soirée d'épisodes, moyennes de saison et rang d'un épisode.
 * Aucune donnée inventée : une note absente (0 ou inconnue) est ignorée, une durée inconnue masque le calcul.
 */
export const MINUTES_PER_DAY = 24 * 60;
/** Fenêtre de la barre « Fin à » : 200 min couvrent un long film et laissent voir minuit. */
export const END_BAR_WINDOW_MINUTES = 200;

export function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

export function formatClock(totalMinutes: number): string {
  const minutes = ((Math.round(totalMinutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export interface MovieEndPlan {
  end: string;
  /** Minutes après minuit (> 0) ou 0 si le film finit avant. */
  afterMidnight: number;
  /** Minutes restantes avant minuit à la fin du film (0 si après minuit). */
  beforeMidnight: number;
  barPercent: number;
  /** Position de minuit sur la barre, ou null si minuit est hors fenêtre. */
  midnightPercent: number | null;
}

export function planMovieEnd(nowMinutes: number, runtimeMinutes: unknown): MovieEndPlan | null {
  const runtime = Number(runtimeMinutes);
  if (!Number.isFinite(runtime) || runtime <= 0) return null;
  const finish = nowMinutes + runtime;
  const toMidnight = MINUTES_PER_DAY - nowMinutes;
  return {
    end: formatClock(finish),
    afterMidnight: Math.max(0, finish - MINUTES_PER_DAY),
    beforeMidnight: Math.max(0, MINUTES_PER_DAY - finish),
    barPercent: Math.min(100, (runtime / END_BAR_WINDOW_MINUTES) * 100),
    midnightPercent: toMidnight > 0 && toMidnight <= END_BAR_WINDOW_MINUTES ? (toMidnight / END_BAR_WINDOW_MINUTES) * 100 : null,
  };
}

export interface PlannedEpisode<T> {
  item: T;
  runtime: number;
  endMinutes: number;
  end: string;
}

/** Enchaîne jusqu'à `limit` épisodes ; s'arrête au premier sans durée connue pour ne rien inventer. */
export function planEpisodes<T>(nowMinutes: number, episodes: readonly T[], runtimeOf: (item: T) => unknown, limit = 3): { plan: PlannedEpisode<T>[]; beforeMidnight: number } {
  const plan: PlannedEpisode<T>[] = [];
  let clock = nowMinutes;
  for (const item of episodes.slice(0, limit)) {
    const runtime = Number(runtimeOf(item));
    if (!Number.isFinite(runtime) || runtime <= 0) break;
    clock += runtime;
    plan.push({ item, runtime, endMinutes: clock, end: formatClock(clock) });
  }
  return { plan, beforeMidnight: plan.filter(entry => entry.endMinutes <= MINUTES_PER_DAY).length };
}

export interface SeasonAverage {
  season: number;
  average: number;
}

/** Moyennes TMDB par saison (saisons spéciales et notes absentes exclues, SEENIT-RATING-001). */
export function seasonAverages(seasons: ReadonlyArray<{ season_number?: unknown; vote_average?: unknown }> | null | undefined): SeasonAverage[] {
  return (seasons || [])
    .map(season => ({ season: Number(season.season_number), average: Number(season.vote_average) }))
    .filter(entry => Number.isInteger(entry.season) && entry.season > 0 && Number.isFinite(entry.average) && entry.average > 0)
    .sort((a, b) => a.season - b.season);
}

/** Minimum de votes TMDB pour qu'une note d'épisode compte (retour v1.4.300 : « moyenne 10,0 » sur deux votes). */
export const MIN_EPISODE_RATING_VOTES = 3;

/**
 * SEENIT-UX-019 : notes d'épisode retenues pour la moyenne et les barres. Une note portée par moins de
 * MIN_EPISODE_RATING_VOTES votes vaut « inconnue » (0) ; sans `vote_count` connu, la note est gardée.
 */
export function reliableEpisodeRatings(episodes: ReadonlyArray<{ vote_average?: unknown; vote_count?: unknown }>): number[] {
  return episodes.map(episode => {
    const votes = Number(episode.vote_count);
    if (episode.vote_count !== undefined && episode.vote_count !== null && (!Number.isFinite(votes) || votes < MIN_EPISODE_RATING_VOTES)) return 0;
    const rating = Number(episode.vote_average);
    return Number.isFinite(rating) && rating > 0 ? rating : 0;
  });
}

/**
 * SEENIT-UX-019 (retour v1.4.301) : note TMDB d'un titre. Avec moins de MIN_EPISODE_RATING_VOTES votes, la note n'est
 * pas affichée et la fiche dit « notes insuffisantes » ; sans note du tout, rien n'est affiché.
 */
export function reliableTitleRating(voteAverage: unknown, voteCount: unknown): { value: number | null; insufficient: boolean } {
  const rating = Number(voteAverage);
  if (!Number.isFinite(rating) || rating <= 0) return { value: null, insufficient: false };
  const votes = Number(voteCount);
  if (voteCount !== undefined && voteCount !== null && (!Number.isFinite(votes) || votes < MIN_EPISODE_RATING_VOTES)) return { value: null, insufficient: true };
  return { value: rating, insufficient: false };
}

export function averageRating(values: readonly unknown[]): number | null {
  const ratings = values.map(Number).filter(value => Number.isFinite(value) && value > 0);
  return ratings.length ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length : null;
}

/** Rang (1 = meilleure note) de l'épisode courant parmi les notes connues de sa saison. */
export function episodeRank(ratings: readonly unknown[], current: unknown): { rank: number; total: number } | null {
  const known = ratings.map(Number).filter(value => Number.isFinite(value) && value > 0);
  const value = Number(current);
  if (!known.length || !Number.isFinite(value) || value <= 0) return null;
  return { rank: known.filter(rating => rating > value).length + 1, total: known.length };
}

export function formatRating(value: number): string {
  return value.toFixed(1).replace('.', ',');
}

/** Hauteur relative d'une barre de note dans [minPx, maxPx] selon l'écart de la saison. */
export function ratingBarHeight(value: unknown, ratings: readonly unknown[], minPx = 6, maxPx = 40): number {
  const rating = Number(value);
  const known = ratings.map(Number).filter(entry => Number.isFinite(entry) && entry > 0);
  if (!Number.isFinite(rating) || rating <= 0 || !known.length) return minPx;
  const low = Math.min(...known), high = Math.max(...known);
  if (high - low < 0.05) return Math.round((minPx + maxPx) / 2);
  return Math.round(minPx + ((rating - low) / (high - low)) * (maxPx - minPx));
}

/**
 * #857 — Libellé d'un épisode à venir, toujours relatif : « Aujourd’hui », « Demain », « Dans 5 jours », et
 * au-delà d'une semaine « Dans 12 jours · 16 nov. ». Dates au format TMDB `YYYY-MM-DD`, jour calendaire local.
 */
export function upcomingEpisodeLabel(airDate: string, today: string): string {
  const toUtcDay = (value: string) => {
    const [year, month, day] = value.split('-').map(Number);
    return year && month && day ? Date.UTC(year, month - 1, day) : NaN;
  };
  const target = toUtcDay(airDate), from = toUtcDay(today);
  if (!Number.isFinite(target) || !Number.isFinite(from)) return 'Bientôt';
  const days = Math.round((target - from) / 86_400_000);
  if (days <= 0) return 'Aujourd’hui';
  if (days === 1) return 'Demain';
  if (days <= 7) return `Dans ${days} jours`;
  const date = new Date(target).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `Dans ${days} jours · ${date}`;
}

/**
 * #858 : le bouton Vu attend la vraie mutation (écriture, calcul du prochain épisode) avant son état final ;
 * il n'anime le succès qu'une fois l'action terminée, et pas si elle renvoie explicitement `false`.
 */
export const settleSeenToggle = (result: unknown): Promise<false | undefined> => Promise.resolve(result).then(value => (value === false ? false : undefined));
