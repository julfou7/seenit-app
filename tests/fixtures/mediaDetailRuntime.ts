import { create } from 'zustand';
import { createElement } from 'react';
import type { Show } from '../../src/types';

/** Stubs réseau et stores de la fixture des fiches média (SEENIT-UX-019). */
export const telemetry: { opens: string[]; trailers: number; downloads: number; recommendations: number } = { opens: [], trailers: 0, downloads: 0, recommendations: 0 };
export const useShowsStore = create<{ shows: Show[] }>(() => ({ shows: [] }));
export const openPlexWatchUrl = async () => { telemetry.opens.push('plex'); };
export const DownloadModal = () => { telemetry.downloads++; return createElement('div', { 'data-fixture-download': 'true' }, 'Téléchargement'); };
// #879 — page « Version précise » chargée paresseusement par la fiche (export par défaut).
export default function PreciseVersionPage() { return createElement('div', { 'data-fixture-precise': 'true' }, 'Version précise'); }
export const PersonDetailModal = () => createElement('div', { 'data-fixture-person': 'true' }, 'Fiche personne');
export const PersonProfile = PersonDetailModal;
export const EpisodeDetailModal = () => createElement('div', { 'data-fixture-episode': 'true' }, 'Fiche épisode');
export const TrailerModal = () => { telemetry.trailers++; return createElement('div', { 'data-fixture-trailer': 'true' }, 'Bande-annonce'); };
export const isMovieAtCinema = (media: { seenitAtCinema?: boolean } | null | undefined) => Boolean(media?.seenitAtCinema);
export const isMovieUpcoming = () => false;

const ratings = [8.4, 8.1, 8.2, 8.3, 9.0, 8.4, 8.9, 8.8, 8.8, 8.6, 8.9, 8.6, 9.4, 9.6, 9.1, 9.3];
const names = ['Live Free or Die', 'Madrigal', 'Hazard Pay', 'Fifty-One', 'Dead Freight', 'Buyout', 'Say My Name', 'Gliding Over All', 'Blood Money', 'Buried', 'Confessions', 'Rabid Dog', "To'hajiilee", 'Ozymandias', 'Granite State', 'Felina'];
export const seriesSeason = (season: number) => ({
  season_number: season,
  episodes: Array.from({ length: season === 5 ? 16 : 13 }, (_, index) => ({ id: season * 100 + index, episode_number: index + 1, name: season === 5 ? names[index] : `Épisode ${index + 1}`, overview: season === 5 && index === 15 ? 'Fin de Walt : il revient une dernière fois au Nouveau-Mexique.' : `Résumé de l’épisode ${index + 1}.`, still_path: '/tsRy63Mu5cu8etL1X7ZLyf7UP1M.jpg', air_date: `${2007 + season}-0${1 + (index % 8)}-1${index % 9}`, runtime: 47, vote_average: season === 5 ? ratings[index] : 8 + (index % 5) / 10 })),
  videos: { results: season === 5 ? [{ site: 'YouTube', key: 'season5', name: 'Saison 5' }] : [] },
});

export const recommendationControl = { results: [] as unknown[], directorCredits: null as unknown, actorCredits: {} as Record<number, unknown> };
export const tmdb = {
  getEnglishMediaTitle: async () => ({ ok: true, value: null }),
  getSeasonDetails: async (_id: number, season: number) => season >= 1 && season <= 5 ? { ok: true, value: seriesSeason(season) } : { ok: false },
  getMovieRecommendations: async () => { telemetry.recommendations++; return { ok: true, value: recommendationControl.results }; },
  getCachedPersonCredits: async (personId: number) => personId === 1001 ? { ok: true, value: recommendationControl.directorCredits } : { ok: true, value: recommendationControl.actorCredits[personId] || { cast: [] } },
};

// Fiche épisode : bibliothèque réactive, présence Plex et synchronisation neutres.
export const auth = { currentUser: { uid: 'fixture' } };
export const db = {};
export const showToast = (message: string) => { telemetry.opens.push(`toast:${message}`); };
export const useToastStore = Object.assign(() => ({ showToast }), { getState: () => ({ showToast }) });
export async function updateShow(id: string, updates: Partial<Show>) { useShowsStore.setState(state => ({ shows: state.shows.map(show => show.id === id ? { ...show, ...updates } : show) })); }
export async function addShow(show: Omit<Show, 'id'>) { const id = `added-${Date.now()}`; useShowsStore.setState(state => ({ shows: [...state.shows, { ...show, id } as Show] })); return id; }
export function useShows() { return { shows: useShowsStore(state => state.shows), loading: false, updateShow, addShow, deleteShow: async () => {} }; }
export const syncSingleItem = async () => {};
export const useMediaPresence = () => ({ plexInfo: { available: true, serverName: 'Julien-NAS' }, episodesHasFile: {}, seasonsHasFile: {}, hasFile: false, sonarrHasFile: false });
Object.assign(tmdb, {
  getEpisodeDetails: async () => ({ ok: false }),
  peekWatchProviders: () => ({ results: { FR: { flatrate: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg' }], ads: [{ provider_id: 1796, provider_name: 'Netflix Standard with Ads', logo_path: '/kICQccvOh8AIBMHGkBXJ047xeHN.jpg' }] } } }),
  getWatchProviders: async () => ({ ok: true, value: { results: {} } }),
});
// downloadConfigStore (fonction Téléchargements désactivée par défaut) et Firestore neutres.
export const useDownloadConfigStore = Object.assign(<T>(selector: (state: { downloadsEnabled: boolean }) => T) => selector({ downloadsEnabled: false }), { getState: () => ({ downloadsEnabled: false }) });
export const doc = (..._parts: unknown[]) => ({});
export const getDoc = async () => ({ exists: () => false, data: () => ({}) });
export const setDoc = async () => {};
// Cloche des épisodes à venir (episodeReminder, 08/11) : écriture simulée, sans Firebase.
export const deleteDoc = async () => {};
export const requestNotificationPermission = async () => null;
export const onSnapshot = () => () => {};
export const onAuthStateChanged = () => () => {};

// #879 : le lancement Sonarr/Radarr reste hors du harnais de la fiche (aucun réseau).
export const launchArrDownload = async () => {};
export const useShowActions = () => ({ updateShow: async () => {} });

// SEENIT-DOWNLOAD-016 : l'état Sonarr/Radarr synchronisé est relu après chaque écriture de la fiche.
export const arrWrites: unknown[] = [];
export const notifyArrWrite = (target?: unknown) => { arrWrites.push(target ?? null); };
export const useArrSnapshot = () => null;
export const useArrSyncStore = Object.assign(() => 0, { getState: () => ({ sync: async () => undefined, afterWrite: notifyArrWrite, snapshot: null, revision: 0 }) });
export const arrSyncKey = () => '';
