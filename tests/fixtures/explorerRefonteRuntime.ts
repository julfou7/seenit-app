import { create } from 'zustand';
import { useRef } from 'react';
import type { Show } from '../../src/types';
import type { TMDBMedia } from '../../src/features/shows/tmdbClient';
export const telemetry = { calls: 0, opened: [] as Array<string | number>, statuses: [] as string[], documentWrites: [] as string[], deleted: [] as string[] };
const media: TMDBMedia[] = Array.from({ length: 60 }, (_, i) => ({ id: 1000 + i, media_type: i % 2 ? 'tv' : 'movie', title: 'Les mondes de demain ' + i, name: 'Les mondes de demain ' + i, release_date: i % 2 ? undefined : '2026-01-01', first_air_date: i % 2 ? '2026-01-01' : undefined, vote_average: 8, vote_count: 800, popularity: 50, poster_path: '/fixture.svg', backdrop_path: '/fixture.svg', genre_ids: [28, 10759] }));
const seed: Show[] = [{ id: 'local42', userId: 'explorer-test', tmdbId: 42, title: 'Breaking Bad', mediaType: 'tv', firstAirDate: '2008-01-20', seenEpisodes: ['1-1'], totalEpisodes: 62, status: 'watching', isArchived: false, posterPath: '/fixture.svg', backdropPath: null, updatedAt: 1, createdAt: 1, episodeRecords: {} }];
seed.push({...seed[0],id:'local-got',tmdbId:7778,title:'Le Trône de fer'});
export const useShowsStore = create(() => ({ shows: seed, addShowOptimistic(show: Show) { useShowsStore.setState(state=>({shows:[...state.shows.filter(item=>item.id!==show.id),show]})); } }));
export const useShows = () => ({
  shows: useShowsStore(state => state.shows),
  addShow: async (data: Omit<Show, 'id' | 'userId'>) => { telemetry.statuses.push(data.status); const id = 'added-' + data.tmdbId; useShowsStore.setState(state => ({ shows: [...state.shows, { ...data, id, userId: 'explorer-test' }] })); return id; },
  deleteShow: async (id: string) => { telemetry.deleted.push(id); useShowsStore.setState(state => ({ shows: state.shows.filter(show => show.id !== id) })); },
  updateShow: async () => {},
});
export const useToastStore = create(() => ({ message: '', undo: undefined as (() => Promise<void>) | undefined, showToast: (message: string, _type?:unknown, _show?:unknown, undo?:()=>Promise<void>) => useToastStore.setState({ message, undo }) }));
export const doc = (_db: unknown, ...segments: string[]) => segments.join('/');
export const setDoc = async (reference: string, _data:unknown) => {telemetry.documentWrites.push(reference);};
export const auth = { currentUser: { uid: 'explorer-test' }, onAuthStateChanged: () => () => {} };
export const db = {};
export const getRecommendations = async () => [];
export const getParentalRatingOverride = () => undefined;
export const getProgressiveAgeSnapshot = () => null;
export const subscribeProgressiveAgeSnapshot = () => () => {};
export const resolveParentalRatingBatch = async () => new Map();
export const enrichCinemaEvidenceForExplorerLists = async (popular: TMDBMedia[], trending: TMDBMedia[]) => [popular, trending];
export const isMovieAtCinema = () => false;
export const isMovieUpcoming = () => false;
const details = (id: number) => Promise.resolve({ ok: true, value: { ...media.find(item => item.id === id), id, overview: 'Un récit à découvrir.', genres: [{ id: 28, name: 'Action' }], videos: { results: [] } } });
const list = async () => ({ ok: true, value: { results: media, total_pages: 1 } });
export const tmdb = {
  getPersonDetails: async (id: number) => ({ ok: true, value: { id, name: 'Bob Odenkirk', biography: 'Bob est un acteur.', profile_path: '/bob.svg', known_for_department: 'Acting' } }),
  getPersonCredits: async () => ({ ok: true, value: { cast: [], crew: [] } }),
  getPersonImages: async () => ({ ok: true, value: { profiles: [] } }),
  getTrending: list, getPopular: list, getPopularPersons: async () => ({ ok: true, value: { results: [], total_pages: 1 } }),
  getTopRated: list, getTopRatedRecent: list, getNowPlaying: list, discoverByGenre: list,
  getShowDetails: details, getMovieDetails: details, getMediaDetails: details,
  getWatchProviders: async () => ({ ok: true, value: { results: { FR: { flatrate: [{ provider_id: 8 }] } } } }),
  smartSearchMulti: async (_query: string, page: number) => {
    telemetry.calls++;
    await new Promise(resolve => setTimeout(resolve, 180));
    return { ok: true, value: { results: page === 1 ? [
      { ...media[0], id: 42, name: 'Breaking Bad', title: 'Breaking Bad', media_type: 'tv' },
      { ...media[0], id: 42, name: undefined, title: 'Breaking Bad au cinéma', media_type: 'movie' },
      { ...media[0], id: 101, title: 'Atréides', media_type: 'movie' },
      { ...media[0], id: 7778, name: 'Game of Thrones', title: undefined, media_type: 'tv' },
      { id: 303, name: 'Bryan Cranston', media_type: 'person', known_for_department: 'Acting', profile_path: '/fixture.svg' },
    ] : [], total_pages: 2 } };
  },
};
export const discoverSeenIt = list;
export function usePassiveWatchProvider() { return { cardRef: useRef<HTMLDivElement>(null), providerName: null, providerLogo: null, isProviderLoading: false }; }

const fixtureCharacter = {
 id: 'breaking-bad-universe:saul goodman', name: 'Saul Goodman', aliases: ['Saul Goodman','Jimmy McGill','Gene Takavic'], universeId: 'breaking-bad-universe', universe: 'Breaking Bad', seed: 'tv:1396',
 actors: [{ id: 1, name: 'Bob Odenkirk', photo: '/bob.svg' }],
 works: [
  { key:'tv:1396', id:1396, type:'tv', title:'Breaking Bad', poster:'/bb.svg', creditCount:1, complete:true, releaseDate:'2008-01-20', episodes:[{key:'1x2', name:'Better Call Saul', airDate:'2009-01-01'}] },
  { key:'tv:60059', id:60059, type:'tv', title:'Better Call Saul', poster:'/bcs.svg', creditCount:2, complete:true, releaseDate:'2015-01-01', episodes:[{key:'1x1',name:'Uno',airDate:'2015-01-01'},{key:'1x2',name:'Mijo',airDate:'2015-01-08'}] },
 ], neighbors:[{id:'breaking-bad-universe:walter white',name:'Walter White',seed:'tv:1396',count:3,available:true}], complete:true,
};
export async function authenticatedFetch(input: string, _init?: RequestInit) {
 const url=new URL(input,'http://127.0.0.1');
 if(url.pathname==='/api/media/characters/detail') {
  const walter=url.searchParams.get('name')==='Walter White';
  return new Response(JSON.stringify({character:walter?{...fixtureCharacter,id:'breaking-bad-universe:walter white',name:'Walter White',aliases:['Walter White'],actors:[{id:2,name:'Bryan Cranston',photo:null}],neighbors:[]}:fixtureCharacter}),{status:200});
 }
 return new Response(JSON.stringify({results:url.searchParams.get('q')?.toLowerCase().includes('saul')?[fixtureCharacter]:[],complete:true}),{status:200});
}
