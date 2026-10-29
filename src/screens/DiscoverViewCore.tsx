import { useCallback, useEffect, useState } from 'react';
import { Search, SlidersHorizontal, WifiOff, X } from 'lucide-react';
import { type DiscoverViewModel } from './discoverViewModel';
import { DiscoverSearchDock } from '../components/DiscoverSearchDock';
import { DiscoverSearchResults } from '../components/DiscoverSearchResults';
import { PreviewModal } from '../components/GridMediaCard';
import { PersonCard } from '../components/cards/PersonCard';
import { PersonDetailModal } from './PersonDetailModal';
import { FilterModal, type FilterTab } from '../components/FilterModal';
import { TrailerModal } from '../components/TrailerModal';
import { isSearchCompatibleCategory } from '../features/discover/filterPolicy';
import { BoundedDiscoverGrid, CATEGORIES } from './discoverPresentation';
import { GridSkeletons, HeroCard, HeroSkeleton } from './DiscoverHero';
import { removeTrackedMedia } from '../features/shows/removeTrackedMedia';
import { useCharacterSearch } from '../hooks/useCharacterSearch';
import { CharacterDetailModal } from '../components/CharacterDetailModal';
import type { CharacterRecord } from '../features/discover/characters';
import './explorer.css';

interface DiscoverViewProps { model: DiscoverViewModel & { suppressEndOfResults?: boolean } }

