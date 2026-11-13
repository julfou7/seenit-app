import { tmdb, discoverSeenIt, discoverSeenItDirect, isMovieAtCinema, type TMDBMedia } from '../shows/tmdb';
import { parseMaxAgeFilter } from '../shows/parentalRating';
import { hasMoreTmdbPages } from './discoverPagination';
import { enrichCinemaEvidenceForExplorerLists } from './cinemaSearchEvidence';
import { discoverTypeForCategory } from './filterPolicy';

/**
 * #853 — Chargement d'une page d'Explorer (hors recherche), extrait de DiscoverScreen pour que la page suivante
 * puisse être préparée à l'avance et réutilisée telle quelle par le défilement infini.
 */
export interface ExplorerHomeQuery {
  activeCategory: string;
  selectedPlatforms: string[];
  selectedGenres: string[];
  pegi: string;
  minRating: string;
  movieReleaseAfterYear: string;
  sortBy: 'popular' | 'rating' | 'date' | 'title';
  sortOrder: 'asc' | 'desc';
  hasActiveFilters: boolean;
}

export interface ExplorerHomePage {
  popular: TMDBMedia[] | null;
  trending: TMDBMedia[] | null;
  persons: TMDBMedia[] | null;
  hasMore: boolean;
  /** Message d'état d'une catégorie (Top C411 : panne, clé refusée, classement vide). */
  notice?: string | null;
  /** Page suivante en échec (Top C411) : la page reste à recharger, le classement n'est pas fini. */
  pageError?: string | null;
}

/** Ajoute à `prev` les éléments de `next` absents (clé type + id), dans l'ordre. */
export function mergeExplorerMedia(prev: TMDBMedia[], next: TMDBMedia[]): TMDBMedia[] {
  const keyOf = (item: TMDBMedia) => `${item.media_type || (item.first_air_date ? 'tv' : 'movie')}_${item.id}`;
  const existingKeys = new Set(prev.map(keyOf));
  return [...prev, ...next.filter(item => !existingKeys.has(keyOf(item)))];
}

const isRecent = (item: TMDBMedia) => {
  const date = item.first_air_date || item.release_date;
  if (!date) return true;
  const year = parseInt(date.split('-')[0], 10);
  return !year || year >= 2016;
};
/** Une personne de la tendance « all » n'a rien à faire dans la grille des titres (ni appel diffuseurs). */
const isTitle = (item: TMDBMedia) => item.media_type !== 'person';

export function explorerHomeQueryKey(query: ExplorerHomeQuery): string {
  return JSON.stringify({
    ...query,
    selectedPlatforms: [...query.selectedPlatforms].sort(),
    selectedGenres: [...query.selectedGenres].sort(),
  });
}

/**
 * Le filtre d'âge a sa propre anticipation (sources et âges de la page suivante, progressiveAgeFilter) et
 * publie des résultats partiels pour la page en cours : la page suivante n'est préchargée ici que sans lui.
 */
export function canPrefetchExplorerHomePage(query: ExplorerHomeQuery): boolean {
  return query.activeCategory !== 'Personnes' && query.activeCategory !== 'Top C411' && parseMaxAgeFilter(query.pegi || 'Tous') === null;
}

