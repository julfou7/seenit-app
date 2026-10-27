import { useSyncStore } from '../../src/store/syncStore';
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WatchListView } from '../../src/screens/WatchListView';
import { WatchListScreen } from '../../src/screens/WatchListScreen';
import { useShowsStore, telemetry, updateShow, auth, releaseWrite, addProgressExamples, advanceClock, makeLargeHistory } from './homeAVoirRuntime';
import { markMovieWatched, markWatchRecordUnseen } from '../../src/features/watchlist/watchProgressActions';
import { markWatchCardEpisode } from '../../src/features/watchlist/watchCardResume';
import { markEpisodeWatched } from '../../src/features/shows/markEpisodeWatched';
import { getTodayStr } from '../../src/lib/utils';
import { useToastStore } from '../../src/store/toastStore';
import type { Show } from '../../src/types';
import { BottomNav } from '../../src/components/BottomNav';
import { reminderControl, terrain221Examples, terrain223Examples, terrain224Examples, terrain226CalendarExamples, historyUnseenControl } from './homeAVoirRuntime';
import { SplashScreen } from '../../src/components/SplashScreen';
import { ToastContainer } from '../../src/components/ToastContainer';
import { writeUserScopedJson } from '../../src/lib/userIsolation';
Object.assign(window, { __homeAVoir: { terrain223Examples, report: (progress: unknown) => writeUserScopedJson(auth.currentUser?.uid, 'plex_last_sync_report_v1', {message:'Synchronisation Plex incomplète — nouvel essai requis',progress}), progress: (progress: unknown) => useSyncStore.getState().setPlexSyncStatus({message:"Analyse Plex",progress} as Parameters<ReturnType<typeof useSyncStore.getState>["setPlexSyncStatus"]>[0]), auth, reminderControl, terrain221Examples, examples:addProgressExamples, sync: (message:string|null) => useSyncStore.getState().setPlexSyncStatus(message?{message}:null), telemetry, releaseWrite, empty: () => useShowsStore.setState({ shows: [] }), clearDismissed: () => writeUserScopedJson(auth.currentUser?.uid, 'home_dismissed_notifications', []), snapshot: () => useShowsStore.getState().shows, reset: () => window.dispatchEvent(new Event('watchlist-reset-all')), clear: () => useToastStore.getState().clearQueue(), toasts: () => [useToastStore.getState().currentToast, ...useToastStore.getState().queue].filter(Boolean) } });
const motionControl = { open: (_ready: boolean) => {}, ready: () => {}, closed: 0 };
Object.assign(window, { __homeLargeHistory: makeLargeHistory });
Object.assign(window, { __historyUnseen: { control: historyUnseenControl, setup: () => {
  useShowsStore.setState(state => ({ shows: [...state.shows.filter(show => show.id !== 'series-0'), {
    ...state.shows.find(show => show.mediaType === 'tv')!, id: 'series-0', tmdbId: 10,
    title: 'A Knight of the Seven Kingdoms', seasonsCache: undefined,
    seenEpisodes: ['1x1'], episodeRecords: { '1x1': { watchedAt: Date.now() + 1000, episodeTitle: 'Le chevalier errant' } },
    nextEpisodeToWatch: { season_number: 1, episode_number: 2, name: 'Bœuf salé', episode_count: 6, air_date: '2020-01-01' },
  }] }));
} } });
Object.assign(window, { __homeInteractionExamples: () => {
  const shows = useShowsStore.getState().shows;
  const seed = shows.find(show => show.id === 'series-0')!;
  const watchedAt = Date.now() - 100 * 86_400_000;
  useShowsStore.setState({ shows: [
    ...shows.filter(show => !show.id.startsWith('series-')),
    ...Array.from({ length: 20 }, (_, index): Show => ({ ...seed, id: `series-stale-${index}`, tmdbId: 90_000 + index,
      title: `Ancienne série ${index}`, createdAt: watchedAt, updatedAt: watchedAt, lastWatchedAt: watchedAt,
      seenEpisodes: index < 8 ? ['1x1'] : [], episodeRecords: index < 8 ? { '1x1': { watchedAt } } : {},
      nextEpisodeToWatch: { ...seed.nextEpisodeToWatch!, air_date: '2020-01-01' },
    })),
  ] });
} });
Object.assign(window, { __terrain224: { examples: terrain224Examples, splash: motionControl }, __terrain226: { calendar: terrain226CalendarExamples, advanceClock } });
function Harness() {
  const [splash, setSplash] = useState<{ready:boolean;key:number} | null>(null);
  useEffect(() => {
    motionControl.open = ready => setSplash(previous => ({ready,key:(previous?.key || 0)+1}));
    motionControl.ready = () => setSplash(previous => previous && {...previous,ready:true});
  }, []);
  const shows = useShowsStore(state => state.shows);
  const [tab, setTab] = useState<'watch_next' | 'upcoming' | 'history'>('watch_next');
  const [pending, setPending] = useState<{ type:'archive'|'drop'|'unfollow';item:Show }|null>(null);
  const watch = useRef<HTMLDivElement>(null), upcoming = useRef<HTMLDivElement>(null), history = useRef<HTMLDivElement>(null);
  const series = shows.filter(show => show.id.startsWith('series-') && !show.isArchived && show.status !== 'dropped' && show.seenEpisodes.length < 3);
  const mark = (show: Show) => markWatchCardEpisode(show, getTodayStr(), markEpisodeWatched);
  const open = (id: string, type?: string) => { telemetry.opens.push(`${type}:${id}`); };
  return <main style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>{splash && <SplashScreen key={splash.key} isReady={splash.ready} onComplete={()=>{motionControl.closed++;setSplash(null);}} />}<WatchListView model={{
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
  }}/><ToastContainer /><BottomNav currentTab="watchlist" onTabChange={()=>{}} onLongPress={()=>{}} /></main>;
}
function ProductionHarness() {
  return <main style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
    <WatchListScreen onShowClick={(id, type) => telemetry.opens.push(`${type}:${id}`)} />
    <ToastContainer /><BottomNav currentTab="watchlist" onTabChange={()=>{}} onLongPress={()=>{}} />
  </main>;
}
createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).has('production') ? <ProductionHarness /> : <Harness key={auth.currentUser.uid}/>);
