import React from 'react';
import { createRoot } from 'react-dom/client';
import { WatchNextSection } from '../../src/screens/WatchNextSection';
import { markMovieWatched, markWatchRecordUnseen } from '../../src/features/watchlist/watchProgressActions';
import { markWatchCardEpisode } from '../../src/features/watchlist/watchCardResume';
import { markEpisodeWatched } from '../../src/features/shows/markEpisodeWatched';
import { getTodayStr } from '../../src/lib/utils';
import { useToastStore } from '../../src/store/toastStore';
import { auth, telemetry, useShowsStore, updateShow, releaseWrite, switchAccount, advanceClock } from './watchNext18cRuntime';
Object.defineProperty(navigator, 'vibrate', { value: (milliseconds: number) => { telemetry.vibrations.push(milliseconds); return true; } });
Object.assign(window, { __watch18c: { telemetry, releaseWrite, switchAccount, advanceClock, clearToasts: () => useToastStore.getState().clearQueue(), toasts: () => [useToastStore.getState().currentToast, ...useToastStore.getState().queue].filter(Boolean), snapshot: () => useShowsStore.getState().shows } });
function Harness() {
  const allShows = useShowsStore(state => state.shows);
  const undo = useToastStore(state => state.onUndo);
  const series = allShows.filter(show => show.mediaType === 'tv' && show.seenEpisodes.length < 3);
  const movies = allShows.filter(show => show.mediaType === 'movie' && !show.seenEpisodes.includes('movie'));
  return <main style={{ maxWidth: 700, margin: 'auto' }}>
    <button id="watch-undo" disabled={!undo} style={{ minHeight: 44, padding: 10 }} onClick={async () => { await undo?.(); useToastStore.getState().clearQueue(); }}>Annuler la dernière action</button>
    <WatchNextSection key={auth.currentUser.uid} allShows={allShows} groups={[series, [{...series[3], id:'news-only',tmdbId:210}], [{...series[6], id:'stale-only',tmdbId:211}]]} movies={movies}
      onPerson={id => telemetry.opens.push(`person:${id}`)} onOpenMedia={(id,type)=>telemetry.opens.push(`${type}:${id}`)} active
      onOpen={(id, type) => telemetry.opens.push(`${type}:${id}`)} onEpisode={(show, season, episode) => telemetry.opens.push(`${show.id}:${season}x${episode}`)}
      onMarkSeries={show => markWatchCardEpisode(show, getTodayStr(), markEpisodeWatched)} onMarkMovie={show => markMovieWatched(show, updateShow)}
      onUnseen={(show, episode) => markWatchRecordUnseen(show, episode, updateShow)} actions={() => []} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
