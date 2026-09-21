import React, { startTransition, useState, useEffect, useRef, useMemo, useCallback, type RefObject } from 'react';
import { type Show } from '../types';
import { cn, getNextEpisodeNumber, scrollAllCarouselsToStart, checkIsUpToDate, getAiredProgress } from '../lib/utils';
import { ContinueWatchingCard } from '../components/cards/ContinueWatchingCard';
import { MovieWatchCard } from '../components/cards/MovieWatchCard';
import { ShowNewsFeed } from '../components/ShowNewsFeed';
import { UpToDateShowCard, getUpToDateOrNewSeasonCategory } from '../components/cards/UpToDateShowCard';
import { UpcomingShowCard, getUpcomingEpisodeInfo } from '../components/cards/UpcomingShowCard';
import { HistoryFeed } from '../components/HistoryFeed';
import { EpisodeDetailModal } from './EpisodeDetailModal';
import { PersonDetailModal } from './PersonDetailModal';
import { tmdb } from '../features/shows/tmdb';
import { markEpisodeWatched } from '../features/shows/markEpisodeWatched';
import { getFormattedProviderLogo } from '../utils/providerLogos';
import { User, Circle, CheckCircle2, Trash2, Archive, X, Clock, Ban } from 'lucide-react';
import { auth, db } from '../lib/firebase';
import { doc, setDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { SyncStatusIndicator } from '../components/SyncStatusIndicator';
import { useShows } from '../hooks/useShows';
import { useToastStore } from '../store/toastStore';
import { useSyncStore } from '../store/syncStore';
import { useShowsStore } from '../store/showsStore';
import { useLogStore } from '../store/logStore';
import { SwipeableCard } from '../components/cards/SwipeableCard';
import { SeenItLogo } from '../components/SeenItLogo';
import { SeenItCheckButton } from '../components/SeenItCheckButton';
import { useHorizontalVirtualWindow } from '../hooks/useBoundedVirtualWindow';
import { usePassiveWatchProvider } from '../hooks/usePassiveWatchProvider';
import { createWatchProviderRequestLimiter } from '../features/providers/watchProviderRequestPolicy';
import { createPassiveCardEnrichmentGate } from '../features/providers/passiveCardEnrichmentPolicy';
import { hasAiredEpisodeEvidence } from '../features/watchlist/watchAvailability';
import {
  ExpandedItemCard,
  ProgressiveWatchlistCarousel,
  WATCHLIST_BATCH_SIZE,
} from './watchListPresentation';

interface WatchListViewProps {
  model: Record<string, any>;
}

export function WatchListView({ model }: WatchListViewProps) {
  const { activeTab, allShows, continueWatchingShows, executeUnfollow, expandedSection, filmsAVoirShows, handleArchiveShow, handleDropShow, handleEpisodeClick, handleEpisodeParentClick, handleToggleVoirTout, historyRef, isQuotaExceeded, loading, markMovieAsSeen, markNextEpisodeAsSeen, nouveautesShows, onShowClick, onShowClickProp, openPersonModal, pasVuDepuisUnMomentShows, pendingAction, scrollToSection, selectedEpisodeModal, selectedPersonId, setPendingAction, setSelectedEpisodeModal, setSelectedPersonId, setVisibleCount, upcomingRef, upcomingShows, visibleCount, watchNextRef } = model;
  return (
    <div id="watchlist-container" className="flex-1 overflow-y-auto bg-transparent text-white pb-nav">
      <div className="sticky top-0 z-40 px-4 sm:px-6 pt-6 pb-4 flex flex-col gap-3 bg-zinc-950/60 backdrop-blur-xl">
        <div className="absolute top-0 left-0 w-72 h-40 bg-[#E5A93D]/15 blur-[120px] -z-10 rounded-full mix-blend-screen pointer-events-none" />
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 shrink-0">
            <SeenItLogo variant="horizontal" size={48} symbol="watch" animated />
          </div>
          <div className="min-w-0 flex-1 flex justify-end overflow-hidden">
            <SyncStatusIndicator />
          </div>
        </div>
        <div className="bg-zinc-900/70 p-1 rounded-2xl border border-white/10 flex w-full backdrop-blur-md shadow-inner">
          <button
            className={cn("flex-1 text-center py-2.5 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5", activeTab === 'watch_next' ? "bg-[#E5A93D] text-zinc-950 font-extrabold text-xs shadow-lg shadow-[#E5A93D]/20 scale-[1.01]" : "text-zinc-400 font-semibold text-xs hover:text-white hover:bg-white/5")}
            onClick={() => scrollToSection(watchNextRef, 'watch_next')}
          >
            <span>🍿</span>
            <span>À Regarder</span>
          </button>
          <button
            className={cn("flex-1 text-center py-2.5 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5", activeTab === 'upcoming' ? "bg-[#E5A93D] text-zinc-950 font-extrabold text-xs shadow-lg shadow-[#E5A93D]/20 scale-[1.01]" : "text-zinc-400 font-semibold text-xs hover:text-white hover:bg-white/5")}
            onClick={() => scrollToSection(upcomingRef, 'upcoming')}
          >
            <span>📅</span>
            <span>À Venir</span>
          </button>
          <button
            className={cn("flex-1 text-center py-2.5 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5", activeTab === 'history' ? "bg-[#E5A93D] text-zinc-950 font-extrabold text-xs shadow-lg shadow-[#E5A93D]/20 scale-[1.01]" : "text-zinc-400 font-semibold text-xs hover:text-white hover:bg-white/5")}
            onClick={() => scrollToSection(historyRef, 'history')}
          >
            <span>📜</span>
            <span>Historique</span>
          </button>
        </div>
      </div>

      <div className="pb-4 space-y-4">
        {isQuotaExceeded && (
          <div className="mx-4 sm:mx-6 mb-4 mt-2 p-4 bg-red-950/40 border border-red-500/20 rounded-2xl text-red-200 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold mb-1 flex items-center gap-2 text-red-400">
                <span>⚠️</span> Quota quotidien précédemment atteint
              </h3>
              <p className="text-xs leading-relaxed opacity-90">
                Le quota Firestore avait été atteint. Si vous venez de basculer sur la nouvelle base de données réinitialisée, vous pouvez réinitialiser cet avertissement.
              </p>
            </div>
            <button
              onClick={() => useSyncStore.getState().resetQuotaError()}
              className="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-200 font-semibold rounded-xl text-xs transition-colors shrink-0"
            >
              Réessayer
            </button>
          </div>
        )}

        {loading ? (
          <div className="space-y-6 pt-2 pb-nav">
            <div className="mb-8 mt-4">
              <div className="flex items-center gap-2 mb-4 px-4 sm:px-6">
                <div className="h-6 w-6 bg-zinc-800 rounded-full animate-pulse" />
                <div className="h-6 w-40 bg-zinc-800 rounded animate-pulse" />
              </div>
              <div className="flex overflow-x-auto gap-4 px-4 sm:px-6 hide-scrollbar pb-4">
                {[1, 2].map(i => (
                  <div key={i} className="w-[280px] shrink-0 h-[120px] bg-zinc-900 rounded-2xl border border-white/5 animate-pulse" />
                ))}
              </div>
            </div>

            <div className="mb-6 mt-1">
              <div className="flex items-center justify-between mb-4 px-4 sm:px-6">
                <div className="h-7 w-48 bg-zinc-800 rounded animate-pulse" />
                <div className="h-4 w-12 bg-zinc-800 rounded animate-pulse" />
              </div>
              <div className="flex overflow-x-auto gap-4 px-4 sm:px-6 hide-scrollbar pb-1">
                {[1, 2, 3].map(i => (
                  <div key={i} className="w-64 shrink-0 flex flex-col">
                    <div className="w-full aspect-[4/3] rounded-2xl bg-zinc-900 animate-pulse mb-3" />
                    <div className="h-3 w-3/4 bg-zinc-800 rounded-full animate-pulse mb-1.5" />
                    <div className="h-4 w-1/2 bg-zinc-800 rounded-full animate-pulse" />
                  </div>
                ))}
              </div>
            </div>

            <div className="mb-6 mt-1">
              <div className="flex items-center justify-between mb-4 px-4 sm:px-6">
                <div className="h-7 w-48 bg-zinc-800 rounded animate-pulse" />
                <div className="h-4 w-12 bg-zinc-800 rounded animate-pulse" />
              </div>
              <div className="flex overflow-x-auto gap-4 px-4 sm:px-6 hide-scrollbar pb-1">
                {[1, 2, 3].map(i => (
                  <div key={i} className="w-64 shrink-0 flex flex-col">
                    <div className="w-full aspect-[4/3] rounded-2xl bg-zinc-900 animate-pulse mb-3" />
                    <div className="h-3 w-3/4 bg-zinc-800 rounded-full animate-pulse mb-1.5" />
                    <div className="h-4 w-1/2 bg-zinc-800 rounded-full animate-pulse" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div ref={watchNextRef} className="scroll-mt-36">
          <ShowNewsFeed onShowClick={onShowClickProp} onNavigateToShow={onShowClickProp} />

          {continueWatchingShows.length > 0 && (
            <div className="mt-1">
              <div className="flex items-center justify-between mb-2 px-4 sm:px-6">
                <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                  <span className="text-lg">⏯️</span>
                  <span>Continuer à regarder</span>
                </h2>
                <button
                  onClick={() => handleToggleVoirTout('continueWatching')}
                  className="text-xs font-bold text-[#E5A93D] hover:underline cursor-pointer"
                >
                  {expandedSection === 'continueWatching' ? 'Réduire' : 'Voir tout'}
                </button>
              </div>

              {expandedSection === 'continueWatching' ? (
                <div className="flex flex-col gap-3 my-2 px-4 sm:px-6">
                  {continueWatchingShows.slice(0, visibleCount).map((show) => (
                    <SwipeableCard
                      key={`cw_exp_${show.id}`}
                      onSwipeLeft={() => setPendingAction({ type: 'unfollow', item: show })}
                      onSwipeRight={() => setPendingAction({ type: 'drop', item: show })}
                    >
                      <ExpandedItemCard
                        show={show}
                        sectionType="watchNext"
                        onShowClick={onShowClick}
                        onEpisodeClick={handleEpisodeClick}
                        onMarkAsSeen={markNextEpisodeAsSeen}
                        onPersonClick={openPersonModal}
                      />
                    </SwipeableCard>
                  ))}
                  {visibleCount < continueWatchingShows.length && (
                    <button
                      onClick={() => setVisibleCount(prev => prev + WATCHLIST_BATCH_SIZE)}
                      className="w-full py-3.5 mt-2 bg-zinc-900 border border-white/10 rounded-2xl text-xs font-bold text-zinc-300 hover:bg-zinc-800 active:scale-[0.98] transition-all"
                    >
                      Charger plus
                    </button>
                  )}
                </div>
              ) : (
                <ProgressiveWatchlistCarousel
                  id="continue-watching-carousel"
                  data={continueWatchingShows}
                  renderCard={(show) => (
                    <ContinueWatchingCard
                      key={`cw_${show.id}`}
                      show={show}
                      onShowClick={onShowClick}
                      onEpisodeClick={handleEpisodeClick}
                      onMarkAsSeen={markNextEpisodeAsSeen}
                    />
                  )}
                />
              )}
            </div>
          )}

          {nouveautesShows.length > 0 && (
            <div className="mt-8">
              <div className="flex items-center justify-between mb-2 px-4 sm:px-6">
                <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                  <span className="text-lg">✨</span>
                  <span>Nouveautés</span>
                </h2>
                <button
                  onClick={() => handleToggleVoirTout('nouveautes')}
                  className="text-xs font-bold text-[#E5A93D] hover:underline cursor-pointer"
                >
                  {expandedSection === 'nouveautes' ? 'Réduire' : 'Voir tout'}
                </button>
              </div>

              {expandedSection === 'nouveautes' ? (
                <div className="flex flex-col gap-3 my-2 px-4 sm:px-6">
                  {nouveautesShows.slice(0, visibleCount).map((show) => (
                    <SwipeableCard
                      key={`nouveautes_swipe_${show.id}`}
                      onSwipeLeft={() => setPendingAction({ type: 'unfollow', item: show })}
                      onSwipeRight={() => setPendingAction({ type: 'drop', item: show })}
                    >
                      <ExpandedItemCard
                        show={show}
                        sectionType="watchNext"
                        onShowClick={onShowClick}
                        onEpisodeClick={handleEpisodeClick}
                        onMarkAsSeen={markNextEpisodeAsSeen}
                        onPersonClick={openPersonModal}
                      />
                    </SwipeableCard>
                  ))}
                  {visibleCount < nouveautesShows.length && (
                    <button
                      onClick={() => setVisibleCount(prev => prev + WATCHLIST_BATCH_SIZE)}
                      className="w-full py-3.5 mt-2 bg-zinc-900 border border-white/10 rounded-2xl text-xs font-bold text-zinc-300 hover:bg-zinc-800 active:scale-[0.98] transition-all"
                    >
                      Charger plus
                    </button>
                  )}
                </div>
              ) : (
                <ProgressiveWatchlistCarousel
                  id="nouveautes-carousel"
                  data={nouveautesShows}
                  renderCard={(show) => (
                    <ContinueWatchingCard
                      key={`nouveautes_card_${show.id}`}
                      show={show}
                      onShowClick={onShowClick}
                      onEpisodeClick={handleEpisodeClick}
                      onMarkAsSeen={markNextEpisodeAsSeen}
                    />
                  )}
                />
              )}
            </div>
          )}

          {pasVuDepuisUnMomentShows.length > 0 && (
            <div className="mt-8">
              <div className="flex items-center justify-between mb-2 px-4 sm:px-6">
                <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                  <span className="text-lg">⏳</span>
                  <span>Pas vu depuis un moment</span>
                </h2>
                <button
                  onClick={() => handleToggleVoirTout('notWatched')}
                  className="text-xs font-bold text-[#E5A93D] hover:underline cursor-pointer"
                >
                  {expandedSection === 'notWatched' ? 'Réduire' : 'Voir tout'}
                </button>
              </div>

              {expandedSection === 'notWatched' ? (
                <div className="flex flex-col gap-3 my-2 px-4 sm:px-6">
                  {pasVuDepuisUnMomentShows.slice(0, visibleCount).map((show) => (
                    <SwipeableCard
                      key={`notwatched_swipe_${show.id}`}
                      onSwipeLeft={() => setPendingAction({ type: 'unfollow', item: show })}
                      onSwipeRight={() => setPendingAction({ type: 'drop', item: show })}
                    >
                      <ExpandedItemCard
                        show={show}
                        sectionType="notWatched"
                        onShowClick={onShowClick}
                        onEpisodeClick={handleEpisodeClick}
                        onMarkAsSeen={markNextEpisodeAsSeen}
                        onPersonClick={openPersonModal}
                      />
                    </SwipeableCard>
                  ))}
                  {visibleCount < pasVuDepuisUnMomentShows.length && (
                    <button
                      onClick={() => setVisibleCount(prev => prev + WATCHLIST_BATCH_SIZE)}
                      className="w-full py-3.5 mt-2 bg-zinc-900 border border-white/10 rounded-2xl text-xs font-bold text-zinc-300 hover:bg-zinc-800 active:scale-[0.98] transition-all"
                    >
                      Charger plus
                    </button>
                  )}
                </div>
              ) : (
                <ProgressiveWatchlistCarousel
                  id="pas-vu-depuis-un-moment-carousel"
                  data={pasVuDepuisUnMomentShows}
                  renderCard={(show) => (
                    <ContinueWatchingCard
                      key={`notwatched_card_${show.id}`}
                      show={show}
                      onShowClick={onShowClick}
                      onEpisodeClick={handleEpisodeClick}
                      onMarkAsSeen={markNextEpisodeAsSeen}
                    />
                  )}
                />
              )}
            </div>
          )}

          {filmsAVoirShows.length > 0 && (
            <div className="mt-8">
              <div className="flex items-center justify-between mb-2 px-4 sm:px-6">
                <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                  <span className="text-lg">🎬</span>
                  <span>Films à voir</span>
                </h2>
                <button
                  onClick={() => handleToggleVoirTout('filmsAVoir')}
                  className="text-xs font-bold text-[#E5A93D] hover:underline cursor-pointer"
                >
                  {expandedSection === 'filmsAVoir' ? 'Réduire' : 'Voir tout'}
                </button>
              </div>

              {expandedSection === 'filmsAVoir' ? (
                <div className="flex flex-col gap-3 my-2 px-4 sm:px-6">
                  {filmsAVoirShows.slice(0, visibleCount).map((show) => (
                    <SwipeableCard
                      key={`films_swipe_${show.id}`}
                      onSwipeLeft={() => setPendingAction({ type: 'unfollow', item: show })}
                      onSwipeRight={() => setPendingAction({ type: 'drop', item: show })}
                    >
                      <ExpandedItemCard
                        show={show}
                        sectionType="watchNext"
                        onShowClick={onShowClick}
                        onEpisodeClick={handleEpisodeClick}
                        onMarkAsSeen={markMovieAsSeen}
                        onPersonClick={openPersonModal}
                      />
                    </SwipeableCard>
                  ))}
                  {visibleCount < filmsAVoirShows.length && (
                    <button
                      onClick={() => setVisibleCount(prev => prev + WATCHLIST_BATCH_SIZE)}
                      className="w-full py-3.5 mt-2 bg-zinc-900 border border-white/10 rounded-2xl text-xs font-bold text-zinc-300 hover:bg-zinc-800 active:scale-[0.98] transition-all"
                    >
                      Charger plus
                    </button>
                  )}
                </div>
              ) : (
                <ProgressiveWatchlistCarousel
                  id="films-a-voir-carousel"
                  data={filmsAVoirShows}
                  renderCard={(show) => (
                    <MovieWatchCard
                      key={`films_card_${show.id}`}
                      show={show}
                      onShowClick={onShowClick}
                      onMarkAsSeen={markMovieAsSeen}
                    />
                  )}
                />
              )}
            </div>
          )}

          {continueWatchingShows.length === 0 && nouveautesShows.length === 0 && pasVuDepuisUnMomentShows.length === 0 && filmsAVoirShows.length === 0 && (
            <div className="py-8 text-center text-zinc-500 text-sm px-4 sm:px-6">
              Rien à afficher dans À Regarder pour le moment.
            </div>
          )}
        </div>

        <div ref={upcomingRef} className="scroll-mt-36 px-4 sm:px-6 mt-8">
          <h2 className="text-xl font-bold text-white mb-2 tracking-tight flex items-center gap-2">
            <span className="text-lg">📅</span>
            <span>À Venir</span>
          </h2>
          {upcomingShows.length > 0 ? (
            <div className="space-y-3">
              {upcomingShows.map((show, idx) => (
                <SwipeableCard
                  key={`upcoming_swipe_${show.id}_${idx}`}
                  onSwipeLeft={() => setPendingAction({ type: 'unfollow', item: show })}
                  onSwipeRight={() => setPendingAction({ type: 'drop', item: show })}
                >
                  <UpcomingShowCard
                    show={show}
                    onShowClick={onShowClick}
                    onEpisodeClick={handleEpisodeClick}
                  />
                </SwipeableCard>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center text-zinc-500 text-sm">
              Aucun épisode à venir.
            </div>
          )}
        </div>

        <div ref={historyRef} className="scroll-mt-36 px-4 sm:px-6 mt-8">
          <h2 className="text-xl font-bold text-white mb-2 tracking-tight flex items-center gap-2">
            <span className="text-lg">📜</span>
            <span>Historique</span>
          </h2>
          <HistoryFeed
            onShowClick={onShowClick}
            onEpisodeClick={(showId, season, episode) => {
              const show = allShows?.find(s => s.id === showId || s.tmdbId?.toString() === showId);
              if (show) {
                handleEpisodeClick(show, season, episode);
              } else if (onShowClick) {
                onShowClick(showId, 'tv');
              }
            }}
          />
        </div>
        </>
        )}
      </div>

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
        <div
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
                  onPointerUp={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const item = pendingAction.item;
                    handleDropShow(item);
                    setTimeout(() => {
                      setPendingAction(null);
                    }, 100);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
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
                  onPointerUp={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const item = pendingAction.item;
                    handleArchiveShow(item);
                    setTimeout(() => {
                      setPendingAction(null);
                    }, 100);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
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
                  onPointerUp={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const item = pendingAction.item;
                    executeUnfollow(item);
                    setTimeout(() => {
                      setPendingAction(null);
                    }, 100);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
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
              }}
              className="w-full py-3 rounded-xl bg-zinc-800 text-zinc-300 font-bold [@media(hover:hover)]:hover:bg-zinc-700 active:bg-zinc-700 mb-2 active:scale-95 transition-all cursor-pointer touch-manipulation select-none"
            >
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
