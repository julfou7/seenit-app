import { create } from 'zustand';

import type { Show } from '../../src/types';

export const auth = { currentUser: { uid: 'fixture-a' } };

export const db = {};

export const telemetry = { writes: [] as Array<{ path: string[]; payload: Record<string, unknown> }>, details: [] as number[], opens: [] as string[], failNext: false, holdNext: false, vibrations: [] as number[], actorRequests: 0, actorPrimes: 0 };

export const fixtureNow = new Date(2026, 9, 21, 22, 30).getTime();

let clock = fixtureNow;

const initialTick = performance.now();
Date.now = () => clock + Math.floor(performance.now() - initialTick);

export const advanceClock = (minutes: number) => { clock += minutes * 60_000; };

const poster = 'http://127.0.0.1:4173/__8f-poster.svg';

const backdrop = 'http://127.0.0.1:4173/__8f-backdrop.svg';

const base: Show = { id: 'series-0', userId: 'fixture-a', tmdbId: 10, title: 'Stranger Things', mediaType: 'tv', posterPath: poster, backdropPath: backdrop, status: 'watching', isArchived: false, createdAt: fixtureNow - 100 * 86_400_000, updatedAt: fixtureNow,

  firstAirDate: '2020-01-01', totalAiredEpisodes: 3, totalEpisodes: 3, seenEpisodes: ['1x1'], episodeRecords: { '1x1': { watchedAt: fixtureNow - 2 * 86_400_000 } },

  nextEpisodeToWatch: { season_number: 1, episode_number: 2, episode_count: 3, aired_episodes_in_season: 3, name: 'Épisode deux', air_date: '2020-01-01' },

};

const durations = [150, 80, null, 100, 100, 169, 90, 120, 130, 200, ...Array.from({length:12},()=>95)];

export const initialShows: Show[] = [

  ...Array.from({ length: 8 }, (_, index) => ({ ...base, id: `series-${index}`, tmdbId: 10 + index, title: ['Stranger Things', 'Game of Thrones', 'The Boys', 'Dark', 'Mercredi', 'Arcane', 'Slow Horses', 'Le Bureau des légendes'][index] })),

  { ...base, id:'news-only',tmdbId:210,title:'Nouvelle série',seenEpisodes:[],episodeRecords:{},firstAirDate:'2026-10-21',nextEpisodeToWatch:{...base.nextEpisodeToWatch!,episode_number:1,name:'Premier épisode',air_date:'2026-10-21'} },

  { ...base,id:'stale-only',tmdbId:211,seenEpisodes:[],episodeRecords:{} },

  ...durations.map((runtime, index) => ({ ...base, id: `movie-${index}`, tmdbId: 100 + index, mediaType: 'movie' as const, title: ['The Punisher : One Last Kill', 'Le Robot sauvage', 'Durée inconnue et titre de film très long sur deux lignes', 'Jurassic Park', 'Retour vers le futur', 'Interstellar', 'Zootopie', 'Un film', 'Un autre film', 'Oppenheimer'][index] || `Film ${index + 1}`,

    seenEpisodes: [], episodeRecords: {}, runtime, firstAirDate: '2024-01-01',

    posterPath: index === 2 ? null : index === 3 ? 'http://127.0.0.1:4173/absent-poster.png' : poster,

    backdropPath: index === 2 ? null : backdrop,

  })),

];

interface State { shows: Show[]; updateShowOptimistic: (id: string, patch: Partial<Show>) => void }

export const useShowsStore = create<State>(set => ({ shows: initialShows, updateShowOptimistic: (id, patch) => set(state => ({ shows: state.shows.map(show => show.id === id ? { ...show, ...patch } : show) })) }));

export const updateShow = async (id: string, patch: Partial<Show>) => {

  await updateDoc(['users', auth.currentUser.uid, 'shows', id], patch);

  useShowsStore.getState().updateShowOptimistic(id, patch);

};

export const doc = (_db: unknown, ...path: string[]) => path;

export const arrayUnion = (...values: string[]) => ({ union: values });

let releaseHeld: () => void = () => {};

export const releaseWrite = () => releaseHeld();

export async function updateDoc(path: string[], payload: Record<string, unknown>) {

  telemetry.writes.push({ path, payload });

  if (telemetry.holdNext) { telemetry.holdNext = false; await new Promise<void>(resolve => { releaseHeld = resolve; }); }

  else await new Promise(resolve => setTimeout(resolve, 30));

  if (telemetry.failNext) { telemetry.failNext = false; throw new Error('Échec de transport simulé'); }

}

