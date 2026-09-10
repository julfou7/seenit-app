import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const discoverSource = readFileSync(new URL('../src/screens/DiscoverScreen.tsx', import.meta.url), 'utf8');
const librarySource = readFileSync(new URL('../src/screens/LibraryScreen.tsx', import.meta.url), 'utf8');
const watchListSource = readFileSync(new URL('../src/screens/WatchListScreen.tsx', import.meta.url), 'utf8');

test('#229 réarme le scroll infini Explorer après Activity hidden → visible', () => {
  assert.match(discoverSource, /const observerTargetNodeRef = useRef<HTMLDivElement \| null>\(null\)/);
  assert.match(
    discoverSource,
    /const observerTargetRef = useCallback\(\(node: HTMLDivElement \| null\) => \{\s*observerTargetNodeRef\.current = node;\s*\}, \[\]\);/,
    'la callback-ref doit seulement conserver le sentinel DOM afin que React Activity puisse le réutiliser au réveil',
  );
  assert.match(
    discoverSource,
    /useEffect\(\(\) => \{\s*const node = observerTargetNodeRef\.current;[\s\S]*new IntersectionObserver[\s\S]*observer\.observe\(node\);[\s\S]*return \(\) => observer\.disconnect\(\);/,
    'le cycle de vie de l’IntersectionObserver doit appartenir à un Effect reconnectable par Activity',
  );
  assert.doesNotMatch(
    discoverSource,
    /const observerRef = useRef<IntersectionObserver/,
    'un observer conservé puis seulement déconnecté au cleanup ne serait pas réarmé quand Activity reconnecte les Effects',
  );
});

test('SEENIT-PERF-001 borne le montage visible de Ma Liste', () => {
  assert.match(librarySource, /const LIBRARY_ROW_BATCH_SIZE = 6/);
  assert.match(librarySource, /const LIBRARY_GRID_BATCH_SIZE = 12/);
  assert.match(librarySource, /const LIBRARY_ROW_ROOT_MARGIN = '320px 0px'/);
  assert.match(librarySource, /const DeferredLibraryRow = React\.memo/);
  assert.match(librarySource, /new IntersectionObserver\(entries =>/);
  assert.match(librarySource, /shouldRender \? <LibraryRow \{\.\.\.rowProps\} \/> : null/);
  assert.match(librarySource, /eager=\{index === 0\}/);
  assert.match(librarySource, /data\.slice\(0, visibleCount\)\.map\(\(\{ media, show \}\) =>/);
  assert.match(
    librarySource,
    /setVisibleCount\(current => Math\.min\(data\.length, current \+ LIBRARY_ROW_BATCH_SIZE\)\)/,
    'la rangée réduite doit étendre progressivement son lot sans monter toute la bibliothèque',
  );
  assert.match(librarySource, /setVisibleCount\(current => Math\.min\(data\.length, current \+ LIBRARY_GRID_BATCH_SIZE\)\)/);
  assert.match(librarySource, />\s*Charger plus\s*<\/button>/);
  assert.match(librarySource, /key=\{getMediaKey\(media\.media_type, media\.id\)\}/);
  assert.match(librarySource, /onShowClick=\{handleShowClick\}/);
  assert.doesNotMatch(librarySource, /section\.data\.map\(/);
  assert.doesNotMatch(librarySource, /key=\{`\$\{media\.id\}_\$\{idx\}`\}/);
});

test('SEENIT-PERF-001 garde le scroll horizontal de Ma Liste libre et précharge avant la fin', () => {
  assert.match(librarySource, /const LIBRARY_ROW_PRELOAD_MARGIN = '0px 50% 0px 0px'/);
  assert.match(librarySource, /const scrollContainerRef = useRef<HTMLDivElement>\(null\)/);
  assert.match(librarySource, /const preloadSentinelRef = useRef<HTMLDivElement>\(null\)/);
  assert.match(librarySource, /root: container,\s*rootMargin: LIBRARY_ROW_PRELOAD_MARGIN,\s*threshold: 0/);
  assert.match(librarySource, /observer\.observe\(sentinel\)/);
  assert.match(librarySource, /ref=\{scrollContainerRef\}/);
  assert.match(librarySource, /ref=\{preloadSentinelRef\}/);
  assert.match(librarySource, /const preloadDistance = Math\.max\(element\.clientWidth \* 0\.5, 1\)/);
  assert.doesNotMatch(librarySource, /snap-x/);
  assert.doesNotMatch(librarySource, /snap-mandatory/);
  assert.doesNotMatch(librarySource, /snap-start/);
  assert.doesNotMatch(librarySource, /scroll-px-/);
});

test('SEENIT-PERF-001 préserve les cartes inchangées et la sous-vue Profil', () => {
  const profileSource = readFileSync(new URL('../src/screens/ProfileScreen.tsx', import.meta.url), 'utf8');

  assert.match(librarySource, /const libraryItemCache = new WeakMap<Show, LibraryItem>\(\)/);
  assert.match(librarySource, /const cached = libraryItemCache\.get\(show\)/);
  assert.match(librarySource, /left\.every\(\(item, index\) => item === right\[index\]\)/);
  assert.match(librarySource, /useShowsStore\.getState\(\)\.shows\.find/);
  assert.match(librarySource, /export const LibraryScreen = React\.memo/);
  assert.doesNotMatch(librarySource, /showsByMediaKey/);

  assert.match(profileSource, /const ProfileStatsContent = React\.memo/);
  assert.match(profileSource, /const \[mountedProfileTabs, setMountedProfileTabs\]/);
  assert.match(profileSource, /<Activity mode=\{profileContentVisible && activeTab === 'stats' \? 'visible' : 'hidden'\}>/);
  assert.match(profileSource, /<Activity mode=\{profileContentVisible && activeTab === 'library' \? 'visible' : 'hidden'\}>/);
  assert.match(profileSource, /<LibraryScreen onShowClick=\{handleLibraryShowClick\} isEmbedded=\{true\} \/>/);
  assert.match(profileSource, /export const ProfileScreen = React\.memo/);
  assert.doesNotMatch(profileSource, /<LibraryScreen onShowClick=\{\(id, mediaType\) =>/);
});

test('#229 borne le rendu initial des carrousels progressifs et conserve Voir tout paginé', () => {
  assert.match(watchListSource, /const WATCHLIST_BATCH_SIZE = 8/);
  assert.match(watchListSource, /Math\.min\(WATCHLIST_BATCH_SIZE, data\.length\)/);
  assert.match(watchListSource, /data\.slice\(0, visibleCount\)\.map\(renderCard\)/);
  assert.match(watchListSource, /data=\{continueWatchingShows\}/);
  assert.match(watchListSource, /data=\{nouveautesShows\}/);
  assert.match(watchListSource, /data=\{pasVuDepuisUnMomentShows\}/);
  assert.match(watchListSource, /data=\{filmsAVoirShows\}/);

  assert.match(watchListSource, /continueWatchingShows\.slice\(0, visibleCount\)\.map/);
  assert.match(watchListSource, /setVisibleCount\(prev => prev \+ WATCHLIST_BATCH_SIZE\)/);
  assert.doesNotMatch(watchListSource, /\{continueWatchingShows\.map\(/);
  assert.doesNotMatch(watchListSource, /\{nouveautesShows\.map\(/);
  assert.doesNotMatch(watchListSource, /\{pasVuDepuisUnMomentShows\.map\(/);
  assert.doesNotMatch(watchListSource, /\{filmsAVoirShows\.map\(/);
});