export async function loadExplorerHomePage(
  query: ExplorerHomeQuery,
  page: number,
  hooks: { onEarlyTrending?: (trending: TMDBMedia[]) => void; isCurrent?: () => boolean } = {},
): Promise<ExplorerHomePage | null> {
  const { activeCategory, selectedPlatforms, selectedGenres, pegi, minRating, movieReleaseAfterYear, sortBy, sortOrder, hasActiveFilters } = query;
  const isCurrent = hooks.isCurrent || (() => true);
  let popular: TMDBMedia[] | null = null;
  let trending: TMDBMedia[] | null = null;
  let persons: TMDBMedia[] | null = null;
  let hasMore = false;
  // Revue Codex #973 : une page suivante en échec (réseau, ou source Canal+ manquante) propose « Réessayer » au lieu de
  // terminer le défilement ; elle n'est jamais lue comme la fin des résultats.
  let pageFailed = false;

  // SEENIT-C411-004 (#900) : le classement C411 passe avant les filtres TMDB, une page C411 par page d'Explorer.
  if (activeCategory === 'Top C411') {
    const { loadC411TopMedia } = await import('./c411TopMedia');
    const top = await loadC411TopMedia(page, isCurrent);
    if (!isCurrent()) return null;
    // Revue Codex (#917) : une page suivante en échec est signalée (Réessayer), jamais lue comme la fin du classement.
    return { popular: top.media, trending: page === 1 ? top.media.slice(0, 10) : [], persons: null, hasMore: top.hasMore, notice: page === 1 ? top.notice : null, pageError: page > 1 && top.failed ? top.notice : null };
  }
  if (activeCategory === 'Personnes') {
    const personRes = await tmdb.getPopularPersons(page);
    if (!isCurrent()) return null;
    if (personRes?.ok && personRes.value.results) {
      persons = personRes.value.results.map(person => ({ ...person, media_type: 'person' }));
      hasMore = hasMoreTmdbPages(page, personRes);
    }
  } else if (hasActiveFilters || sortBy !== 'popular') {
    // Sans filtre d'âge, la source directe évite la génération progressive (et ses résultats partiels).
    const discover = parseMaxAgeFilter(pegi || 'Tous') === null ? discoverSeenItDirect : discoverSeenIt;
    const discoverRes = await discover({
      type: discoverTypeForCategory(activeCategory),
      category: activeCategory,
      page,
      watchProviders: selectedPlatforms,
      genres: selectedGenres,
      pegi,
      minRating,
      movieReleaseAfterYear,
      sortBy,
      sortOrder,
    });
    if (!isCurrent()) return null;
    pageFailed = !discoverRes?.ok;
    if (discoverRes?.ok && discoverRes.value.results) {
      popular = discoverRes.value.results;
      hasMore = activeCategory === 'Top 100'
        ? page < 5 && hasMoreTmdbPages(page, discoverRes)
        : hasMoreTmdbPages(page, discoverRes);
    }
  } else if (activeCategory === 'Pépites') {
    const topRes = await tmdb.getTopRatedRecent('all', page, selectedPlatforms);
    if (!isCurrent()) return null;
    pageFailed = !topRes?.ok;
    if (topRes?.ok && topRes.value.results) {
      popular = topRes.value.results;
      trending = topRes.value.results.slice(0, 10);
      hasMore = hasMoreTmdbPages(page, topRes);
    }
  } else if (activeCategory === 'Top 100') {
    const [topMovRes, topTvRes] = await Promise.all([tmdb.getTopRated('movie', page), tmdb.getTopRated('tv', page)]);
    if (!isCurrent()) return null;
    const tops = [
      ...(topMovRes?.ok ? topMovRes.value.results.map(item => ({ ...item, media_type: 'movie' as const })) : []),
      ...(topTvRes?.ok ? topTvRes.value.results.map(item => ({ ...item, media_type: 'tv' as const })) : []),
    ];
    tops.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
    popular = tops;
    trending = tops.slice(0, 10);
    hasMore = page < 5 && (hasMoreTmdbPages(page, topMovRes) || hasMoreTmdbPages(page, topTvRes));
  } else if (activeCategory === 'Au cinéma') {
    const cinemaRes = await tmdb.getNowPlaying(page);
    if (!isCurrent()) return null;
    if (cinemaRes?.ok && cinemaRes.value.results) {
      const movies = cinemaRes.value.results.map(item => ({ ...item, media_type: 'movie' as const })).filter(item => isMovieAtCinema(item));
      popular = movies;
      trending = movies.slice(0, 10);
      hasMore = hasMoreTmdbPages(page, cinemaRes);
    }
  } else if (activeCategory === 'Documentaires') {
    const [docMovRes, docTvRes] = await Promise.all([
      tmdb.discoverByGenre('movie', 99, page, selectedPlatforms),
      tmdb.discoverByGenre('tv', 99, page, selectedPlatforms),
    ]);
    if (!isCurrent()) return null;
    popular = [
      ...(docMovRes?.ok ? docMovRes.value.results.map(item => ({ ...item, media_type: 'movie' as const, genre_ids: Array.from(new Set([...(item.genre_ids || []), 99])) })) : []),
      ...(docTvRes?.ok ? docTvRes.value.results.map(item => ({ ...item, media_type: 'tv' as const, genre_ids: Array.from(new Set([...(item.genre_ids || []), 99])) })) : []),
    ];
    hasMore = hasMoreTmdbPages(page, docMovRes, docTvRes);
    pageFailed = !docMovRes?.ok || !docTvRes?.ok;
  } else if (activeCategory === 'Tout') {
    const trendAllPromise = page <= 5 ? tmdb.getTrending('all', page, selectedPlatforms) : Promise.resolve({ ok: false } as const);
    const popTvPromise = tmdb.getPopular('tv', page, selectedPlatforms);
    const popMovPromise = tmdb.getPopular('movie', page, selectedPlatforms);
    const personPromise = page <= 3 ? tmdb.getPopularPersons(page) : Promise.resolve({ ok: false } as const);

    const trendAllRes = await trendAllPromise;
    if (!isCurrent()) return null;
    const trendingList = trendAllRes?.ok ? trendAllRes.value.results.filter(isRecent).filter(isTitle) : [];
    if (trendingList.length > 0) hooks.onEarlyTrending?.(trendingList);

    const [popTvRes, popMovRes, personRes] = await Promise.all([popTvPromise, popMovPromise, personPromise]);
    if (!isCurrent()) return null;
    const popularList = [
      ...(popTvRes?.ok ? popTvRes.value.results.filter(isRecent).map(item => ({ ...item, media_type: 'tv' as const })) : []),
      ...(popMovRes?.ok ? popMovRes.value.results.filter(isRecent).map(item => ({ ...item, media_type: 'movie' as const })) : []),
    ];
    popular = mergeExplorerMedia(trendingList, popularList);
    trending = trendingList;
    if (personRes?.ok && personRes.value.results) {
      persons = personRes.value.results.map(person => ({ ...person, media_type: 'person' as const }));
    }
    hasMore = hasMoreTmdbPages(page, popTvRes, popMovRes);
    pageFailed = !popTvRes?.ok || !popMovRes?.ok;
  } else {
    const type = activeCategory === 'Films' ? 'movie' : 'tv';
    const [trendRes, popRes] = await Promise.all([
      page <= 5 ? tmdb.getTrending(type, page, selectedPlatforms) : Promise.resolve({ ok: false } as const),
      tmdb.getPopular(type, page, selectedPlatforms),
    ]);
    if (!isCurrent()) return null;
    const trendList = trendRes?.ok ? trendRes.value.results.filter(isRecent).map(item => ({ ...item, media_type: type as 'movie' | 'tv' })) : [];
    const popList = popRes?.ok ? popRes.value.results.filter(isRecent).map(item => ({ ...item, media_type: type as 'movie' | 'tv' })) : [];
    const combined = mergeExplorerMedia(trendList, popList);
    popular = combined.length > 0 ? combined : popList;
    trending = popular.slice(0, 10);
    hasMore = hasMoreTmdbPages(page, popRes);
    pageFailed = !popRes?.ok;
  }

  if (!isCurrent()) return null;
  if (popular !== null && activeCategory !== 'Au cinéma') [popular, trending] = await enrichCinemaEvidenceForExplorerLists(popular, trending);
  if (!isCurrent()) return null;
  return { popular, trending, persons, hasMore, pageError: page > 1 && pageFailed ? 'La suite n’a pas pu être chargée.' : null };
}