export const switchAccount = () => {

  auth.currentUser = { uid: 'fixture-b' };

  useFavoritePeopleStore.setState({people:[]}); // Same scope reset as the production auth listener.

  useShowsStore.setState({ shows: initialShows.map(show => ({ ...show, userId: 'fixture-b', seenEpisodes: [], episodeRecords: {} })) });

};

export const useLogStore = { getState: () => ({ addLog: () => {} }) };

export const appLogger = { info() {}, warn() {}, error() {}, debug() {} };

export const usePlexAvailabilityStore = create(() => ({ cache: { 'movie:100': { available: true, serverName: 'Thomas' } } as Record<string, { available: boolean; serverName: string }>, getMediaAvailability: (key: string) => usePlexAvailabilityStore.getState().cache[key] }));

export const getPlexMediaKey = (id: number, type: string) => `${type}:${id}`;

const providers = { results: { FR: { flatrate: [{ provider_id: 8, provider_name: 'Netflix', logo_path: 'http://127.0.0.1:4173/__history-provider.svg' }] } } };

export const tmdb = {

  peekWatchProviders: () => providers,

  getWatchProviders: async () => ({ ok: true, value: providers }),

  peekMediaDetails: (id: number) => ({ runtime: durations[id - 100] ?? null, release_date: '2024-01-01', credits: id === 102 ? undefined : {cast: id < 100 ? [{id:501,name:'Sean Astin',character:'Bob',order:0}] : [{id:502,name:'Premier Rôle',order:0},{id:501,name:'Sean Astin',character:'Mikey Walsh',order:1}] } }),

  peekRenderableMediaDetails: (id: number) => tmdb.peekMediaDetails(id),

  primeMediaRenderSnapshotFromPersistentCache: async () => { telemetry.actorPrimes++; return true; },

  getPersonDetails: async () => ({ok:true,value:{name:'Sean Astin',profile_path:poster,birthday:'1971-02-25',place_of_birth:'Santa Monica',known_for_department:'Acting',biography:'Une biographie française suffisamment longue pour dépasser trois lignes sur téléphone. '.repeat(12)}}),

  getCollectionDetails: async () => ({ok:true,value:{parts:[]}}),

  getPersonCredits: async () => { telemetry.actorRequests++; return { ok: true, value: { cast: [...Array.from({length:8},(_,i)=>({id:10+i,media_type:'tv',name:`Série ${i}`,character:'Bob'})),{id:100,media_type:'movie',title:'The Punisher : One Last Kill',character:'Mikey Walsh'},{id:999,media_type:'movie',title:'Film à ajouter',character:'Un rôle'}, {id:998,media_type:'movie',title:'Projet futur',release_date:'2027-01-15'}, {id:997,media_type:'tv',name:'Série future',first_air_date:'2026-12-18'}, ...Array.from({length:20},(_,i)=>({id:1000+i,media_type:i===19?'tv':'movie',title:`Filmographie ${i}`,character:'Personnage (voice)',release_date:'2020-01-01'}))].map(credit=>({...credit,poster_path:poster,backdrop_path:backdrop})) } }; },

  getMovieDetails: async (id: number) => { telemetry.details.push(id); return { ok: true, value: tmdb.peekMediaDetails(id) }; },

  getSeasonDetails: async (_id: number, season: number) => {

    await new Promise(resolve => setTimeout(resolve, 20));

    return { ok: true, value: { season_number: season, episodes: [1, 2, 3].map(episode => ({ season_number: season, episode_number: episode, name: `Épisode ${episode}`, air_date: '2020-01-01', still_path: backdrop })) } };

  },

};



export const useFavoritePeopleStore = create<{ people: Array<{id: number; name: string}>; addPerson: (person: {id: number; name: string}) => void; removePerson: (id: number) => void }>(set => ({ people: [], addPerson: person => set(state => ({people:[...state.people,person]})), removePerson: id => set(state => ({people:state.people.filter(person=>person.id!==id)})) }));

export const addShow = async (data: Omit<Show,'id'|'userId'>) => { const id=`added-${data.tmdbId}`; useShowsStore.setState(state=>({shows:[...state.shows,{...data,id,userId:auth.currentUser.uid}]})); return id; };
export function useShows() { return { shows: useShowsStore(state => state.shows), addShow, updateShow }; }


export const requestNotificationPermission = async () => 'fixture-token';
export const sendNativeNotification = async () => {};
export const setDoc = async (path: string[], payload: Record<string, unknown>) => { telemetry.writes.push({path,payload}); };
export const deleteDoc = async (path: string[]) => { telemetry.writes.push({path,payload:{deleted:true}}); };
