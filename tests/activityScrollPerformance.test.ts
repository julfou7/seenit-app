import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readFeatureSource } from './featureSource.ts';

const discoverSource = readFeatureSource('discover');
const librarySource = readFileSync(new URL('../src/screens/LibraryScreen.tsx', import.meta.url), 'utf8');
const watchListSource = readFeatureSource('watchList');
const virtualWindowSource = readFileSync(new URL('../src/hooks/useBoundedVirtualWindow.ts', import.meta.url), 'utf8');
const moiCss = readFileSync(new URL('../src/screens/moi.css', import.meta.url), 'utf8');

test('#229 réarme le scroll infini Explorer après Activity hidden → visible', () => {
  assert.match(
    discoverSource,
    /useEffect\(\(\) => \{\s*const node = observerTargetNode;[\s\S]*new IntersectionObserver[\s\S]*observer\.observe\(node\);[\s\S]*return \(\) => observer\.disconnect\(\);/,
    'le cycle de vie de l’IntersectionObserver doit appartenir à un Effect reconnectable par Activity',
  );
  assert.doesNotMatch(
    discoverSource,
    /const observerRef = useRef<IntersectionObserver/,
    'un observer conservé puis seulement déconnecté au cleanup ne serait pas réarmé quand Activity reconnecte les Effects',
  );
});

test('SEENIT-PERF-001 borne le montage visible de Ma Liste', () => {
  assert.match(librarySource, /const LIBRARY_GRID_BATCH_SIZE = 12/);
  assert.match(librarySource, /useState\(\(\) => Math\.min\(LIBRARY_GRID_BATCH_SIZE, data\.length\)\)/);
  assert.match(librarySource, /data\.slice\(0, visibleCount\)\.map/);
  assert.match(librarySource, /setVisibleCount\(current => Math\.min\(data\.length, current \+ LIBRARY_GRID_BATCH_SIZE\)\)/);
  assert.match(librarySource, />\s*Charger plus\s*<\/button>/);
  assert.match(librarySource, /<LibrarySectionGrid\s+key=\{activeSection\.id\}/,
    'une seule section est montée à la fois et repart d’un lot borné à chaque changement de pastille');
  assert.match(librarySource, /key=\{getMediaKey\(media\.media_type, media\.id\)\}/);
  assert.match(librarySource, /onShowClick=\{handleShowClick\}/);
  assert.doesNotMatch(librarySource, /section\.data\.map\(/);
  assert.doesNotMatch(librarySource, /sections\.map\(\(section, index\) =>/);
  assert.doesNotMatch(librarySource, /key=\{`\$\{media\.id\}_\$\{idx\}`\}/);
});

test('SEENIT-PERF-001 garde la rangée de pastilles de Ma Liste en scroll libre', () => {
  assert.match(librarySource, /className="moi-chips"/);
  assert.match(moiCss, /\.moi-chips\{display:flex;gap:8px;overflow-x:auto/);
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
  assert.match(watchListSource, /useHorizontalVirtualWindow\(data\.length, WATCHLIST_BATCH_SIZE, WATCHLIST_CAROUSEL_OVERSCAN\)/);
  assert.match(virtualWindowSource, /calculateHorizontalWindow/);
  assert.match(virtualWindowSource, /container\.addEventListener\('scroll', scheduleRefresh, \{ passive: true \}\)/);
  assert.match(virtualWindowSource, /requestAnimationFrame/);
  assert.match(watchListSource, /data\.slice\(range\.start, range\.end\)/);
  assert.match(watchListSource, /leadingSpacerSize/);
  assert.match(watchListSource, /trailingSpacerSize/);
  assert.match(watchListSource, /groups=\{\[continueWatchingShows, nouveautesShows, pasVuDepuisUnMomentShows\]\}/);
  assert.match(watchListSource, /movies=\{filmsAVoirShows\}/);
  assert.match(watchListSource, /items\.slice\(0, limit\)/);
  assert.match(watchListSource, /orderedMovies\.slice\(0, movieList \? movieCount : movieRailLimit\)/);

  assert.match(watchListSource, /setMovieCount\(count => count \+ HOME_PAGE_SIZE\)/);
  assert.match(watchListSource, /limit \+ HOME_PAGE_SIZE/);
  assert.doesNotMatch(watchListSource, /\{continueWatchingShows\.map\(/);
  assert.doesNotMatch(watchListSource, /\{nouveautesShows\.map\(/);
  assert.doesNotMatch(watchListSource, /\{pasVuDepuisUnMomentShows\.map\(/);
  assert.doesNotMatch(watchListSource, /\{filmsAVoirShows\.map\(/);
});
