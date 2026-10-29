import '../../src/screens/explorer.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BottomNav } from '../../src/components/BottomNav';
import { DiscoverSearchDock } from '../../src/components/DiscoverSearchDock';
import { useNavigationSearchShortcut } from '../../src/features/navigation/useTabShortcut';
import { activateNavigationShortcut } from '../../src/features/navigation/navigationShortcuts';
import { api } from './navbar13jRuntime';

const viewport = Object.assign(new EventTarget(), { height: innerHeight, width: innerWidth, offsetTop: 0 });
Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
Object.assign(window, { __searchViewport: (height: number, offsetTop = 0) => {
  viewport.height = height; viewport.offsetTop = offsetTop; viewport.dispatchEvent(new Event('resize'));
} });
function Harness() {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(true);
  const [request, setRequest] = useState<number>();
  const [tab, setTab] = useState('discover');
  useNavigationSearchShortcut(request, () => setVisible(true), '[data-app-tab="discover"] [data-navigation-search]');
  const shortcut = () => activateNavigationShortcut(tab, 'discover', {
    changeTab: setTab, request: () => setRequest(previous => (previous ?? 0) + 1), quickAccount: () => {},
  });
  Object.assign(window, { __searchHarness: { hide: () => setVisible(false), tab: setTab, enabled: api.enabled } });
  return <main data-app-tab="discover" style={{ height: '100dvh', position: 'relative', background: '#101014' }}>
    <div id="results" style={{ height: '100%', overflow: 'auto' }}>
      <h1>Explorer</h1><button id="outside" type="button">Consulter un résultat</button>
      <div style={{ height: 2400 }}>Résultats de recherche</div>
    </div>
    <div data-discover-search-mode={visible}>
    <button id="open-search" onClick={() => setVisible(true)}>Rechercher</button>
    <DiscoverSearchDock isSearchMode={visible} isSearchFocused={focused} setIsSearchFocused={setFocused}
      query={query} setQuery={setQuery} activeCategory="Tout" activeFilterCount={1}
      setActiveCategory={()=>{}} setShowGenreMenu={()=>{}} exitSearch={() => { setVisible(false); setQuery(''); }} />
    </div>
    <BottomNav currentTab={tab} onTabChange={setTab} onLongPress={shortcut} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
