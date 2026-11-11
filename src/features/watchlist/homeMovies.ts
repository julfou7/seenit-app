import type { Show } from '../../types';

/** Ordre de la section Films à voir de l'accueil (SEENIT-UX-022). */
export type HomeMovieSort = 'recent' | 'rated' | 'home';

/** Faits d'affichage d'un film à voir, lus dans les détails TMDB déjà en cache. */
export interface HomeMovieFacts {
  rating: number | null;
  genre: string | null;
  releaseDate: string | null;
}

/** État de sortie utilisé par les billets : un film non sorti n'a jamais de bouton Vu. */
export type HomeMovieRelease = { kind: 'released' } | { kind: 'cinema' } | { kind: 'upcoming'; days: number; date: Date };

export const FEATURED_MOVIE_POOL_SIZE = 10;
export const FEATURED_MOVIE_MIN_POOL = 3;

const DAY_MS = 86_400_000;

export function readHomeMovieFacts(show: Show, details: unknown): HomeMovieFacts {
  const value = details && typeof details === 'object' ? details as { vote_average?: unknown; vote_count?: unknown; genres?: unknown; release_date?: unknown } : {};
  const vote = Number(value.vote_average);
  const votes = value.vote_count === undefined ? 1 : Number(value.vote_count);
  const genres = Array.isArray(value.genres) ? value.genres : [];
  const genre = genres.map(item => item && typeof item === 'object' ? (item as { name?: unknown }).name : null).find((name): name is string => typeof name === 'string' && name.trim() !== '') ?? null;
  const local = show as Show & { releaseDate?: unknown };
  const release = [value.release_date, local.releaseDate, show.firstAirDate].find((date): date is string => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(date)) ?? null;
  return {
    rating: Number.isFinite(vote) && vote > 0 && votes > 0 ? Math.round(vote * 10) / 10 : null,
    genre,
    releaseDate: release ? release.slice(0, 10) : null,
  };
}

const localDay = (time: number) => {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};

/** Une date inconnue vaut « sorti » : on ne retire jamais le Vu sans preuve d'une sortie future. */
export function homeMovieRelease(releaseDate: string | null, atCinema: boolean, now: number): HomeMovieRelease {
  if (releaseDate) {
    const [year, month, day] = releaseDate.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    const days = Math.round((date.getTime() - localDay(now)) / DAY_MS);
    if (Number.isFinite(days) && days > 0) return { kind: 'upcoming', days, date };
  }
  return atCinema ? { kind: 'cinema' } : { kind: 'released' };
}

export function formatMovieRating(rating: number): string {
  return rating.toFixed(1).replace('.', ',');
}

export function formatMovieRuntime(minutes: number | null): string | null {
  if (!minutes || !Number.isFinite(minutes) || minutes <= 0) return null;
  const hours = Math.floor(minutes / 60), rest = Math.round(minutes % 60);
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${String(rest).padStart(2, '0')}` : `${hours} h`;
}

export function formatReleaseCountdown(release: Extract<HomeMovieRelease, { kind: 'upcoming' }>): { top: string; value: string; date: string } {
  const date = release.date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  return release.days === 1 ? { top: 'sortie', value: 'demain', date } : { top: 'sortie dans', value: `${release.days} j`, date };
}

/**
 * Récents : ordre d'ajout existant. Mieux notés : note décroissante, film sans note en dernier.
 * Chez moi : uniquement les films disponibles sur une plateforme du compte ou sur son Plex.
 */
export function sortHomeMovies(movies: readonly Show[], sort: HomeMovieSort, facts: (show: Show) => HomeMovieFacts, atHome: (show: Show) => boolean): Show[] {
  if (sort === 'home') return movies.filter(atHome);
  if (sort === 'recent') return [...movies];
  const rank = new Map(movies.map((show, index) => [show.id, index]));
  return [...movies].sort((a, b) => {
    const left = facts(a).rating, right = facts(b).rating;
    if (left === null || right === null) return left === null && right === null ? rank.get(a.id)! - rank.get(b.id)! : left === null ? 1 : -1;
    return right - left || rank.get(a.id)! - rank.get(b.id)!;
  });
}

/** Vivier de « À l'affiche » : films sortis, non vus et notés, les dix mieux notés ; vide sous trois films. */
export function featuredMoviePool(movies: readonly Show[], facts: (show: Show) => HomeMovieFacts, now: number): Show[] {
  const pool = movies
    .filter(show => !show.seenEpisodes?.includes('movie') && show.status !== 'completed')
    .map(show => ({ show, facts: facts(show) }))
    .filter(item => item.facts.rating !== null && homeMovieRelease(item.facts.releaseDate, false, now).kind !== 'upcoming')
    .sort((a, b) => b.facts.rating! - a.facts.rating! || a.show.id.localeCompare(b.show.id))
    .slice(0, FEATURED_MOVIE_POOL_SIZE)
    .map(item => item.show);
  return pool.length >= FEATURED_MOVIE_MIN_POOL ? pool : [];
}

/** Tirage stable pour une graine donnée ; le tirage suivant ne retombe jamais sur le film courant. */
export function pickFeaturedMovie(pool: readonly Show[], seed: number, currentId: string | null = null): Show | null {
  if (!pool.length) return null;
  const kept = currentId ? pool.find(show => show.id === currentId) : undefined;
  if (kept) return kept;
  const index = Math.abs(Math.floor(seed)) % pool.length;
  return pool[index];
}

export function nextFeaturedSeed(pool: readonly Show[], seed: number, currentId: string | null, random = Math.random): number {
  if (pool.length < 2) return seed;
  const current = Math.max(0, pool.findIndex(show => show.id === currentId));
  const step = 1 + Math.floor(random() * (pool.length - 1));
  return (current + step) % pool.length;
}
