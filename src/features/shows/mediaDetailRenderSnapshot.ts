import { prepareTrailerVideos } from '../trailers/trailerPolicy.ts';

export type MediaDetailRenderType = 'tv' | 'movie';

// Version 4 : dernier et prochain épisode diffusés pour le statut de diffusion de la fiche série (SEENIT-UX-023).
export const MEDIA_DETAIL_RENDER_SCHEMA_VERSION = 4;
export const MEDIA_DETAIL_RENDER_MAX_GENRES = 24;
export const MEDIA_DETAIL_RENDER_MAX_KEYWORDS = 40;
export const MEDIA_DETAIL_RENDER_MAX_LOGOS = 8;
export const MEDIA_DETAIL_RENDER_MAX_CAST = 12;
export const MEDIA_DETAIL_RENDER_MAX_SEASONS = 40;
export const MEDIA_DETAIL_RENDER_MAX_VIDEOS = 8;

const compactNamedItem = (item: { id?: unknown; name?: unknown } | null | undefined) => {
  if (!item) return null;
  return {
    id: Number.isFinite(Number(item.id)) ? Number(item.id) : undefined,
    name: item.name ? String(item.name) : undefined,
  };
};

interface ImageSource { file_path?: unknown; iso_639_1?: string | null; aspect_ratio?: unknown; vote_average?: unknown }
interface KeywordSource { id?: unknown; name?: unknown }
interface ReleaseSource { type?: unknown; release_date?: unknown; note?: unknown }
interface CountryReleasesSource { iso_3166_1?: unknown; release_dates?: ReleaseSource[] }

const compactImage = (item: ImageSource | null | undefined) => {
  if (!item?.file_path) return null;
  return {
    file_path: String(item.file_path),
    iso_639_1: item.iso_639_1 ?? null,
    aspect_ratio: Number.isFinite(Number(item.aspect_ratio)) ? Number(item.aspect_ratio) : undefined,
    vote_average: Number.isFinite(Number(item.vote_average)) ? Number(item.vote_average) : undefined,
  };
};

const compactKeyword = (item: KeywordSource | null | undefined) => {
  if (!item?.name) return null;
  return {
    id: Number.isFinite(Number(item.id)) ? Number(item.id) : undefined,
    name: String(item.name),
  };
};

const compactCastMember = (item: any) => {
  const id = Number(item?.id);
  if (!Number.isFinite(id) || id <= 0 || !item?.name) return null;

  const roles = Array.isArray(item.roles)
    ? item.roles
        .map((role: any) => ({
          character: role?.character ? String(role.character) : undefined,
          episode_count: Number.isFinite(Number(role?.episode_count)) ? Number(role.episode_count) : undefined,
        }))
        .filter((role: any) => role.character || role.episode_count !== undefined)
        .slice(0, 3)
    : undefined;

  return {
    id,
    ...(Number.isFinite(Number(item.order)) ? { order: Number(item.order) } : {}),
    name: String(item.name),
    profile_path: item.profile_path || null,
    ...(item.character ? { character: String(item.character) } : {}),
    ...(roles && roles.length > 0 ? { roles } : {}),
    ...(Number.isFinite(Number(item.total_episode_count)) ? { total_episode_count: Number(item.total_episode_count) } : {}),
    ...(Number.isFinite(Number(item.episode_count)) ? { episode_count: Number(item.episode_count) } : {}),
  };
};

interface SeasonSource { id?: unknown; name?: unknown; season_number?: unknown; episode_count?: unknown; air_date?: string | null; poster_path?: string | null; overview?: unknown }
const compactSeason = (item: SeasonSource | null | undefined) => {
  if (!item || !Number.isFinite(Number(item.season_number))) return null;
  return {
    id: Number.isFinite(Number(item.id)) ? Number(item.id) : undefined,
    name: item.name ? String(item.name) : undefined,
    season_number: Number(item.season_number),
    episode_count: Number.isFinite(Number(item.episode_count)) ? Number(item.episode_count) : undefined,
    air_date: item.air_date || undefined,
    poster_path: item.poster_path || null,
    overview: item.overview ? String(item.overview) : undefined,
  };
};

interface VideoSource {
  id?: unknown;
  key?: unknown;
  name?: unknown;
  site?: unknown;
  type?: unknown;
  official?: unknown;
  iso_639_1?: string;
  iso_3166_1?: string;
  published_at?: string;
}

interface AirEpisodeSource { air_date?: unknown; season_number?: unknown; episode_number?: unknown }
const compactAirEpisode = (item: AirEpisodeSource | null | undefined) => {
  if (!item || typeof item.air_date !== 'string') return null;
  const season = Number(item.season_number), episode = Number(item.episode_number);
  return { air_date: item.air_date, season_number: Number.isFinite(season) ? season : null, episode_number: Number.isFinite(episode) ? episode : null };
};

const compactVideo = (item: VideoSource | null | undefined) => {
  if (!item?.key || item.site !== 'YouTube') return null;
  return {
    id: item.id ? String(item.id) : undefined,
    key: String(item.key),
    name: item.name ? String(item.name) : '',
    site: 'YouTube',
    type: item.type ? String(item.type) : undefined,
    official: item.official === true,
    iso_639_1: item.iso_639_1 || undefined,
    iso_3166_1: item.iso_3166_1 || undefined,
    published_at: item.published_at || undefined,
  };
};

