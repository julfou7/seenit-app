import { create } from 'zustand';
import type { Show } from '../../src/types';

export const telemetry = { writes: [] as Array<{ id: string; updates: Partial<Show> }>, episodeOpens: [] as string[], movieOpens: [] as string[], playback: [] as string[], providerRequests: 0 };
const today = new Date();
const at = (days: number, hour: number, minute = 0) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + days, hour, minute).getTime();
const base: Show = { id: 'tv', userId: 'fixture', tmdbId: 42, title: 'Breaking Bad', mediaType: 'tv',
  posterPath: 'http://127.0.0.1:4173/__8f-poster.svg', backdropPath: 'http://127.0.0.1:4173/__8f-backdrop.svg', status: 'watching', isArchived: false,
  createdAt: at(-90, 12), updatedAt: at(0, 22, 7), lastWatchedAt: at(0, 22, 7),
  seenEpisodes: ['S05E14', '5x13'], episodeRecords: { S05E14: { watchedAt: at(0, 22, 7), rating: 9, emotion: '♥', episodeTitle: 'Ozymandias' }, '5x13': { watchedAt: at(-1, 12), watchedTimeKnown: false }, '5x9': { watchedAt: at(0, 23) } },
  seasonsCache: [{ season_number: 5, episode_count: 16 }], seriesEnded: true,
};
const initial = [base, { ...base, id: 'movie', tmdbId: 2, mediaType: 'movie' as const, title: 'Dune : Deuxième partie', seenEpisodes: ['movie'], episodeRecords: { movie: { watchedAt: at(0, 19, 12), plexImported: true } } },
  { ...base, id: 'legacy', tmdbId: 4, mediaType: 'movie' as const, title: 'Interstellar', seenEpisodes: ['movie'], episodeRecords: {}, lastWatchedAt: at(-1, 12) }];
const store = create<{ shows: Show[] }>(() => ({ shows: initial }));
export const makeRecordlessHistory = () => {
  const day = at(-10, 12);
  store.setState(state => ({ shows: state.shows.map(show => show.id === 'tv' ? { ...show, episodeRecords: {}, lastWatchedAt: day } : show) }));
  return day;
};
export function useShows() {
  return { shows: store(state => state.shows), loading: false, updateShow: async (id: string, updates: Partial<Show>) => {
    telemetry.writes.push({ id, updates });
    store.setState(state => ({ shows: state.shows.map(show => show.id === id ? { ...show, ...updates } : show) }));
  } };
}
export const auth = { currentUser: { uid: 'fixture' } };
export const db = {};
export const usePlexAvailabilityStore = create(() => ({ cache: {}, getMediaAvailability: () => undefined }));
export const getPlexMediaKey = (id: number, type: string) => `${type}:${id}`;
export const openPlexWatchUrl = async () => { telemetry.playback.push('plex'); };
const providers = { results: { FR: { link: 'https://www.themoviedb.org/tv/42/watch', flatrate: [{ provider_id: 8, provider_name: 'Netflix', logo_path: 'http://127.0.0.1:4173/__history-provider.svg' }] } } };
export const tmdb = {
  peekRenderableMediaDetails: (_id: number, type: string) => _id===901 ? null : type==='tv' ? {episode_run_time:[47]} : {runtime:169},
  peekWatchProviders: () => providers,
  getWatchProviders: async () => { telemetry.providerRequests++; throw new Error('Requête fournisseur directe interdite'); },
  getEpisodeDetails: async (_id: number, season: number, episode: number) => ({ ok: true, value: { name: episode === 14 ? 'Ozymandias' : 'Confessions', runtime: _id===901 ? episode===1 ? 29 : 30 : 47, still_path: 'http://127.0.0.1:4173/__8f-backdrop.svg', air_date: '2013-01-01', season_number: season, episode_number: episode } }),
  getEpisodeHistoryMetadata: async (_id: number, season: number, episode: number) => ({ ok: true, value: { name: episode === 14 ? 'Ozymandias' : 'Confessions', runtime: _id===901 ? episode===1 ? 29 : 30 : 47, still_path: 'http://127.0.0.1:4173/__8f-backdrop.svg', air_date: '2013-01-01', season_number: season, episode_number: episode } }),
  getMovieDetails: async (id: number) => ({ ok: true, value: { runtime: id === 2 ? 166 : 169, release_date: id === 2 ? '2024-03-01' : '2014-01-01', genres: [{ name: 'Science-fiction' }, { name: 'Aventure' }], backdrop_path: 'http://127.0.0.1:4173/__8f-backdrop.svg', belongs_to_collection: id === 2 ? { id: 20 } : null } }),
  getCollectionDetails: async () => ({ ok: true, value: { parts: [{ id: 1, release_date: '2021-01-01' }, { id: 2, release_date: '2024-03-01' }, { id: 3, release_date: '2030-01-01' }] } }),
};

export function makeGroupedHistory() {
  store.setState({shows:[{...base,seenEpisodes:['5x11','5x12','5x13'],episodeRecords:Object.fromEntries([11,12,13].map(number=>[`5x${number}`,{watchedAt:at(0,22,number),rating:9}]))},initial[1],initial[2]]});
}

export function makeBulkSeasonHistory() {
  const watchedAt=at(0,22);
  store.setState({shows:[{...base,seenEpisodes:Array.from({length:12},(_,index)=>`1x${index+1}`),episodeRecords:Object.fromEntries(Array.from({length:12},(_,index)=>[`1x${index+1}`,{watchedAt}])),seasonsCache:[{season_number:1,episode_count:12}]},initial[1]]});
}

export function makePaulHistory() {
 store.setState({shows:[{...base,id:'paul',tmdbId:901,title:'Paul, la série',seenEpisodes:['1x1','1x2'],episodeRecords:{'1x1':{watchedAt:at(-3,9,7)},'1x2':{watchedAt:at(-3,9,8)}},seasonsCache:undefined,seasonProgress:undefined}]});
}