/** Une page préparée mais pas encore atteinte reste utilisable 10 min, ensuite elle est rechargée. */
export const EXPLORER_PREFETCH_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * Fenêtre d'une page d'avance, par requête : la page N+1 est préparée en tâche de fond dès que la page N est
 * affichée, puis consommée une seule fois par le défilement. Un changement de filtre ou de catégorie la vide.
 */
export function createExplorerHomePrefetch(load: typeof loadExplorerHomePage = loadExplorerHomePage, now: () => number = Date.now) {
  let activeKey = '';
  const pages = new Map<number, { at: number; promise: Promise<ExplorerHomePage | null> }>();
  const ensureKey = (key: string) => {
    if (key === activeKey) return;
    activeKey = key;
    pages.clear();
  };
  return {
    /** Page demandée par l'écran : la page préchargée si elle existe et reste fraîche, sinon null. */
    take(query: ExplorerHomeQuery, page: number): Promise<ExplorerHomePage | null> | null {
      ensureKey(explorerHomeQueryKey(query));
      const entry = pages.get(page);
      pages.delete(page);
      return entry && now() - entry.at < EXPLORER_PREFETCH_MAX_AGE_MS ? entry.promise : null;
    },
    /** Prépare la page qui suit `page`, sans rappel de rendu anticipé. */
    prime(query: ExplorerHomeQuery, page: number): void {
      if (!canPrefetchExplorerHomePage(query)) return;
      ensureKey(explorerHomeQueryKey(query));
      for (const known of [...pages.keys()]) if (known <= page) pages.delete(known);
      if (pages.has(page + 1)) return;
      pages.set(page + 1, { at: now(), promise: load(query, page + 1).catch(() => null) });
    },
  };
}
