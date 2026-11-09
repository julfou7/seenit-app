import { getTmdbLocalizedTitle } from '../shows/mediaTitle.ts';
import type { ProgrammedCalendar, ProgrammedItem } from './programmedCalendar';
import type { RecentImport, RecentImports } from './recentImports';

/**
 * SEENIT-DOWNLOAD-022 — Retour terrain du 09/11 sur la v1.4.287 (« titre pas traduit dans Téléchargements, écart
 * avec le reste de l'app, voir L'Arène ») : Sonarr/Radarr nomment les titres d'après leurs propres sources, en
 * anglais (« The Arena (2026) »), avec leurs affiches et leurs notes. Partout ailleurs, SeenIt affiche la fiche
 * TMDB en français. Programmés et Téléchargés reprennent donc le titre, l'affiche, la note et l'année de la fiche
 * TMDB, et le titre français des épisodes, rattachés par identité TMDB exacte (jamais par le titre). Les valeurs de
 * Sonarr/Radarr ne restent qu'en repli : pas d'identifiant TMDB, fiche indisponible ou trop lente.
 */
export interface ArrMediaLabel { title?: string; posterPath?: string; rating?: number; year?: number }
export interface ArrLabelSource {
  media: (tmdbId: number, mediaType: 'tv' | 'movie') => Promise<ArrMediaLabel | null>;
  /** Titres français des épisodes d'une saison TMDB, par numéro d'épisode. */
  episodes: (tmdbId: number, season: number) => Promise<ReadonlyMap<number, string> | null>;
}
export interface ArrLists { programmed: ProgrammedCalendar; imports: RecentImports }

/** Au-delà, la synchronisation n'attend plus TMDB : le repli Sonarr/Radarr s'affiche, la fiche est en cache ensuite. */
export const ARR_LABEL_TIMEOUT_MS = 2500;

const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined;

/** Libellé SeenIt d'une fiche TMDB fr-FR : titre localisé, affiche, note et année. */
export function arrMediaLabel(details: unknown, mediaType: 'tv' | 'movie'): ArrMediaLabel | null {
  if (!details || typeof details !== 'object') return null;
  const fields = details as Record<string, unknown>;
  const year = Number(String((mediaType === 'movie' ? fields.release_date : fields.first_air_date) || '').slice(0, 4));
  const rating = Number(fields.vote_average);
  return {
    title: getTmdbLocalizedTitle(fields, mediaType) || undefined,
    posterPath: text(fields.poster_path)?.startsWith('/') ? text(fields.poster_path) : undefined,
    rating: rating > 0 ? Math.round(rating * 10) / 10 : undefined,
    year: year > 1800 ? year : undefined,
  };
}

/** Titres des épisodes d'une saison TMDB fr-FR (`episodes[].episode_number` → `name`). */
export function seasonEpisodeTitles(season: unknown): ReadonlyMap<number, string> | null {
  const episodes = (season as { episodes?: unknown } | null)?.episodes;
  if (!Array.isArray(episodes)) return null;
  const titles = new Map<number, string>();
  for (const episode of episodes as Array<{ episode_number?: unknown; name?: unknown }>) {
    const number = Number(episode?.episode_number), name = text(episode?.name);
    if (Number.isInteger(number) && number > 0 && name) titles.set(number, name);
  }
  return titles;
}

const tmdbImage = (path: string, size: 'w185' | 'w342') => `https://image.tmdb.org/t/p/${size}${path}`;
const mediaKey = (mediaType: 'tv' | 'movie', tmdbId: unknown) => Number(tmdbId) > 0 ? `${mediaType}:${Number(tmdbId)}` : null;
const programmedKey = (item: ProgrammedItem) => mediaKey(item.kind === 'movie' ? 'movie' : 'tv', item.tmdbId);
const importKey = (item: RecentImport) => mediaKey(item.kind === 'movie' ? 'movie' : 'tv', item.tmdbId);
const seasonKey = (tmdbId: number, season: number) => `${tmdbId}:${season}`;

function settle<T>(promise: Promise<T | null>, timeoutMs: number): Promise<T | null> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    promise.then(value => resolve(value ?? null), () => resolve(null)).finally(() => clearTimeout(timer));
  });
}

/** Applique un libellé SeenIt à un élément programmé ; sans libellé, l'élément reste tel quel. */
export function localizeProgrammedItem(item: ProgrammedItem, label: ArrMediaLabel | null | undefined, episodeTitles?: ReadonlyMap<number, string> | null): ProgrammedItem {
  const posterUrl = label?.posterPath ? tmdbImage(label.posterPath, 'w185') : item.posterUrl;
  if (item.kind === 'movie') return { ...item, title: label?.title || item.title, posterUrl };
  return { ...item, seriesTitle: label?.title || item.seriesTitle, title: episodeTitles?.get(item.episode) || item.title, posterUrl };
}

/** Applique un libellé SeenIt à un import ; la note et l'année de la fiche remplacent celles de Sonarr/Radarr. */
export function localizeRecentImport(item: RecentImport, label: ArrMediaLabel | null | undefined): RecentImport {
  if (!label) return item;
  return { ...item, title: label.title || item.title, posterUrl: label.posterPath ? tmdbImage(label.posterPath, 'w342') : item.posterUrl, rating: label.rating ?? item.rating, year: label.year ?? item.year };
}

/**
 * Programmés et Téléchargés avec les libellés SeenIt. Une fiche ou une saison demandée une seule fois par
 * synchronisation (cache TMDB du client ensuite) ; une erreur ou un délai dépassé garde le repli Sonarr/Radarr.
 */
export async function localizeArrLists(lists: ArrLists, source: ArrLabelSource, timeoutMs = ARR_LABEL_TIMEOUT_MS): Promise<ArrLists> {
  const media = new Map<string, Promise<ArrMediaLabel | null>>();
  const seasons = new Map<string, Promise<ReadonlyMap<number, string> | null>>();
  const askMedia = (key: string | null) => {
    if (!key || media.has(key)) return;
    const [mediaType, id] = key.split(':');
    media.set(key, settle(source.media(Number(id), mediaType as 'tv' | 'movie'), timeoutMs));
  };
  for (const item of lists.programmed.items) {
    askMedia(programmedKey(item));
    if (item.kind === 'episode' && Number(item.tmdbId) > 0 && !seasons.has(seasonKey(Number(item.tmdbId), item.season))) {
      seasons.set(seasonKey(Number(item.tmdbId), item.season), settle(source.episodes(Number(item.tmdbId), item.season), timeoutMs));
    }
  }
  for (const item of lists.imports.items) askMedia(importKey(item));
  const labels = new Map(await Promise.all([...media].map(async ([key, promise]) => [key, await promise] as const)));
  const titles = new Map(await Promise.all([...seasons].map(async ([key, promise]) => [key, await promise] as const)));
  const label = (key: string | null) => key ? labels.get(key) : null;
  return {
    programmed: { ...lists.programmed, items: lists.programmed.items.map(item => localizeProgrammedItem(item, label(programmedKey(item)), item.kind === 'episode' && Number(item.tmdbId) > 0 ? titles.get(seasonKey(Number(item.tmdbId), item.season)) : null)) },
    imports: { ...lists.imports, items: lists.imports.items.map(item => localizeRecentImport(item, label(importKey(item)))) },
  };
}
