import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BottomNav } from '../../src/components/BottomNav';
import { DiscoverSearchDock } from '../../src/components/DiscoverSearchDock';

const viewport = Object.assign(new EventTarget(), { height: innerHeight, width: innerWidth, offsetTop: 0 });
Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
Object.assign(window, { __searchViewport: (height: number, offsetTop = 0) => {
  viewport.height = height; viewport.offsetTop = offsetTop; viewport.dispatchEvent(new Event('resize'));
} });
function Harness() {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  return <main data-app-tab="discover" style={{ height: '100dvh', position: 'relative', background: '#101014' }}>
    <h1>Explorer</h1><button id="outside" type="button">Consulter un résultat</button>
    <DiscoverSearchDock handleTouchStart={()=>{}} handleTouchMove={()=>{}} handleTouchEnd={()=>{}}
      isSearchVisible isSearchFocused={focused} setIsSearchFocused={setFocused} setIsSearchVisible={()=>{}}
      query={query} setQuery={setQuery} hasActiveFilters activeCategory="Tout" activeFilterCount={1}
      setActiveCategory={()=>{}} setShowGenreMenu={()=>{}} setSelectedPlatforms={()=>{}} setSelectedGenres={()=>{}}
      setPegi={()=>{}} setMinRating={()=>{}} />
    <BottomNav currentTab="discover" onTabChange={()=>{}} onLongPress={()=>{}} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
