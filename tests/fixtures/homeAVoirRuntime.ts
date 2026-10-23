import { create } from 'zustand';
import { createElement } from 'react';
import * as base from './watchNext18cRuntime';
import type { Show } from '../../src/types';
export * from './watchNext18cRuntime';
export const CURRENT_APP_VERSION = '1.4.217';
export const openPlexWatchUrl = async () => { base.telemetry.opens.push('plex'); };
export const auth = { currentUser: { uid: 'fixture-a' }, onAuthStateChanged: (callback: (user: {uid: string}) => void) => { callback(auth.currentUser); return () => {}; } };
export const onAuthStateChanged = (_auth: unknown, callback: (user: {uid: string}) => void) => auth.onAuthStateChanged(callback);
const date = (days: number) => { const value = new Date(); value.setDate(value.getDate() + days); return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`; };
const extra: Show[] = [0, 3, 12].map((days, index) => ({ ...base.initialShows[0], id: `upcoming-${index}`, title: ['Sortie du jour', 'Épisode cette semaine', 'Sortie plus tard'][index], notificationsEnabled: true, nextEpisodeToAir: { season_number: 2, episode_number: 1, name: 'Un nouvel épisode', air_date: date(days) }, nextEpisodeToWatch: null }));
const history: Show[] = Array.from({ length: 12 }, (_, index) => ({ ...base.initialShows[8], id: `history-${index}`, title: `Film vu ${index+1}`, status: 'completed', seenEpisodes: ['movie'], episodeRecords: { movie: { watchedAt: Date.now()-index*60_000 } } }));
base.useShowsStore.setState({ shows: [...base.initialShows, ...extra, ...history] });
base.usePlexAvailabilityStore.setState({ cache: {
  ...base.usePlexAvailabilityStore.getState().cache,
  'tv:10': { available: true, serverName: 'Série partielle' },
} });
export function useShows() { return { shows: base.useShowsStore(state => state.shows), loading: false, updateShow: base.updateShow }; }
export const useDownloadConfigStore = create(() => ({ downloadsEnabled: false, userPlatforms: [] }));
export const useLiveDownloadStore = create(() => ({ downloads: [] }));
export const useUpdateStore = create(() => ({ hasUpdate: true, latestRelease: { version: '1.4.999' }, requestUpdateModal: () => base.telemetry.opens.push('update') }));
export const collection = (_db: unknown, ...parts: string[]) => parts;
export const query = (...args: unknown[]) => args;
export const orderBy = (...args: unknown[]) => args;
export const limit = (count: number) => count;
export const getDocs = async () => ({ docs: [{ id: 'news-1', data: () => ({ showId: 'series-0', message: 'Nouvelle saison annoncée' }) }] });
export const getDoc = async () => ({ exists: () => true, data: () => ({ readNewsIds: [] }) });
export const setDoc = async () => {};
export const deleteDoc = async () => {};
export const requestNotificationPermission = async () => 'fixture-token';
export const sendNativeNotification = async () => {};
export const EpisodeDetailModal = () => createElement('div', null, 'Fiche épisode');
export const PersonDetailModal = () => null;
export const tmdb = { ...base.tmdb,
  getEpisodeDetails: async (_id: number, season: number, episode: number) => ({ ok: true, value: { name: `Épisode ${episode}`, runtime: 42, season_number: season, episode_number: episode } }),
  getCollectionDetails: async () => ({ ok: true, value: { parts: [] } }),
};