export function DiscoverView({ model }: DiscoverViewProps) {
  const { activeCategory, activeFilterCount, activeHeroIndex, addShow, containerRef, debouncedQuery, deleteShow, handleAddMedia, handleHeroScroll, handleLongPress, handleOpenTrailer, handleToggleWatched, hasActiveFilters, hasMore, heroCarouselRef, heroDetails, isLoadingMore, isOffline, loading, minRating, movieReleaseAfterYear, observerTargetRef, onShowClick, pegi, previewMedia, query, selectedGenres, selectedPersonId, selectedPlatforms, setActiveCategory, setActiveHeroIndex, setMinRating, setMovieReleaseAfterYear, setPegi, setPreviewMedia, setSelectedGenres, setSelectedPersonId, setSelectedPlatforms, setShowGenreMenu, setSortBy, setSortOrder, setTrailerModalVideos, showGenreMenu, showHeroSurface, showsByTmdbId, sortBy, trailerModalVideos, visibleHeroItems, visibleProcessedResults, isSearchMode, enterSearch } = model;
  const previewType = previewMedia?.media_type === 'tv' || (!previewMedia?.media_type && previewMedia?.first_air_date !== undefined) ? 'tv' : 'movie';
  const previewShow = previewMedia ? model.shows.find(show => Number(show.tmdbId) === Number(previewMedia.id) && show.mediaType === previewType) : undefined;
  const [selectedCharacter, setSelectedCharacter] = useState<CharacterRecord | null>(null);
  const characterSearch = useCharacterSearch(model.shows, isSearchMode ? debouncedQuery : '', !selectedCharacter);
  const closeKeyboard = () => { document.querySelector<HTMLInputElement>('[data-navigation-search]')?.blur(); model.setIsSearchFocused(false); };
  const openCharacter = (character: CharacterRecord) => {
    closeKeyboard();
    setSelectedCharacter(character);
    window.history.pushState({ ...window.history.state, seenitCharacter: character }, '');
  };
  const closeCharacter = useCallback(() => {
    if (window.history.state?.seenitCharacter) window.history.back(); else setSelectedCharacter(null);
  }, []);
  useEffect(() => {
    const close = () => setSelectedCharacter(null);
    const pop = (event: PopStateEvent) => setSelectedCharacter(event.state?.seenitCharacter || null);
    window.addEventListener('app-close-modals', close); window.addEventListener('popstate', pop);
    return () => { window.removeEventListener('app-close-modals', close); window.removeEventListener('popstate', pop); };
  }, []);
  const resultModel = { ...model, onShowClick: (id: string | number, type?: 'tv' | 'movie') => { closeKeyboard(); model.onShowClick(id, type); }, openPersonModal: (id: number) => { closeKeyboard(); model.openPersonModal(id); } };
  const [filterTab, setFilterTab] = useState<FilterTab>('Plateformes');
  const openFilter = (tab?: FilterTab) => { if (tab) setFilterTab(tab); setShowGenreMenu(true); };
  const clearFilters = () => {
    setSelectedPlatforms([]); setSelectedGenres([]); setPegi('Tous'); setMinRating('Toutes');
    setMovieReleaseAfterYear('Toutes'); setSortBy('popular'); setSortOrder('desc');
  };
  const chips: { label: string; tab: FilterTab; remove: () => void }[] = [
    ...selectedPlatforms.map(platform => ({ label: ({ netflix: 'Netflix', hbo: 'HBO', disney: 'Disney+', apple: 'Apple TV+', prime: 'Prime', canal: 'Canal+', max: 'Max' } as Record<string, string>)[platform] || platform, tab: 'Plateformes' as const, remove: () => setSelectedPlatforms(selectedPlatforms.filter(id => id !== platform)) })),
    ...selectedGenres.map(genre => ({ label: genre, tab: 'Genres' as const, remove: () => setSelectedGenres(selectedGenres.filter(id => id !== genre)) })),
    ...(minRating !== 'Toutes' ? [{ label: `★ ${minRating.replace('.', ',')}`, tab: 'Note' as const, remove: () => setMinRating('Toutes') }] : []),
    ...(pegi !== 'Tous' ? [{ label: pegi === 'age:0' ? 'TP' : `Âge ≤ ${pegi.replace('age:', '')}`, tab: 'Âge' as const, remove: () => setPegi('Tous') }] : []),
    ...(movieReleaseAfterYear !== 'Toutes' ? [{ label: `Après ${movieReleaseAfterYear}`, tab: 'Année' as const, remove: () => setMovieReleaseAfterYear('Toutes') }] : []),
    ...(sortBy !== 'popular' ? [{ label: ({ rating: 'Mieux notés', date: 'Plus récents', title: 'A → Z' })[sortBy], tab: 'Trier' as const, remove: () => { setSortBy('popular'); setSortOrder('desc'); } }] : []),
  ];
  return <div className="explorer-root relative flex-1 h-full max-w-2xl mx-auto w-full overflow-hidden flex flex-col" data-discover-search-mode={isSearchMode} inert={Boolean(selectedCharacter)}>
    {isOffline && <div className="explorer-offline"><WifiOff size={14} />Mode hors ligne · contenus en cache</div>}
    <div ref={containerRef} className="explorer-scroll flex-1 overflow-y-auto hide-scrollbar pb-nav">
      {showHeroSurface && loading && !visibleHeroItems.length && <HeroSkeleton />}
      {showHeroSurface && visibleHeroItems.length > 0 && <div className="explorer-hero">
        <div ref={heroCarouselRef} onScroll={handleHeroScroll} className="flex w-full overflow-x-auto snap-x snap-mandatory hide-scrollbar">
          {visibleHeroItems.map((item, index) => <div key={`${item.media_type}_${item.id}`} className="w-full shrink-0 snap-center">
            <HeroCard media={item} details={heroDetails[item.id]} onShowClick={onShowClick} onOpenTrailer={() => setPreviewMedia(item)}
              rank={index + 1} activeCategory={activeCategory} show={showsByTmdbId.get(Number(item.id))} addShow={addShow} deleteShow={deleteShow} />
          </div>)}
        </div>
        <div className="explorer-hero-dots">{visibleHeroItems.map((item, index) => <button type="button" key={item.id} aria-label={`Voir la suggestion ${index + 1}`} aria-pressed={index === activeHeroIndex}
          onClick={() => { setActiveHeroIndex(index); heroCarouselRef.current?.scrollTo({ left: index * heroCarouselRef.current.clientWidth, behavior: 'smooth' }); }}><i /></button>)}</div>
      </div>}
      <div className="explorer-controls">
        <div className="explorer-category-row">
          {!isSearchMode && <><button type="button" className="explorer-control-search" aria-label="Rechercher" onClick={enterSearch}><Search size={20} /></button>
            <button type="button" className="explorer-control-filter" aria-label="Filtres" onClick={() => openFilter()}><SlidersHorizontal size={20} />{activeFilterCount > 0 && <span className="explorer-count">{activeFilterCount}</span>}</button></>}
          {CATEGORIES.map(category => <button type="button" key={category.id} className="explorer-category" aria-pressed={activeCategory === category.id}
            disabled={Boolean(query.trim()) && !isSearchCompatibleCategory(category.id)} onClick={() => setActiveCategory(category.id)}>{category.label}</button>)}
        </div>
        {hasActiveFilters && <div className="explorer-chips">{chips.map(chip => <span key={chip.label}>
          <button type="button" onClick={() => openFilter(chip.tab)}>{chip.label}</button>
          <button type="button" aria-label={`Retirer le filtre ${chip.label}`} onClick={chip.remove}><X size={14} /></button>
        </span>)}<button type="button" onClick={clearFilters}>Tout effacer</button></div>}
      </div>
      <div className="explorer-content">
        {isSearchMode && query.trim() ? <DiscoverSearchResults model={resultModel} characters={characterSearch.results} charactersLoading={characterSearch.loading} onCharacterClick={openCharacter} /> : loading && !visibleProcessedResults.length ? <GridSkeletons /> : activeCategory === 'Personnes' ?
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">{visibleProcessedResults.map(person => <PersonCard key={person.id} person={person} onClick={model.openPersonModal} />)}</div> :
          <BoundedDiscoverGrid items={visibleProcessedResults} scrollRootRef={containerRef} showsByTmdbId={showsByTmdbId}
            onShowClick={onShowClick} onAddClick={handleAddMedia} onToggleWatched={handleToggleWatched} onLongPress={handleLongPress} />}
        {!loading && !debouncedQuery && <div ref={observerTargetRef} className="explorer-page-sentinel">
          {isLoadingMore ? <span role="status">Chargement…</span> : !hasMore && !model.suppressEndOfResults && visibleProcessedResults.length > 0 && <span>Fin des résultats</span>}
        </div>}
      </div>
    </div>
    <DiscoverSearchDock {...model} />
    {selectedCharacter && <CharacterDetailModal key={selectedCharacter.id} character={selectedCharacter} shows={model.shows} onClose={closeCharacter} onCharacterClick={openCharacter} onPersonClick={resultModel.openPersonModal} onShowClick={onShowClick} />}
    {previewMedia && <PreviewModal media={previewMedia} isAdded={Boolean(previewShow)}
      isWatched={Boolean(previewShow && (previewShow.status === 'completed' || previewShow.seenEpisodes.includes('movie')))}
      onClose={() => setPreviewMedia(null)} onAddClick={handleAddMedia} onRemoveClick={() => { if (previewShow) return removeTrackedMedia(previewShow, deleteShow); }} onToggleWatched={handleToggleWatched} onShowClick={onShowClick} />}
    {selectedPersonId && <PersonDetailModal personId={selectedPersonId} onClose={() => { setSelectedPersonId(null); if (window.history.state?.isPersonDetailModal) window.history.back(); }} onShowClick={onShowClick} />}
    {trailerModalVideos && <TrailerModal videos={trailerModalVideos} onClose={() => setTrailerModalVideos(null)} />}
    {showGenreMenu && <FilterModal onClose={() => setShowGenreMenu(false)} activeCategory={activeCategory} setActiveCategory={setActiveCategory}
      initialSelectedPlatforms={selectedPlatforms} initialSelectedGenres={selectedGenres} initialPegi={pegi} initialRating={minRating}
      initialMovieReleaseAfterYear={movieReleaseAfterYear} query={query} sortBy={sortBy}
      onSort={sort => { setSortBy(sort); setSortOrder(sort === 'title' ? 'asc' : 'desc'); }}
      initialTab={filterTab} onTabChange={setFilterTab}
      resultCount={loading || hasMore ? null : visibleProcessedResults.length}
      onApply={(platforms, genres, age, rating, year) => { setSelectedPlatforms(platforms); setSelectedGenres(genres); setPegi(age); setMinRating(rating); setMovieReleaseAfterYear(year); }} />}
  </div>;
}
