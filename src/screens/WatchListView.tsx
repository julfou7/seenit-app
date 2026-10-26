import React, { Activity, startTransition, useEffect, useRef, useState, type RefObject } from 'react';
import type { Show } from '../types';
import { WatchNextSection } from './WatchNextSection';
import { DialogLayer } from '../components/ui/DialogLayer';
import type { SeriesCardAction } from '../components/cards/SeriesEpisodeCard';
import { UpcomingShowCard, getUpcomingEpisodeInfo } from '../components/cards/UpcomingShowCard';
import { HistoryFeed } from '../components/HistoryFeed';
import { HomeNotifications } from '../components/HomeNotifications';
import { EpisodeDetailModal } from './EpisodeDetailModal';
import { PersonDetailModal } from './PersonDetailModal';
import { useSyncStore } from '../store/syncStore';
import { HomeSyncIndicator } from '../components/HomeSyncIndicator';
import { auth } from '../lib/firebase';
import { getTodayStr } from '../lib/utils';
import { HOME_TABS, upcomingGroup } from '../features/watchlist/homePresentation';
import { Trash2, Archive, Ban } from 'lucide-react';
import { type EpisodeDetailData } from './episodeDetailTypes';
import './watchListHome.css';

type WatchListTab = 'watch_next' | 'upcoming' | 'history';
type WatchListPendingAction = { type: 'archive' | 'unfollow' | 'drop'; item: Show } | null;
type SelectedEpisodeModal = { show: Show; season: number; episode: EpisodeDetailData; isHydrating: boolean };

interface WatchListViewModel {
  onExplore?: () => void;
  activeTab: WatchListTab;
  allShows: Show[];
  continueWatchingShows: Show[];
  executeUnfollow: (show: Show) => void | Promise<void>;
  expandedSection: string | null;
  filmsAVoirShows: Show[];
  handleArchiveShow: (show: Show) => void | Promise<void>;
  handleDropShow: (show: Show) => void | Promise<void>;
  handleEpisodeClick: (show: Show, seasonNumber: number, episodeNumber: number) => void;
  handleEpisodeParentClick: (show: Show, tmdbId: number) => void;
  handleToggleVoirTout: (sectionKey: string) => void;
  historyRef: RefObject<HTMLDivElement>;
  isQuotaExceeded: boolean;
  loading: boolean;
  markMovieAsSeen: (show: Show) => void | Promise<void | boolean>;
  markNextEpisodeAsSeen: (show: Show) => void | Promise<void | boolean>;
  markAsUnseen: (show: Show, episode: import('../features/watchlist/seriesCardPresentation').SeriesCardEpisode | null) => Promise<void | boolean>;
  nouveautesShows: Show[];
  onShowClick: (id: string, mediaType?: 'tv' | 'movie') => void;
  onShowClickProp: (id: string, mediaType?: 'tv' | 'movie') => void;
  openPersonModal: (personId: number) => void;
  pasVuDepuisUnMomentShows: Show[];
  pendingAction: WatchListPendingAction;
  scrollToSection: (ref: RefObject<HTMLDivElement>, tab: WatchListTab) => void;
  selectedEpisodeModal: SelectedEpisodeModal | null;
  selectedPersonId: number | null;
  setPendingAction: React.Dispatch<React.SetStateAction<WatchListPendingAction>>;
  setSelectedEpisodeModal: React.Dispatch<React.SetStateAction<SelectedEpisodeModal | null>>;
  setSelectedPersonId: React.Dispatch<React.SetStateAction<number | null>>;
  setVisibleCount: React.Dispatch<React.SetStateAction<number>>;
  upcomingRef: RefObject<HTMLDivElement>;
  upcomingShows: Show[];
  visibleCount: number;
  watchNextRef: RefObject<HTMLDivElement>;
}

interface WatchListViewProps {
  model: WatchListViewModel;
}

