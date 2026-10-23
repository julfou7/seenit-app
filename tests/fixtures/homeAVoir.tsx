import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WatchListView } from '../../src/screens/WatchListView';
import { useShowsStore, telemetry, updateShow, auth, releaseWrite } from './homeAVoirRuntime';
import { markMovieWatched, markWatchRecordUnseen } from '../../src/features/watchlist/watchProgressActions';
import { markWatchCardEpisode } from '../../src/features/watchlist/watchCardResume';
import { markEpisodeWatched } from '../../src/features/shows/markEpisodeWatched';
import { getTodayStr } from '../../src/lib/utils';
import { useToastStore } from '../../src/store/toastStore';
import type { Show } from '../../src/types';
import { ToastContainer } from '../../src/components/ToastContainer';
import { writeUserScopedJson } from '../../src/lib/userIsolation';
Object.assign(window, { __homeAVoir: { telemetry, releaseWrite, empty: () => useShowsStore.setState({ shows: [] }), clearDismissed: () => writeUserScopedJson(auth.currentUser?.uid, 'home_dismissed_notifications', []), snapshot: () => useShowsStore.getState().shows, reset: () => window.dispatchEvent(new Event('watchlist-reset-all')), clear: () => useToastStore.getState().clearQueue(), toasts: () => [useToastStore.getState().currentToast, ...useToastStore.getState().queue].filter(Boolean) } });
function Harness() {
  const shows = useShowsStore(state => state.shows);
  const [tab, setTab] = useState<'watch_next' | 'upcoming' | 'history'>('watch_next');
  const [pending, setPending] = useState<{ type:'archive'|'drop'|'unfollow';item:Show }|null>(null);
  const watch = useRef<HTMLDivElement>(null), upcoming = useRef<HTMLDivElement>(null), history = useRef<HTMLDivElement>(null);
  const series = shows.filter(show => show.id.startsWith('series-') && !show.isArchived && show.status !== 'dropped' && show.seenEpisodes.length < 3);
  const mark = (show: Show) => markWatchCardEpisode(show, getTodayStr(), markEpisodeWatched);
  const open = (id: string, type?: string) => { telemetry.opens.push(`${type}:${id}`); };
  return <main style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}><WatchListView model={{
    onExplore: () => telemetry.opens.push('discover'), activeTab: tab, allShows: shows, continueWatchingShows: series.slice(0,3), nouveautesShows: series.slice(3,6), pasVuDepuisUnMomentShows: series.slice(6), filmsAVoirShows: shows.filter(show=>show.id.startsWith('movie-')&&!show.seenEpisodes.includes('movie')),
    upcomingShows: shows.filter(show=>show.id.startsWith('upcoming-')), loading:false, isQuotaExceeded:false,
    watchNextRef:watch, upcomingRef:upcoming, historyRef:history,
    scrollToSection: (_ref, next) => { setTab(next); document.getElementById('watchlist-container')?.scrollTo(0,0); },
    handleEpisodeClick: (show, season, episode)=>telemetry.opens.push(`${show.id}:${season}x${episode}`), handleEpisodeParentClick:()=>{},
    onShowClick:open, onShowClickProp:open, openPersonModal:()=>{},
    pendingAction:pending, setPendingAction:setPending, handleArchiveShow:show=>updateShow(show.id,{isArchived:true}), handleDropShow:show=>updateShow(show.id,{status:'dropped'}), executeUnfollow:show=>useShowsStore.setState({shows:shows.filter(item=>item.id!==show.id)}),
    expandedSection:null,handleToggleVoirTout:()=>{},visibleCount:3,setVisibleCount:()=>{},
    markNextEpisodeAsSeen:mark,markMovieAsSeen:show=>markMovieWatched(show,updateShow),markAsUnseen:(show,episode)=>markWatchRecordUnseen(show,episode,updateShow),
    selectedEpisodeModal:null,setSelectedEpisodeModal:()=>{},selectedPersonId:null,setSelectedPersonId:()=>{},
  }}/><ToastContainer /></main>;
}
createRoot(document.getElementById('root')!).render(<Harness key={auth.currentUser.uid}/>);
