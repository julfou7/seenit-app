import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Search, Plus, Check, WifiOff, Star, X,
  SlidersHorizontal, ArrowUp, ArrowDown, Film, Tv, Users, User,
  Info, Sparkles, ChevronRight, ChevronDown, CheckCircle, CheckCircle2, Play, Archive, XCircle,
  Ticket, MonitorPlay, Flame, Loader2, Calendar
} from 'lucide-react';
import { tmdb, discoverSeenIt, isMovieAtCinema, isMovieUpcoming, type TMDBMedia } from '../features/shows/tmdb';
import { type Show } from '../types';
import { cn, getNextEpisodeNumber } from '../lib/utils';
import { useShows } from '../hooks/useShows';
import { useToastStore } from '../store/toastStore';
import { PersonCard } from '../components/cards/PersonCard';
import { GridMediaCard, PreviewModal } from '../components/GridMediaCard';
import { PersonDetailModal } from './PersonDetailModal';
import { FilterModal } from '../components/FilterModal';
import { TrailerModal } from '../components/TrailerModal';
import { auth, db } from '../lib/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { useShowsStore } from '../store/showsStore';
import { getRecommendations } from '../lib/recommendations';
import { SeenItGlyph } from '../components/SeenItLogo';
import { useGridVirtualWindow } from '../hooks/useBoundedVirtualWindow';
import { hasMoreTmdbPages } from '../features/discover/discoverPagination';
import {
  discoverTypeForCategory,
  isSearchCompatibleCategory,
  matchesSelectedGenres,
  parseMinimumRating,
} from '../features/discover/filterPolicy';
import {
  BoundedDiscoverGrid,
  CATEGORIES,
  HERO_PROGRESS_LAYOUT_CLASS,
  SORT_OPTIONS,
  checkIsUpToDate,
} from './discoverPresentation';
import { GridSkeletons, HeroCard, HeroProgressSkeleton, HeroSkeleton } from './DiscoverHero';

interface DiscoverViewProps {
  model: Record<string, any>;
}