export function WatchListView({ model }: WatchListViewProps) {
  const { onExplore, activeTab, allShows, continueWatchingShows, executeUnfollow, expandedSection, filmsAVoirShows, handleArchiveShow, handleDropShow, handleEpisodeClick, handleEpisodeParentClick, handleToggleVoirTout, historyRef, isQuotaExceeded, loading, markMovieAsSeen, markNextEpisodeAsSeen, markAsUnseen, nouveautesShows, onShowClick, onShowClickProp, openPersonModal, pasVuDepuisUnMomentShows, pendingAction, scrollToSection, selectedEpisodeModal, selectedPersonId, setPendingAction, setSelectedEpisodeModal, setSelectedPersonId, setVisibleCount, upcomingRef, upcomingShows, visibleCount, watchNextRef } = model;
  const seriesActions = (show: Show): SeriesCardAction[] => [
    { label: 'Archiver la série', onSelect: () => setPendingAction({ type: 'archive', item: show }) },
    { label: 'Abandonner la série', onSelect: () => setPendingAction({ type: 'drop', item: show }) },
    { label: 'Retirer du suivi', destructive: true, onSelect: () => setPendingAction({ type: 'unfollow', item: show }) },
  ];
  const [online, setOnline] = useState(() => navigator.onLine);
  const [today, setToday] = useState(() => getTodayStr());
  const [mountedHomeTabs, setMountedHomeTabs] = useState(() => new Set<WatchListTab>(['watch_next', activeTab]));
  useEffect(() => {
    if (mountedHomeTabs.has(activeTab)) return;
    startTransition(() => {
      setMountedHomeTabs(previous => {
        if (previous.has(activeTab)) return previous;
        const next = new Set(previous);
        next.add(activeTab);
        return next;
      });
    });
  }, [activeTab, mountedHomeTabs]);
  useEffect(() => {
    const timer = setInterval(() => setToday(getTodayStr()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const tabButtons = useRef<Array<HTMLButtonElement | null>>([]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  const refs = { watch_next: watchNextRef, upcoming: upcomingRef, history: historyRef };
  const upcomingGroups = ['Aujourd’hui', 'Cette semaine', 'Plus tard'].map(label => ({ label, shows: upcomingShows.filter(show => {
    const episode = getUpcomingEpisodeInfo(show);
    return episode && upcomingGroup(episode.air_date, today) === label;
  }) }));
  return (
    <div id="watchlist-container" className="home-watchlist flex-1 overflow-y-auto text-white pb-nav">
      <header className="home-header">
        <div className="home-header__top"><span className="home-wordmark"><img src="/brand/seenit-logo-sombre.svg" alt="SeenIt" width="148" height="48" /></span>
          <div className="home-header__tools"><HomeSyncIndicator /><HomeNotifications key={auth.currentUser?.uid || 'anonymous'} shows={allShows} onOpen={onShowClick} onSeen={show => show.mediaType === 'movie' ? markMovieAsSeen(show) : markNextEpisodeAsSeen(show)} /></div>
        </div>
        <div className="home-tabs" role="tablist" aria-label="À voir">
          {HOME_TABS.map((tab, index) => <button key={tab.id} ref={element => { tabButtons.current[index] = element; }} type="button" id={`home-tab-${tab.id}`} role="tab" aria-selected={activeTab === tab.id} aria-controls={`home-panel-${tab.id}`} tabIndex={activeTab === tab.id ? 0 : -1} onClick={() => scrollToSection(refs[tab.id], tab.id)} onKeyDown={event => {
            const next = event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : null;
            if (next === null) return;
            event.preventDefault(); scrollToSection(refs[HOME_TABS[next].id], HOME_TABS[next].id); tabButtons.current[next]?.focus();
          }}>{tab.label}</button>)}
        </div>
      </header>
      {!online && <p className="home-offline" role="status">Hors ligne · votre bibliothèque en cache reste accessible.</p>}
      {isQuotaExceeded && <p className="home-offline" role="status">Synchronisation en pause. <button type="button" onClick={() => useSyncStore.getState().resetQuotaError()}>Réessayer</button></p>}
      {loading ? <div className="home-skeleton" role="status" aria-label="Chargement de votre bibliothèque">{[0, 1, 2].map(index => <div key={index}><span /><div /></div>)}</div> : <>
        <div ref={watchNextRef} id="home-panel-watch_next" role="tabpanel" aria-labelledby="home-tab-watch_next" hidden={activeTab !== 'watch_next'} tabIndex={0}>
          <WatchNextSection onPerson={openPersonModal} onOpenMedia={(id, type) => onShowClickProp(String(id), type)} onExplore={onExplore} key={auth.currentUser?.uid || 'anonymous'} allShows={allShows} groups={[continueWatchingShows, nouveautesShows, pasVuDepuisUnMomentShows]} movies={filmsAVoirShows} active={activeTab === 'watch_next'} onOpen={onShowClick} onEpisode={handleEpisodeClick} onMarkSeries={markNextEpisodeAsSeen} onMarkMovie={markMovieAsSeen} onUnseen={markAsUnseen} actions={seriesActions} />
        </div>
        <div ref={upcomingRef} id="home-panel-upcoming" role="tabpanel" aria-labelledby="home-tab-upcoming" hidden={activeTab !== 'upcoming'} tabIndex={0} className="home-panel-content">
          {activeTab === 'upcoming' && !mountedHomeTabs.has('upcoming') && <div className="home-skeleton" role="status" aria-label="Chargement de À venir"><div><span /><div /></div></div>}
          {mountedHomeTabs.has('upcoming') && <Activity mode={activeTab === 'upcoming' ? 'visible' : 'hidden'}>
            {upcomingShows.length ? upcomingGroups.filter(group => group.shows.length).map(group => <section key={group.label} className="home-upcoming-group"><h2><span className="home-section-name">{group.label}</span></h2>{group.shows.map(show => <UpcomingShowCard key={show.id} show={show} onShowClick={onShowClick} onEpisodeClick={handleEpisodeClick} actions={seriesActions(show)} />)}</section>) : <div className="home-empty"><h2>Rien de prévu pour le moment</h2><p>Les prochaines sorties de vos films et séries suivis apparaîtront ici.</p>{onExplore && <button type="button" className="home-explore" onClick={onExplore}>Explorer</button>}</div>}
          </Activity>}
        </div>
        <div ref={historyRef} id="home-panel-history" role="tabpanel" aria-labelledby="home-tab-history" hidden={activeTab !== 'history'} tabIndex={0} className="home-panel-content">
          {activeTab === 'history' && !mountedHomeTabs.has('history') && <div className="home-skeleton" role="status" aria-label="Chargement de l’historique"><div><span /><div /></div></div>}
          {mountedHomeTabs.has('history') && <Activity mode={activeTab === 'history' ? 'visible' : 'hidden'}>
            <HistoryFeed onExplore={onExplore} onShowClick={onShowClick} onEpisodeClick={(showId, season, episode) => {
              const show = allShows.find(item => item.id === showId || String(item.tmdbId) === showId);
              if (show) handleEpisodeClick(show, season, episode); else onShowClick(showId, 'tv');
            }} />
          </Activity>}
        </div>
      </>}

      {selectedEpisodeModal && (
        <EpisodeDetailModal
          show={selectedEpisodeModal.show}
          season={selectedEpisodeModal.season}
          episode={selectedEpisodeModal.episode}
          isHydrating={selectedEpisodeModal.isHydrating}
          tmdbShowTitle={selectedEpisodeModal.show.title}
          tmdbShowId={selectedEpisodeModal.show.tmdbId}
          onShowClick={(tmdbId) => {
            handleEpisodeParentClick(selectedEpisodeModal.show, tmdbId);
          }}
          onClose={() => {
            setSelectedEpisodeModal(null);
            if (window.history.state?.isEpisodeDetailModal || window.history.state?.isModal) {
              window.history.back();
            }
          }}
        />
      )}

      {selectedPersonId && (
        <PersonDetailModal
          personId={selectedPersonId}
          onClose={() => {
            setSelectedPersonId(null);
            if (window.history.state?.isPersonDetailModal || window.history.state?.isModal) {
              window.history.back();
            }
          }}
          onShowClick={(tmdbId, mediaType) => {
            setSelectedPersonId(null);
            if (window.history.state?.isPersonDetailModal || window.history.state?.isModal) {
              window.history.back();
            }
            setTimeout(() => {
              if (onShowClick) {
                onShowClick(String(tmdbId), mediaType);
              }
            }, 50);
          }}
        />
      )}

      {pendingAction && (
        <DialogLayer onDismiss={() => setPendingAction(null)} label="Confirmer l’action" historyMode="local" role="alertdialog"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setPendingAction(null);
            }
          }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            className="bg-zinc-900 border border-white/10 rounded-3xl p-6 w-full max-w-sm shadow-2xl flex flex-col items-center text-center"
          >
            {pendingAction.type === 'drop' ? (
              <>
                <div className="w-14 h-14 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center mb-4">
                  <Ban size={28} />
                </div>
                <h3 className="text-base font-bold text-white mb-2">Abandonner la série ?</h3>
                <p className="text-xs text-zinc-400 mb-6 leading-relaxed">
                  Voulez-vous vraiment marquer <strong className="text-white">{pendingAction.item.title}</strong> comme abandonnée ? Elle sera déplacée dans vos séries abandonnées.
                </p>
                <button
                  type="button"
                  onClick={async event => {
                    event.stopPropagation();
                    const item = pendingAction.item;
                    setPendingAction(null);
                    await handleDropShow(item);
                  }}
                  className="w-full py-3 rounded-xl bg-amber-500/20 text-amber-400 font-bold border border-amber-500/30 [@media(hover:hover)]:hover:bg-amber-500/30 active:bg-amber-500/30 mb-2 active:scale-95 transition-all cursor-pointer touch-manipulation select-none"
                >
                  Marquer comme abandonnée
                </button>
              </>
            ) : pendingAction.type === 'archive' ? (
              <>
                <div className="w-14 h-14 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center mb-4">
                  <Archive size={28} />
                </div>
                <h3 className="text-base font-bold text-white mb-2">Archiver cette série ?</h3>
                <p className="text-xs text-zinc-400 mb-6">
                  <strong className="text-white">{pendingAction.item.title}</strong> sera déplacée dans vos archives.
                </p>
                <button
                  type="button"
                  onClick={async event => {
                    event.stopPropagation();
                    const item = pendingAction.item;
                    setPendingAction(null);
                    await handleArchiveShow(item);
                  }}
                  className="w-full py-3 rounded-xl bg-blue-500/20 text-blue-400 font-bold border border-blue-500/30 [@media(hover:hover)]:hover:bg-blue-500/30 active:bg-blue-500/30 mb-2 active:scale-95 transition-all cursor-pointer touch-manipulation select-none"
                >
                  Confirmer l'archivage
                </button>
              </>
            ) : (
              <>
                <div className="w-14 h-14 rounded-full bg-red-500/20 text-red-500 flex items-center justify-center mb-4">
                  <Trash2 size={28} />
                </div>
                <h3 className="text-base font-bold text-white mb-2">Supprimer la série ?</h3>
                <p className="text-xs text-zinc-400 mb-6 leading-relaxed">
                  Voulez-vous vraiment supprimer <strong className="text-white">{pendingAction.item.title}</strong> de votre suivi ?
                  {((pendingAction.item.seenEpisodes && pendingAction.item.seenEpisodes.length > 0) ||
                    (pendingAction.item.episodeRecords && Object.keys(pendingAction.item.episodeRecords).length > 0)) && (
                    <span className="block mt-2 text-red-400 font-semibold">⚠️ Votre progression de visionnage sera réinitialisée.</span>
                  )}
                </p>
                <button
                  type="button"
                  onClick={async event => {
                    event.stopPropagation();
                    const item = pendingAction.item;
                    setPendingAction(null);
                    await executeUnfollow(item);
                  }}
                  className="w-full py-3 rounded-xl bg-red-500/20 text-red-500 font-bold border border-red-500/30 [@media(hover:hover)]:hover:bg-red-500/30 active:bg-red-500/30 mb-2 active:scale-95 transition-all cursor-pointer touch-manipulation select-none"
                >
                  Supprimer
                </button>
              </>
            )}

            <button
              type="button"
              onPointerUp={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setTimeout(() => {
                  setPendingAction(null);
                }, 100);
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (e.detail === 0) setPendingAction(null);
              }}
              data-dialog-initial-focus
              className="w-full py-3 rounded-xl bg-zinc-800 text-zinc-300 font-bold [@media(hover:hover)]:hover:bg-zinc-700 active:bg-zinc-700 mb-2 active:scale-95 transition-all cursor-pointer touch-manipulation select-none"
            >
              Annuler
            </button>
          </div>
        </DialogLayer>
      )}
    </div>
  );
}
