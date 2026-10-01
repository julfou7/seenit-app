import React, { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ContinueWatchingCard } from '../../src/components/cards/ContinueWatchingCard';
import { MovieWatchCard } from '../../src/components/cards/MovieWatchCard';
import { type Show } from '../../src/types';
import { hydratePlatformPreferences } from '../../src/features/providers/platformPreferenceHydration';
import { writeUserScopedJson } from '../../src/lib/userIsolation';
import { auth, telemetry, results, usePlexAvailabilityStore, finishProviderNetwork } from './providerRuntime.issue337';

let finishCloud: (value: unknown) => void = () => {};
const startHydration = () => hydratePlatformPreferences('account-a', {
  read: () => { telemetry.reads++; return new Promise(resolve => { finishCloud = resolve; }); },
  save: async ids => { telemetry.saves.push(ids); },
});
const show: Show = {
  id: 'fixture-tv', userId: 'account-a', tmdbId: 125359, title: 'Lioness', mediaType: 'tv',
  posterPath: null, backdropPath: null, status: 'watching', isArchived: false,
  createdAt: 1, updatedAt: 1, firstAirDate: '2023-01-01', totalAiredEpisodes: 8,
  seenEpisodes: ['1x1'], episodeRecords: {},
  nextEpisodeToWatch: { season_number: 1, episode_number: 2, air_date: '2023-01-02', name: 'Épisode suivant' },
  networks: [{ name: 'Ancien badge Plex', logo_path: '/legacy-network.png' }],
};
localStorage.clear();
localStorage.setItem('seenit_watch_providers_v1', JSON.stringify({
  'tv:125359': { data: { results }, timestamp: Date.now(), retention: 'library' },
  'movie:42': { data: { results }, timestamp: Date.now(), retention: 'library' },
  'movie:84': { data: { results: { FR: { flatrate: [results.FR.flatrate[0]], buy: [results.FR.flatrate[1]] } } }, timestamp: Date.now() },
}));
usePlexAvailabilityStore.setState({ cache: Object.fromEntries([
  ['tv', 125359], ['movie', 42], ['movie', 84], ['tv', 104],
].map(([type, id]) => [`v3:account-a:${type}:${id}`, { available: true, serverName: 'Maison' }])) });
Object.assign(window, { __provider337: {
  telemetry, finishCloud: (value: unknown) => finishCloud(value), finishProviderNetwork,
  startHydration,
  setPlatforms: (ids: number[]) => writeUserScopedJson('account-a', 'platforms', ids),
  setPlex: (available: boolean) => usePlexAvailabilityStore.setState(state => ({ cache: Object.fromEntries(Object.entries(state.cache).map(([key, info]) => [key, { ...info, available }])) })),
} });
function Harness() {
  const [loggedIn, setLoggedIn] = useState(false);
  return <main className="p-6 space-y-5">
    <h1>SeenIt — Mes plateformes</h1>
    <button id="login" onClick={() => {
      auth.currentUser = { uid: 'account-a' }; setLoggedIn(true); void startHydration();
    }}>Démarrer la session sans Réglages</button>
    {loggedIn && <>
      <section id="card-tv"><ContinueWatchingCard show={show} onMarkAsSeen={() => {}} /></section>
      <section id="card-movie"><MovieWatchCard show={{ ...show, id: 'movie-42', tmdbId: 42, mediaType: 'movie' }} onMarkAsSeen={() => {}} /></section>
      <section id="card-unavailable"><MovieWatchCard show={{ ...show, id: 'movie-84', tmdbId: 84, mediaType: 'movie' }} onMarkAsSeen={() => {}} /></section>
      <section id="card-pending"><ContinueWatchingCard show={{ ...show, id: 'tv-104', tmdbId: 104, title: 'Média voisin' }} onMarkAsSeen={() => {}} /></section>
    </>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>);