export function createMediaDetailRenderSnapshot(
  details: any,
  type: MediaDetailRenderType,
): any | null {
  const id = Number(details?.id);
  if (!Number.isFinite(id) || id <= 0) return null;

  const rawKeywords = type === 'tv' ? details?.keywords?.results : details?.keywords?.keywords;
  const keywords = Array.isArray(rawKeywords)
    ? rawKeywords.map(compactKeyword).filter(Boolean).slice(0, MEDIA_DETAIL_RENDER_MAX_KEYWORDS)
    : [];
  const genres = Array.isArray(details?.genres)
    ? details.genres.map(compactNamedItem).filter(Boolean).slice(0, MEDIA_DETAIL_RENDER_MAX_GENRES)
    : [];
  const logos = Array.isArray(details?.images?.logos)
    ? details.images.logos.map(compactImage).filter(Boolean).slice(0, MEDIA_DETAIL_RENDER_MAX_LOGOS)
    : [];
  const rawCast = type === 'tv'
    ? (Array.isArray(details?.aggregate_credits?.cast) ? details.aggregate_credits.cast : details?.credits?.cast)
    : details?.credits?.cast;
  const cast = Array.isArray(rawCast)
    ? rawCast.map(compactCastMember).filter(Boolean).slice(0, MEDIA_DETAIL_RENDER_MAX_CAST)
    : [];
  const seasons = Array.isArray(details?.seasons)
    ? details.seasons.map(compactSeason).filter(Boolean).slice(0, MEDIA_DETAIL_RENDER_MAX_SEASONS)
    : [];
  const videos = Array.isArray(details?.videos?.results)
    ? prepareTrailerVideos(details.videos.results.map(compactVideo).filter(Boolean))
        .slice(0, MEDIA_DETAIL_RENDER_MAX_VIDEOS)
        .map(({ languageLabel: _languageLabel, typeLabel: _typeLabel, ...video }) => video)
    : [];
  const networks = Array.isArray(details?.networks)
    ? details.networks.map((network: { id?: unknown; name?: unknown; logo_path?: string | null; origin_country?: string } | null) => ({
        id: Number.isFinite(Number(network?.id)) ? Number(network.id) : undefined,
        name: network?.name ? String(network.name) : undefined,
        logo_path: network?.logo_path || null,
        origin_country: network?.origin_country || undefined,
      })).slice(0, 8)
    : [];
  const externalIds = details?.external_ids ? {
    imdb_id: details.external_ids.imdb_id || undefined,
    tvdb_id: Number.isFinite(Number(details.external_ids.tvdb_id)) ? Number(details.external_ids.tvdb_id) : undefined,
  } : undefined;
  // Revue Codex #943 : la preuve « en salle » (sorties françaises détaillées) survit au redémarrage,
  // sinon un film en salle repasserait en « fin à » sur le billet de l'accueil.
  const countries: CountryReleasesSource[] | null = type === 'movie' && Array.isArray(details?.release_dates?.results) ? details.release_dates.results : null;
  const frenchReleases = countries?.find(country => country?.iso_3166_1 === 'FR');
  const releaseDates = countries ? {
    results: Array.isArray(frenchReleases?.release_dates) ? [{
      iso_3166_1: 'FR',
      release_dates: frenchReleases.release_dates.slice(0, 12).map(release => ({
        type: Number(release?.type),
        release_date: typeof release?.release_date === 'string' ? release.release_date : undefined,
        ...(typeof release?.note === 'string' && release.note ? { note: release.note } : {}),
      })),
    }] : [],
  } : undefined;
  const belongsToCollection = details?.belongs_to_collection ? {
    id: Number.isFinite(Number(details.belongs_to_collection.id)) ? Number(details.belongs_to_collection.id) : undefined,
    name: details.belongs_to_collection.name || undefined,
    poster_path: details.belongs_to_collection.poster_path || null,
    backdrop_path: details.belongs_to_collection.backdrop_path || null,
  } : undefined;

  return {
    seenit_render_schema_version: MEDIA_DETAIL_RENDER_SCHEMA_VERSION,
    id,
    media_type: type,
    name: details?.name || undefined,
    title: details?.title || undefined,
    original_name: details?.original_name || undefined,
    original_title: details?.original_title || undefined,
    overview: details?.overview || '',
    genres,
    keywords: type === 'tv' ? { results: keywords } : { keywords },
    poster_path: details?.poster_path || null,
    backdrop_path: details?.backdrop_path || null,
    first_air_date: details?.first_air_date || undefined,
    release_date: details?.release_date || undefined,
    vote_average: Number.isFinite(Number(details?.vote_average)) ? Number(details.vote_average) : undefined,
    vote_count: Number.isFinite(Number(details?.vote_count)) ? Number(details.vote_count) : undefined,
    runtime: Number.isFinite(Number(details?.runtime)) ? Number(details.runtime) : undefined,
    episode_run_time: Array.isArray(details?.episode_run_time)
      ? details.episode_run_time.filter((value: unknown) => Number.isFinite(Number(value))).slice(0, 4).map(Number)
      : undefined,
    number_of_seasons: Number.isFinite(Number(details?.number_of_seasons)) ? Number(details.number_of_seasons) : undefined,
    number_of_episodes: Number.isFinite(Number(details?.number_of_episodes)) ? Number(details.number_of_episodes) : undefined,
    status: details?.status || undefined,
    ...(type === 'tv' ? {
      last_air_date: typeof details?.last_air_date === 'string' ? details.last_air_date : undefined,
      next_episode_to_air: compactAirEpisode(details?.next_episode_to_air),
      last_episode_to_air: compactAirEpisode(details?.last_episode_to_air),
    } : {}),
    tagline: details?.tagline || undefined,
    origin_country: Array.isArray(details?.origin_country) ? details.origin_country.slice(0, 8) : undefined,
    networks,
    external_ids: externalIds,
    belongs_to_collection: belongsToCollection,
    ...(releaseDates ? { release_dates: releaseDates } : {}),
    seasons,
    images: { logos },
    videos: { results: videos },
    ...(type === 'tv' ? { aggregate_credits: { cast } } : { credits: { cast } }),
  };
}
