import { create } from 'zustand';
import { buildSeasonProgressEvidence } from '../../src/features/shows/seasonProgressEvidence';
import { createElement } from 'react';
import * as base from './watchNext18cRuntime';
import type { Show } from '../../src/types';
export * from './watchNext18cRuntime';
export const CURRENT_APP_VERSION = '1.4.217';
export const openPlexWatchUrl = async () => { base.telemetry.opens.push('plex'); };
export const auth = { currentUser: { uid: 'fixture-a' }, onAuthStateChanged: (callback: (user: {uid: string}) => void) => { callback(auth.currentUser); return () => {}; } };
export const onAuthStateChanged = (_auth: unknown, callback: (user: {uid: string}) => void) => auth.onAuthStateChanged(callback);
const date = (days: number) => { const value = new Date(); value.setDate(value.getDate() + days); return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`; };
const extra: Show[] = [0, 3, 12].map((days, index) => ({ ...base.initialShows[0], id: `upcoming-${index}`, title: ['Sortie du jour', 'Épisode cette semaine', 'Sortie plus tard'][index], notificationsEnabled: false, nextEpisodeToAir: { season_number: 2, episode_number: 1, name: 'Un nouvel épisode', air_date: date(days) }, nextEpisodeToWatch: null }));
const history: Show[] = Array.from({ length: 12 }, (_, index) => ({ ...base.initialShows.find(show => show.id === 'movie-0')!, id: `history-${index}`, title: `Film vu ${index+1}`, status: 'completed', seenEpisodes: ['movie'], episodeRecords: { movie: { watchedAt: Date.now()-index*60_000 } } }));
base.useShowsStore.setState({ shows: [...base.initialShows, ...extra, ...history] });
base.usePlexAvailabilityStore.setState({ cache: {
  ...base.usePlexAvailabilityStore.getState().cache,
  'tv:10': { available: true, serverName: 'Série partielle' },
} });
export function useShows() { return { shows: base.useShowsStore(state => state.shows), loading: false, updateShow: base.updateShow, addShow: base.addShow }; }
export const useDownloadConfigStore = create(() => ({ downloadsEnabled: false, userPlatforms: [] }));
export const useLiveDownloadStore = create(() => ({ downloads: [] }));
export const useUpdateStore = create(() => ({ hasUpdate: true, latestRelease: { version: '1.4.999' }, requestUpdateModal: () => base.telemetry.opens.push('update') }));
export const collection = (_db: unknown, ...parts: string[]) => parts;
export const query = (...args: unknown[]) => args;
export const orderBy = (...args: unknown[]) => args;
export const limit = (count: number) => count;
export const getDocs = async () => ({ docs: [{ id: 'news-1', data: () => ({ showId: 'series-0', message: 'Nouvelle saison annoncée' }) }] });
export const getDoc = async () => ({ exists: () => true, data: () => ({ readNewsIds: [] }) });
export const reminderControl = { holdPermission:false, failWrite:false, permissionCalls:0, nativeNotifications:0, release:()=>{} };
export const setDoc = async (path:string[],payload:Record<string,unknown>) => {
 if (reminderControl.failWrite && path.includes('reminders')) { reminderControl.failWrite=false; throw new Error('fixture reminder write failed'); }
 base.telemetry.writes.push({path,payload});
};
export const deleteDoc = async (path:string[]) => { base.telemetry.writes.push({path,payload:{deleted:true}}); };
export const requestNotificationPermission = async () => { reminderControl.permissionCalls++; if(reminderControl.holdPermission) await new Promise<void>(resolve=>{reminderControl.release=resolve;}); return 'fixture-token'; };
export const sendNativeNotification = async () => { reminderControl.nativeNotifications++; };
export const EpisodeDetailModal = () => createElement('div', null, 'Fiche épisode');
export const PersonDetailModal = () => null;
export const tmdb = { ...base.tmdb,
  getEpisodeDetails: async (_id: number, season: number, episode: number) => ({ ok: true, value: { name: `Épisode ${episode}`, runtime: 42, season_number: season, episode_number: episode } }),
  getEpisodeHistoryMetadata: async (_id: number, season: number, episode: number) => ({ ok: true, value: { name: `Épisode ${episode}`, runtime: 42, season_number: season, episode_number: episode } }),
  getMovieDetails: async (id: number) => id===303 ? {ok:true,value:{belongs_to_collection:{id:555}}} : base.tmdb.getMovieDetails(id),
  getCollectionDetails: async () => ({ ok: true, value: { parts: [{id:301,release_date:'2018-01-01'},{id:302,release_date:'2021-01-01'},{id:303,release_date:date(12)}] } }),
};

export function addProgressExamples() {
  base.useShowsStore.setState(state=>({shows:[...state.shows,...[1,6].map(count=>({...base.initialShows[0],id:`upcoming-count-${count}`,tmdbId:300+count,title:count===1?'Harry Potter':'A Knight of the Seven Kingdoms',seenEpisodes:[],episodeRecords:{},seasonProgress:undefined, nextEpisodeToWatch:null,nextEpisodeToAir:{season_number:1,episode_number:1,episode_count:count,air_date:date(12)}})),{...base.initialShows.find(show=>show.id==='movie-0')!,id:'upcoming-collection',tmdbId:303,title:'Sans un bruit 3',firstAirDate:date(12)}]}));
}

export function terrain221Examples() {
 base.useShowsStore.setState(state=>({shows:state.shows.map(show=>show.id==='series-0'?{...show,title:'A Knight of the Seven Kingdoms',seenEpisodes:['1x1'],seriesEnded:false,seasonProgress:buildSeasonProgressEvidence([{season_number:1,episode_count:6}],false),nextEpisodeToWatch:{...show.nextEpisodeToWatch,name:'Bœuf salé',episode_count:6,season_total_unknown:true}}:show.id==='movie-0'?{...show,title:'Vaiana, la légende du bout du monde'}:show.id==='upcoming-2'?{...show,title:'Le Seigneur des anneaux : Les Anneaux de Pouvoir',nextEpisodeToAir:{...show.nextEpisodeToAir,name:'Le prix de la lumière'}}:show.id==='history-0'?{...show,title:'A Knight of the Seven Kingdoms',mediaType:'tv',seenEpisodes:['1x1'],episodeRecords:{'1x1':{episodeTitle:'Le chevalier errant',watchedAt:new Date(new Date(Date.now()).setHours(8,13,0,0)).getTime(),watchedTimeKnown:true}}}:show)}));
}
