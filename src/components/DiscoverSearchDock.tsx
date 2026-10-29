import { useEffect, useRef } from 'react';
import { ChevronLeft, Search, SlidersHorizontal, X } from 'lucide-react';
import type { DiscoverViewModel } from '../screens/discoverViewModel';
import { isSearchCompatibleCategory } from '../features/discover/filterPolicy';
import { useSearchKeyboardDock } from '../hooks/useSearchKeyboardDock';

type Props = Pick<DiscoverViewModel, 'isSearchMode' | 'isSearchFocused' | 'activeCategory' | 'setShowGenreMenu' | 'activeFilterCount' | 'query' | 'setQuery' | 'setActiveCategory' | 'setIsSearchFocused' | 'exitSearch'>;

export function DiscoverSearchDock({ isSearchMode, isSearchFocused, activeCategory, setShowGenreMenu, activeFilterCount, query, setQuery, setActiveCategory, setIsSearchFocused, exitSearch }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const closeKeyboard = () => {
    inputRef.current?.blur();
    setIsSearchFocused(false);
    if (!query.trim()) exitSearch();
  };
  const geometry = useSearchKeyboardDock(isSearchFocused, closeKeyboard);
  useEffect(() => {
    if (isSearchMode) inputRef.current?.focus({ preventScroll: true });
  }, [isSearchMode]);
  useEffect(() => {
    if (!isSearchMode) return;
    const value = geometry.keyboard ? `${geometry.bottom + 72}px` : 'calc(96px + var(--seenit-safe-area-bottom, env(safe-area-inset-bottom, 0px)))';
    document.documentElement.style.setProperty('--seenit-explorer-toast-bottom', value);
    return () => { document.documentElement.style.removeProperty('--seenit-explorer-toast-bottom'); };
  }, [isSearchMode, geometry.bottom, geometry.keyboard]);
  if (!isSearchMode) return null;
  return <div className="explorer-search-dock" data-discover-search-editing={isSearchFocused}
    style={{ bottom: geometry.bottom, paddingBottom: geometry.keyboard ? 8 : 'calc(30px + var(--seenit-safe-area-bottom, env(safe-area-inset-bottom, 0px)))' }}>
    <button type="button" className="explorer-circle" aria-label="Quitter la recherche" onClick={exitSearch}><ChevronLeft size={24} /></button>
    <div className="explorer-search-field">
      <Search size={20} aria-hidden="true" />
      <input ref={inputRef} id="discover-search" data-navigation-search type="search" enterKeyHint="search"
        aria-label="Rechercher une série, un film ou un acteur" placeholder="Séries, films, acteurs…" value={query}
        onChange={event => {
          setQuery(event.target.value);
          if (event.target.value.trim() && !isSearchCompatibleCategory(activeCategory)) setActiveCategory('Tout');
        }}
        onFocus={() => setIsSearchFocused(true)} onBlur={() => setIsSearchFocused(false)}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Enter' && query.trim()) closeKeyboard();
          if (event.key === 'Escape') { event.preventDefault(); if (isSearchFocused) closeKeyboard(); else exitSearch(); }
        }} />
      {query && <button type="button" aria-label="Effacer la recherche" onPointerDown={event => event.preventDefault()}
        onClick={() => { setQuery(''); inputRef.current?.focus({ preventScroll: true }); }}><X size={20} /></button>}
    </div>
    <button type="button" className="explorer-circle" aria-label="Filtres" onClick={() => { inputRef.current?.blur(); setShowGenreMenu(true); }}>
      <SlidersHorizontal size={22} />{activeFilterCount > 0 && <span className="explorer-count">{activeFilterCount}</span>}
    </button>
  </div>;
}
