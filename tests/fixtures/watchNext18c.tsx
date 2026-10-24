import React from 'react';
import { createRoot } from 'react-dom/client';
import { WatchNextSection } from '../../src/screens/WatchNextSection';
import { markMovieWatched, markWatchRecordUnseen } from '../../src/features/watchlist/watchProgressActions';
import { markWatchCardEpisode } from '../../src/features/watchlist/watchCardResume';
import { markEpisodeWatched } from '../../src/features/shows/markEpisodeWatched';
import { getTodayStr } from '../../src/lib/utils';
import { useToastStore } from '../../src/store/toastStore';
import { auth, telemetry, useShowsStore, updateShow, releaseWrite, releaseAddWrite, switchAccount, advanceClock } from './watchNext18cRuntime';
Object.defineProperty(navigator, 'vibrate', { value: (milliseconds: number) => { telemetry.vibrations.push(milliseconds); return true; } });
Object.assign(window, { __watch18c: { burst: async () => { for(let i=0;i<12;i++) { window.dispatchEvent(new Event('seenit-metadata-cached'));useShowsStore.setState({shows:useShowsStore.getState().shows.map(show=>({...show,updatedAt:Date.now()+i}))});await new Promise(resolve=>setTimeout(resolve,20)); } }, stress: () => { const shows=useShowsStore.getState().shows;useShowsStore.setState({shows:[...shows,...Array.from({length:160},(_,i)=>({...shows[0],id:`stress-${i}`,tmdbId:500+i}))]}); }, telemetry, releaseWrite, releaseAddWrite, switchAccount, advanceClock, clearToasts: () => useToastStore.getState().clearQueue(), toasts: () => [useToastStore.getState().currentToast, ...useToastStore.getState().queue].filter(Boolean), snapshot: () => useShowsStore.getState().shows } });
function Harness() {
  const allShows = useShowsStore(state => state.shows);
  const undo = useToastStore(state => state.onUndo);
  const series = allShows.filter(show => show.id.startsWith('series-') && show.seenEpisodes.length < 3);
  const news = allShows.find(show=>show.id==='news-only')!;
  const movies = allShows.filter(show => show.mediaType === 'movie' && !show.seenEpisodes.includes('movie'));
  return <main style={{ maxWidth: 700, margin: 'auto' }}>
    <button id="watch-undo" disabled={!undo} style={{ minHeight: 44, padding: 10 }} onClick={async () => { await undo?.(); useToastStore.getState().clearQueue(); }}>Annuler la dernière action</button>
    <WatchNextSection key={auth.currentUser.uid} allShows={allShows} groups={[[...series,...(news.seenEpisodes.length?[news]:[])], news.seenEpisodes.length?[]:[news], [allShows.find(show=>show.id==='stale-only')!]]} movies={movies}
      onPerson={id => telemetry.opens.push(`person:${id}`)} onOpenMedia={(id,type)=>telemetry.opens.push(`${type}:${id}`)} active
      onOpen={(id, type) => telemetry.opens.push(`${type}:${id}`)} onEpisode={(show, season, episode) => telemetry.opens.push(`${show.id}:${season}x${episode}`)}
      onMarkSeries={show => markWatchCardEpisode(show, getTodayStr(), markEpisodeWatched)} onMarkMovie={show => markMovieWatched(show, updateShow)}
      onUnseen={(show, episode) => markWatchRecordUnseen(show, episode, updateShow)} actions={show => [{label:'Archiver',onSelect:()=>{telemetry.opens.push(`archive:${show.id}`);}},{label:'Supprimer',destructive:true,onSelect:()=>{telemetry.opens.push(`remove:${show.id}`);}}]} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