export function DiscoverView({ model }: DiscoverViewProps) {
  const { activeCategory, activeFilterCount, activeHeroIndex, addShow, containerRef, debouncedQuery, deleteShow, handleAddMedia, handleHeroScroll, handleLongPress, handleOpenTrailer, handleScroll, handleToggleWatched, handleTouchEnd, handleTouchMove, handleTouchStart, hasActiveFilters, hasMore, heroCarouselRef, heroDetails, isLoadingMore, isOffline, isSearchVisible, isSortPickerOpen, loading, minRating, movieReleaseAfterYear, movieResults, observerTargetRef, onShowClick, openPersonModal, pegi, personResults, previewMedia, processedResults, query, selectedGenres, selectedPersonId, selectedPlatforms, seriesResults, setActiveCategory, setActiveHeroIndex, setIsSearchFocused, setIsSearchVisible, setIsSortPickerOpen, setMinRating, setMovieReleaseAfterYear, setPegi, setPreviewMedia, setQuery, setSelectedGenres, setSelectedPersonId, setSelectedPlatforms, setShowGenreMenu, setShowScrollTop, setSortBy, setSortOrder, setTrailerModalVideos, showGenreMenu, showHeroSurface, showScrollTop, showsByTmdbId, suppressEndOfResults, sortBy, top10, trailerModalVideos, uniqueProcessedResults, visibleHeroItems, visibleMovieResults, visiblePersonResults, visibleProcessedResults, visibleSeriesResults } = model;
  return (
    <div className="relative flex-1 h-full bg-transparent text-white max-w-2xl mx-auto w-full overflow-hidden flex flex-col">
      <button
        onClick={() => {
          containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
          setShowScrollTop(false);
        }}
        aria-label="Remonter tout en haut"
        title="Remonter tout en haut"
        className={cn(
          "absolute top-4 left-1/2 -translate-x-1/2 z-40 flex items-center justify-center p-2.5 rounded-full bg-zinc-900/90 text-white border border-white/20 shadow-2xl backdrop-blur-xl transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-zinc-800 hover:scale-110 active:scale-95",
          showScrollTop
            ? "opacity-100 translate-y-0 pointer-events-auto shadow-black/80"
            : "opacity-0 -translate-y-6 pointer-events-none"
        )}
      >
        <ArrowUp size={18} className="text-white stroke-[2.5]" />
      </button>

      {isOffline && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 flex items-center gap-2 text-amber-400 text-xs font-medium">
          <WifiOff size={14} />
          <span>Mode hors ligne. Affichage des contenus en cache.</span>
        </div>
      )}

      <div
        ref={containerRef}
        className={cn(
          "flex-1 overflow-y-auto px-0 pb-nav hide-scrollbar space-y-5",
          debouncedQuery.trim() ? "pt-4 sm:pt-6" : "pt-0"
        )}
        onScroll={handleScroll}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {showHeroSurface && loading && top10.length === 0 && <HeroSkeleton />}

        {showHeroSurface && visibleHeroItems.length > 0 && (
          <div>
            <div className="relative w-full">
              <div
                ref={heroCarouselRef}
                onScroll={handleHeroScroll}
                className="flex w-full overflow-x-auto snap-x snap-mandatory hide-scrollbar"
              >
                {visibleHeroItems.map((item, index) => (
                  <div key={`top10_${item.media_type || 'media'}_${item.id}_${index}`} className="w-full shrink-0 snap-center">
                    <HeroCard
                      media={item}
                      details={heroDetails[item.id]}
                      onShowClick={onShowClick}
                      onOpenTrailer={handleOpenTrailer}
                      rank={index + 1}
                      activeCategory={activeCategory}
                      show={showsByTmdbId.get(Number(item.id))}
                      addShow={addShow}
                      deleteShow={deleteShow}
                    />
                  </div>
                ))}
              </div>

              {visibleHeroItems.length > 1 ? (
                <div className={HERO_PROGRESS_LAYOUT_CLASS}>
                  {visibleHeroItems.map((_, idx) => (
                    <button
                      key={idx}
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveHeroIndex(idx);
                        if (heroCarouselRef.current) {
                          const width = heroCarouselRef.current.clientWidth;
                          heroCarouselRef.current.scrollTo({ left: idx * width, behavior: 'smooth' });
                        }
                      }}
                      className={cn(
                        "transition-all duration-300 rounded-full cursor-pointer",
                        activeHeroIndex === idx
                          ? "w-6 h-1.5 bg-[#E5A93D]"
                          : "w-1.5 h-1.5 bg-zinc-700 hover:bg-zinc-500"
                      )}
                    />
                  ))}
                </div>
              ) : (
                <HeroProgressSkeleton />
              )}
            </div>
          </div>
        )}

        {!debouncedQuery.trim() && (
          <div className="px-2.5 sm:px-4">
            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none px-0.5">
              {CATEGORIES.map(category => (
                <button
                  key={category.id}
                  onClick={() => setActiveCategory(category.id)}
                  className={cn(
                    "px-4 py-1.5 rounded-full text-xs font-bold transition-all shrink-0 cursor-pointer",
                    activeCategory === category.id
                      ? "bg-[#E5A93D] text-black shadow-md shadow-[#E5A93D]/20"
                      : "bg-[#1C1C1E] text-zinc-400 hover:text-white hover:bg-zinc-800 border border-white/5"
                  )}
                >
                  {category.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="px-2.5 sm:px-4 space-y-4">
          <div className="flex items-center justify-between mb-2 px-1">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              {debouncedQuery.trim() ? (
                <>
                  <span className="text-base">🔍</span>
                  <span>Résultats</span>
                </>
              ) : (
                <>
                  <SeenItGlyph size={22} symbol="discover" glow={false} idPrefix="discover-header-spark" className="shrink-0" />
                  <span>Explorer</span>
                </>
              )}
            </h2>
            <div>
              <button
                type="button"
                onClick={() => setIsSortPickerOpen(true)}
                className="bg-[#1C1C1E] hover:bg-zinc-800 active:bg-zinc-700 text-xs font-semibold text-zinc-300 py-1.5 px-3 rounded-full border border-white/10 flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <span>{SORT_OPTIONS.find(o => o.id === sortBy)?.label || 'Trier'}</span>
                <ChevronDown size={14} className="text-zinc-400" />
              </button>

              {isSortPickerOpen && (
                <div
                  className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in"
                  onClick={() => setIsSortPickerOpen(false)}
                >
                  <div
                    className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-xs p-4 space-y-3 shadow-2xl animate-scale-in"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-between pb-2 border-b border-white/10">
                      <h4 className="text-sm font-extrabold text-white">Trier les résultats</h4>
                      <button
                        type="button"
                        onClick={() => setIsSortPickerOpen(false)}
                        className="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors"
                      >
                        <X size={18} />
                      </button>
                    </div>

                    <div className="space-y-1">
                      {SORT_OPTIONS.map((opt) => {
                        const isSelected = opt.id === sortBy;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => {
                              setSortBy(opt.id as 'popular' | 'rating' | 'date' | 'title');
                              setSortOrder(opt.id === 'title' ? 'asc' : 'desc');
                              setIsSortPickerOpen(false);
                            }}
                            className={cn(
                              "w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all text-left cursor-pointer",
                              isSelected
                                ? "bg-amber-500 text-zinc-950 font-black shadow-md shadow-amber-500/20"
                                : "text-zinc-300 hover:bg-white/5 active:bg-white/10"
                            )}
                          >
                            <span>{opt.label}</span>
                            {isSelected && <Check size={16} className="text-zinc-950 shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {debouncedQuery.trim() && (
            <div className="flex items-center gap-2 overflow-x-auto pb-1 mb-1 scrollbar-none px-0.5">
              <button
                onClick={() => setActiveCategory('Tout')}
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-bold transition-all shrink-0 cursor-pointer flex items-center gap-1.5",
                  activeCategory === 'Tout'
                    ? "bg-[#E5A93D] text-black shadow-md shadow-[#E5A93D]/20"
                    : "bg-[#1C1C1E] text-zinc-400 hover:text-white hover:bg-zinc-800 border border-white/5"
                )}
              >
                <span>Tout</span>
                <span className={cn("text-[10px] px-1.5 py-0.2 rounded-full font-extrabold", activeCategory === 'Tout' ? "bg-black/20 text-black" : "bg-white/10 text-zinc-400")}>
                  {uniqueProcessedResults.length}
                </span>
              </button>

              {personResults.length > 0 && (
                <button
                  onClick={() => setActiveCategory('Personnes')}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-bold transition-all shrink-0 cursor-pointer flex items-center gap-1.5",
                    activeCategory === 'Personnes'
                      ? "bg-amber-500 text-black shadow-md shadow-amber-500/20"
                      : "bg-[#1C1C1E] text-zinc-400 hover:text-white hover:bg-zinc-800 border border-white/5"
                  )}
                >
                  <User size={13} />
                  <span>Personnes</span>
                  <span className={cn("text-[10px] px-1.5 py-0.2 rounded-full font-extrabold", activeCategory === 'Personnes' ? "bg-black/20 text-black" : "bg-white/10 text-zinc-400")}>
                    {personResults.length}
                  </span>
                </button>
              )}

              {seriesResults.length > 0 && (
                <button
                  onClick={() => setActiveCategory('Séries')}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-bold transition-all shrink-0 cursor-pointer flex items-center gap-1.5",
                    activeCategory === 'Séries'
                      ? "bg-indigo-500 text-white shadow-md shadow-indigo-500/20"
                      : "bg-[#1C1C1E] text-zinc-400 hover:text-white hover:bg-zinc-800 border border-white/5"
                  )}
                >
                  <Tv size={13} />
                  <span>Séries</span>
                  <span className={cn("text-[10px] px-1.5 py-0.2 rounded-full font-extrabold", activeCategory === 'Séries' ? "bg-white/20 text-white" : "bg-white/10 text-zinc-400")}>
                    {seriesResults.length}
                  </span>
                </button>
              )}

              {movieResults.length > 0 && (
                <button
                  onClick={() => setActiveCategory('Films')}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-bold transition-all shrink-0 cursor-pointer flex items-center gap-1.5",
                    activeCategory === 'Films'
                      ? "bg-rose-500 text-white shadow-md shadow-rose-500/20"
                      : "bg-[#1C1C1E] text-zinc-400 hover:text-white hover:bg-zinc-800 border border-white/5"
                  )}
                >
                  <Film size={13} />
                  <span>Films</span>
                  <span className={cn("text-[10px] px-1.5 py-0.2 rounded-full font-extrabold", activeCategory === 'Films' ? "bg-white/20 text-white" : "bg-white/10 text-zinc-400")}>
                    {movieResults.length}
                  </span>
                </button>
              )}
            </div>
          )}

          {loading ? (
            <GridSkeletons />
          ) : processedResults.length > 0 ? (
            debouncedQuery.trim() && activeCategory === 'Tout' ? (
              <div className="space-y-6">
                {personResults.length > 0 && (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between px-1">
                      <div className="flex items-center gap-2">
                        <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
                          <User size={18} className="text-[#E5A93D]" />
                          <span>Personnes</span>
                        </h2>
                        <span className="text-xs font-extrabold text-zinc-400 bg-zinc-900/80 px-2.5 py-0.5 rounded-full border border-white/10 shadow-sm">
                          {personResults.length}
                        </span>
                      </div>
                      {personResults.length > 4 && (
                        <button
                          onClick={() => setActiveCategory('Personnes')}
                          className="text-xs font-bold text-[#E5A93D] hover:underline cursor-pointer"
                        >
                          Voir tout
                        </button>
                      )}
                    </div>
                    <div className="flex gap-1.5 sm:gap-1.5 overflow-x-auto pb-2 pt-0.5 px-0.5 scrollbar-none snap-x">
                      {personResults.map((item) => (
                        <PersonCard
                          key={`search_person_${item.id}`}
                          person={item}
                          onClick={openPersonModal}
                          isRowItem
                        />
                      ))}
                    </div>
                  </div>
                )}

                {seriesResults.length > 0 && (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between px-1">
                      <div className="flex items-center gap-2">
                        <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
                          <Tv size={18} className="text-[#E5A93D]" />
                          <span>Séries</span>
                        </h2>
                        <span className="text-xs font-extrabold text-zinc-400 bg-zinc-900/80 px-2.5 py-0.5 rounded-full border border-white/10 shadow-sm">
                          {seriesResults.length}
                        </span>
                      </div>
                      {seriesResults.length > 4 && (
                        <button
                          onClick={() => setActiveCategory('Séries')}
                          className="text-xs font-bold text-[#E5A93D] hover:underline cursor-pointer"
                        >
                          Voir tout
                        </button>
                      )}
                    </div>
                    <div className="flex gap-1.5 sm:gap-1.5 overflow-x-auto pb-2 pt-0.5 px-0.5 scrollbar-none snap-x">
                      {seriesResults.map((item) => (
                        <div key={`search_tv_${item.id}`} className="w-[calc((100vw-0.5rem-12px)/3)] sm:w-[calc((100vw-0.5rem-18px)/4)] shrink-0 snap-start">
                          <GridMediaCard
                            media={item}
                            onShowClick={onShowClick}
                            show={showsByTmdbId.get(Number(item.id))}
                            onAddClick={handleAddMedia}
                            onToggleWatched={handleToggleWatched}
                            onLongPress={handleLongPress}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {movieResults.length > 0 && (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between px-1">
                      <div className="flex items-center gap-2">
                        <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
                          <Film size={18} className="text-[#E5A93D]" />
                          <span>Films</span>
                        </h2>
                        <span className="text-xs font-extrabold text-zinc-400 bg-zinc-900/80 px-2.5 py-0.5 rounded-full border border-white/10 shadow-sm">
                          {movieResults.length}
                        </span>
                      </div>
                      {movieResults.length > 4 && (
                        <button
                          onClick={() => setActiveCategory('Films')}
                          className="text-xs font-bold text-[#E5A93D] hover:underline cursor-pointer"
                        >
                          Voir tout
                        </button>
                      )}
                    </div>
                    <div className="flex gap-1.5 sm:gap-1.5 overflow-x-auto pb-2 pt-0.5 px-0.5 scrollbar-none snap-x">
                      {movieResults.map((item) => (
                        <div key={`search_movie_${item.id}`} className="w-[calc((100vw-0.5rem-12px)/3)] sm:w-[calc((100vw-0.5rem-18px)/4)] shrink-0 snap-start">
                          <GridMediaCard
                            media={item}
                            onShowClick={onShowClick}
                            show={showsByTmdbId.get(Number(item.id))}
                            onAddClick={handleAddMedia}
                            onToggleWatched={handleToggleWatched}
                            onLongPress={handleLongPress}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(personResults.length > 0 || seriesResults.length > 0 || movieResults.length > 0) && (
                  <div className="w-full text-center py-3 px-4 mt-2">
                    <p className="text-xs font-medium text-zinc-500 flex items-center justify-center gap-2">
                      <span className="h-[1px] w-8 bg-zinc-800" />
                      <span>Fin des résultats</span>
                      <span className="h-[1px] w-8 bg-zinc-800" />
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div>
                {debouncedQuery.trim() ? (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-x-1.5 gap-y-4 px-1">
                    {(activeCategory === 'Personnes' ? visiblePersonResults :
                      activeCategory === 'Séries' ? visibleSeriesResults :
                      activeCategory === 'Films' ? visibleMovieResults :
                      visibleProcessedResults).map(item => (
                      item.media_type === 'person' ? (
                        <PersonCard key={`person_${item.id}`} person={item} onClick={openPersonModal} />
                      ) : (
                        <GridMediaCard
                          key={`grid_${item.media_type || 'media'}_${item.id}`}
                          media={item}
                          onShowClick={onShowClick}
                          show={showsByTmdbId.get(Number(item.id))}
                          onAddClick={handleAddMedia}
                          onToggleWatched={handleToggleWatched}
                          onLongPress={handleLongPress}
                        />
                      )
                    ))}
                  </div>
                ) : (
                  <BoundedDiscoverGrid
                    items={visibleProcessedResults}
                    scrollRootRef={containerRef}
                    showsByTmdbId={showsByTmdbId}
                    onShowClick={onShowClick}
                    onAddClick={handleAddMedia}
                    onToggleWatched={handleToggleWatched}
                    onLongPress={handleLongPress}
                  />
                )}

                {!loading && (
                  <div className="w-full flex items-center justify-center mt-2 mb-1">
                    {hasMore ? (
                      <div ref={observerTargetRef} className="w-full h-8 flex items-center justify-center">
                        {isLoadingMore ? (
                          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-[#E5A93D]" />
                        ) : (
                          <div className="h-5 w-5" />
                        )}
                      </div>
                    ) : (!suppressEndOfResults && (uniqueProcessedResults.length > 0 || seriesResults.length > 0 || movieResults.length > 0 || personResults.length > 0)) ? (
                      <div className="w-full text-center py-2 px-4">
                        <p className="text-xs font-medium text-zinc-500 flex items-center justify-center gap-2">
                          <span className="h-[1px] w-8 bg-zinc-800" />
                          <span>Fin des résultats</span>
                          <span className="h-[1px] w-8 bg-zinc-800" />
                        </p>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            )
          ) : (
            <div className="text-center py-16 space-y-3">
              <div className="w-12 h-12 bg-[#1C1C1E] rounded-full flex items-center justify-center mx-auto text-zinc-500">
                <Search size={24} />
              </div>
              <p className="text-sm font-medium text-zinc-400">
                {debouncedQuery.trim()
                  ? 'Aucun résultat ne correspond à votre recherche.'
                  : 'Aucun résultat ne correspond à vos critères.'}
              </p>
            </div>
          )}
        </div>
      </div>

      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className={cn(
          "absolute bottom-0 inset-x-0 px-3 pb-[calc(90px+env(safe-area-inset-bottom,0px))] pt-24 bg-gradient-to-t from-black via-black/95 to-transparent pointer-events-none z-40 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]",
          isSearchVisible ? "translate-y-0" : "translate-y-full"
        )}
      >
        <div className="flex flex-col gap-3 pointer-events-auto px-4 max-w-md mx-auto w-full">
          <div className="bg-[#1C1C1E]/95 backdrop-blur-xl border border-white/5 rounded-[1.75rem] p-1.5 flex items-center gap-2 shadow-[0_8px_30px_rgb(0,0,0,0.5)]">
            <div className={cn("flex items-center gap-1", (hasActiveFilters || activeCategory !== 'Tout') ? "bg-[#E5A93D]/20" : "bg-white/5", "rounded-full transition-colors shrink-0")}>
              <button
                onClick={() => setShowGenreMenu(true)}
                className="flex items-center gap-2 px-3.5 py-2.5 hover:bg-white/10 rounded-full transition-colors"
              >
                <SlidersHorizontal size={15} className={cn("text-zinc-400", (hasActiveFilters || activeCategory !== 'Tout') && "text-[#E5A93D]")} />
                <span className={cn("text-[14px] font-semibold text-zinc-300", (hasActiveFilters || activeCategory !== 'Tout') && "text-[#E5A93D]")}>
                  {activeCategory !== 'Tout'
                    ? activeCategory
                    : activeFilterCount > 0
                      ? `${activeFilterCount} filtre${activeFilterCount > 1 ? 's' : ''}`
                      : 'Filtres'}
                </span>
              </button>
            </div>

            <div className="w-px h-6 bg-white/10 shrink-0 mx-0.5" />

            <div className="flex-1 flex items-center gap-2 min-w-0">
              <Search size={18} className="text-zinc-500 shrink-0 ml-1" />
              <input
                type="text"
                placeholder="Séries, films, acteurs..."
                value={query}
                onChange={(e) => {
                  const nextQuery = e.target.value;
                  setQuery(nextQuery);
                  if (nextQuery.trim() && !isSearchCompatibleCategory(activeCategory)) {
                    setActiveCategory('Tout');
                  }
                }}
                onFocus={() => { setIsSearchFocused(true); setIsSearchVisible(true); }}
                onBlur={() => setIsSearchFocused(false)}
                className="bg-transparent border-none outline-none text-white text-[15px] font-medium w-full placeholder:text-zinc-500 min-w-0"
              />
            </div>

            {(query || hasActiveFilters || activeCategory !== 'Tout') && (
              <button
                onClick={() => {
                  setQuery('');
                  setSelectedPlatforms([]);
                  setSelectedGenres([]);
                  setPegi('Tous');
                  setMinRating('Toutes');
                  setActiveCategory('Tout');
                }}
                className="p-2 text-[#E5A93D] hover:text-[#f8d28a] shrink-0 transition-colors"
                title="Effacer"
              >
                <X size={18} />
              </button>
            )}
          </div>
        </div>
      </div>

      {!isSearchVisible && (
        <div
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          className="fixed bottom-0 inset-x-0 h-28 z-30 pointer-events-auto"
          aria-hidden="true"
        />
      )}

      {previewMedia && (
        <PreviewModal
          media={previewMedia}
          isAdded={showsByTmdbId.has(Number(previewMedia.id))}
          isWatched={
            showsByTmdbId.get(Number(previewMedia.id))?.status === 'completed' ||
            showsByTmdbId.get(Number(previewMedia.id))?.seenEpisodes?.includes('movie') ||
            checkIsUpToDate(showsByTmdbId.get(Number(previewMedia.id)))
          }
          onClose={() => setPreviewMedia(null)}
          onAddClick={handleAddMedia}
          onToggleWatched={handleToggleWatched}
          onShowClick={onShowClick}
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
          onShowClick={(id, mediaType) => {
            if (onShowClick) {
              onShowClick(id, mediaType);
            }
          }}
        />
      )}

      {trailerModalVideos && (
        <TrailerModal
          videos={trailerModalVideos}
          onClose={() => setTrailerModalVideos(null)}
        />
      )}

      {showGenreMenu && (
        <FilterModal
          onClose={() => setShowGenreMenu(false)}
          activeCategory={activeCategory}
          setActiveCategory={setActiveCategory}
          initialSelectedPlatforms={selectedPlatforms}
          initialSelectedGenres={selectedGenres}
          initialPegi={pegi}
          initialRating={minRating}
          initialMovieReleaseAfterYear={movieReleaseAfterYear}
          query={query}
          onApply={(platforms, genres, newPegi, newRating, newMovieReleaseAfterYear) => {
            setSelectedPlatforms(platforms);
            setSelectedGenres(genres);
            setPegi(newPegi);
            setMinRating(newRating);
            setMovieReleaseAfterYear(newMovieReleaseAfterYear);
            setShowGenreMenu(false);
          }}
        />
      )}
    </div>
  );
}
