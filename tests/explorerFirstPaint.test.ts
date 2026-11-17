import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFeatureSource } from './featureSource.ts';

const discoverSource = readFeatureSource('discover');
const providerPolicySource = readFileSync(new URL('../src/features/providers/watchProviderRequestPolicy.ts', import.meta.url), 'utf8');
const cssSource = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');

test('SEENIT-PERF-001 libère Explorer dès le trending et borne le premier viewport', () => {
  assert.match(discoverSource, /const DISCOVER_CRITICAL_GRID_ITEMS = 6/);
  assert.match(discoverSource, /const trendAllRes = await trendAllPromise/);
  assert.match(discoverSource, /if \(trendingList\.length > 0\) hooks\.onEarlyTrending\?\.\(trendingList\)/);
  assert.match(discoverSource, /onEarlyTrending: list => \{[\s\S]*?if \(page === 1\) setHomeLoading\(false\)/);
  assert.match(discoverSource, /const visibleHeroItems = criticalHomeSliceActive \? top10\.slice\(0, 1\) : top10/);
  assert.match(discoverSource, /uniqueProcessedResults\.slice\(0, DISCOVER_CRITICAL_GRID_ITEMS\)/);
  assert.match(discoverSource, /if \(isSearchMode \|\| isLoadingMore \|\| loading \|\| criticalHomeSliceActive/);
  assert.match(discoverSource, /function HeroSkeleton\(\)/);
  assert.match(discoverSource, /Array\.from\(\{ length: DISCOVER_CRITICAL_GRID_ITEMS \}\)/);
});

test('SEENIT-PERF-001 ne remet pas les enrichissements secondaires sur le chemin critique ou dans le scroll', () => {
  assert.doesNotMatch(discoverSource, /const recs = await getRecommendations\(20\)/);
  assert.match(discoverSource, /void getRecommendations\(20\)[\s\S]*?\.then\(recs => \{[\s\S]*?setRecommendations\(recs\)/);
  assert.match(discoverSource, /useGridVirtualWindow/);
  assert.match(discoverSource, /criticalHomeSliceActive/);
  assert.doesNotMatch(
    cssSource,
    /\.media-grid-card\s*\{[\s\S]*?content-visibility:\s*auto/,
    'le correctif de premier rendu ne doit pas réintroduire content-visibility par carte',
  );
  assert.match(providerPolicySource, /WATCH_PROVIDER_MAX_CONCURRENT/);
  assert.match(providerPolicySource, /addEventListener\('scroll'/);
});

test('SEENIT-PERF-001 E-03 les commandes restent montées pendant le chargement froid', () => {
 assert.match(discoverSource, /aria-label="Rechercher"/);
 // Retour terrain du 17/11 : la barre « Rechercher… » est posée sur le squelette de l'image à la une dès l'entrée.
 assert.match(discoverSource, /showHeroSurface && loading && !visibleHeroItems\.length && <div className="explorer-hero" data-hero-loading>\s*\{!isSearchMode && <button ref=\{heroSearchRef\} type="button" className="explorer-hero-search"[\s\S]*?<HeroSkeleton \/>/);
 assert.doesNotMatch(discoverSource, /ExplorerSkeleton|CategorySkeleton|SortSkeleton/);
});

test('Explorer affiche aussitôt la dernière sélection d’accueil, puis TMDB la remplace (17/11)', async () => {
  const { readExplorerHomeCache, writeExplorerHomeCache, EXPLORER_HOME_CACHE_SIZE } = await import('../src/features/discover/explorerHomeCache.ts');
  const store = new Map<string, string>();
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } };
  const now = Date.parse('2026-11-17T10:00:00Z');
  writeExplorerHomeCache(Array.from({ length: 20 }, (_, index) => ({ id: index + 1, title: `Film ${index + 1}` })), now, storage);
  const seed = readExplorerHomeCache<{ id: number; title: string }>(now + 3600_000, storage);
  assert.equal(seed.length, EXPLORER_HOME_CACHE_SIZE, 'à la une + premières cartes seulement');
  assert.equal(seed[0].title, 'Film 1');
  assert.deepEqual(readExplorerHomeCache(now + 8 * 24 * 3600_000, storage), [], 'au-delà d’une semaine : chargement normal');
  assert.deepEqual(readExplorerHomeCache(now, { getItem: () => '{oops', setItem: () => {} }), [], 'illisible : chargement normal');
  assert.match(discoverSource, /const \[homeSeed\] = useState\(\(\) => readExplorerHomeCache<TMDBMedia>\(\)\);/);
  assert.match(discoverSource, /const \[homeLoading, setHomeLoading\] = useState\(\(\) => homeSeed\.length === 0\);/);
  assert.match(discoverSource, /const keepSeed = seededHome\.current && page === 1 && activeCategory === 'Tout' && !hasActiveFilters;/, 'seulement à la toute première lecture de l’accueil');
  assert.match(discoverSource, /if \(page === 1 && activeCategory === 'Tout' && !hasActiveFilters\) writeExplorerHomeCache\(list\);/);
});

test('SEENIT-DISCOVER-003 E-01 progression incluse dans le hero de hauteur stable', () => {
 assert.match(discoverSource, /h-\[368px\]/);
 assert.match(discoverSource, /className="explorer-hero-dots"/);
 assert.match(discoverSource, /aria-label=\{`Voir la suggestion/);
});

test('#279 garde le placeholder de progression neutre et non interactif', () => {
  const placeholder = discoverSource.match(
    /function HeroProgressSkeleton\(\)[\s\S]*?(?=function GridSkeletons\(\))/,
  )?.[0] ?? '';

  assert.match(placeholder, /Array\.from\(\{ length: 9 \}\)/);
  assert.match(placeholder, /<span className="h-1\.5 w-6 rounded-full bg-zinc-700" \/>/);
  assert.doesNotMatch(placeholder, /<button/);
});

test('#282 adoucit skeleton → cartes au niveau de la grille sans animation individuelle', () => {
  assert.match(cssSource, /@keyframes explorerGridReveal[\s\S]*?opacity:\s*0\.25[\s\S]*?opacity:\s*1/);
  assert.match(
    cssSource,
    /animation:\s*explorerGridReveal 180ms cubic-bezier\(0\.22, 1, 0\.36, 1\) both/,
  );
  assert.match(
    cssSource,
    /:not\(\[aria-hidden="true"\]\)/,
    'le skeleton aria-hidden doit rester stable pendant le chargement',
  );
  assert.match(
    cssSource,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation:\s*none/,
  );
  assert.doesNotMatch(
    cssSource,
    /\.media-grid-card\s*\{[^}]*animation:/,
    'le fondu ne doit pas être appliqué à chaque carte virtualisée',
  );
  assert.doesNotMatch(
    discoverSource,
    /isNewlyLoaded/,
    'Explorer ne doit pas activer l’ancienne animation individuelle des GridMediaCard',
  );
});
