import { useRef } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import type { DiscoverViewModel } from '../screens/discoverViewModel';
import { cn } from '../lib/utils';
import { isSearchCompatibleCategory } from '../features/discover/filterPolicy';
import { useSearchKeyboardDock } from '../hooks/useSearchKeyboardDock';

type Props = Pick<DiscoverViewModel, 'handleTouchStart' | 'handleTouchMove' | 'handleTouchEnd' | 'isSearchVisible' | 'isSearchFocused' | 'hasActiveFilters' | 'activeCategory' | 'setShowGenreMenu' | 'activeFilterCount' | 'query' | 'setQuery' | 'setActiveCategory' | 'setIsSearchFocused' | 'setIsSearchVisible' | 'setSelectedPlatforms' | 'setSelectedGenres' | 'setPegi' | 'setMinRating'>;

export function DiscoverSearchDock({ handleTouchStart, handleTouchMove, handleTouchEnd, isSearchVisible, isSearchFocused, hasActiveFilters, activeCategory, setShowGenreMenu, activeFilterCount, query, setQuery, setActiveCategory, setIsSearchFocused, setIsSearchVisible, setSelectedPlatforms, setSelectedGenres, setPegi, setMinRating }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const geometry = useSearchKeyboardDock(isSearchFocused, () => { inputRef.current?.blur(); setIsSearchFocused(false); });
  return (
      <div
        data-discover-search-editing={isSearchFocused}
        style={{ bottom: geometry.bottom, paddingBottom: isSearchFocused ? geometry.keyboard ? 8 : 'calc(8px + var(--seenit-safe-area-bottom, env(safe-area-inset-bottom, 0px)))' : undefined }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className={cn(
          "absolute bottom-0 inset-x-0 px-3 pb-[calc(90px+env(safe-area-inset-bottom,0px))] pt-24 bg-gradient-to-t from-black via-black/95 to-transparent pointer-events-none z-40 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]",
          isSearchVisible || isSearchFocused ? "translate-y-0" : "translate-y-full"
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
                ref={inputRef}
                id="discover-search"
                type="text"
                enterKeyHint="search"
                placeholder="Séries, films, acteurs..."
                data-navigation-search
                aria-label="Rechercher une série, un film ou un acteur"
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
                onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.currentTarget.blur(); }}
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
  );
}
