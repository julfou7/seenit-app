import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const discoverSource = readFileSync(new URL('../src/screens/DiscoverScreen.tsx', import.meta.url), 'utf8');
const providerPolicySource = readFileSync(new URL('../src/features/providers/watchProviderRequestPolicy.ts', import.meta.url), 'utf8');
const cssSource = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');

test('SEENIT-PERF-001 libère Explorer dès le trending et borne le premier viewport', () => {
  assert.match(discoverSource, /const DISCOVER_CRITICAL_GRID_ITEMS = 6/);
  assert.match(discoverSource, /const trendAllRes = await trendAllPromise/);
  assert.match(discoverSource, /if \(trendingList\.length > 0\)[\s\S]*?if \(page === 1\) setLoading\(false\)/);
  assert.match(discoverSource, /const visibleHeroItems = criticalHomeSliceActive \? top10\.slice\(0, 1\) : top10/);
  assert.match(discoverSource, /uniqueProcessedResults\.slice\(0, DISCOVER_CRITICAL_GRID_ITEMS\)/);
  assert.match(discoverSource, /if \(isLoadingMore \|\| loading \|\| criticalHomeSliceActive/);
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

test('SEENIT-PERF-001 rend les libellés stables pendant le chargement froid', () => {
  assert.match(discoverSource, /<span>Explorer<\/span>/);
  assert.match(discoverSource, /showHeroSurface && loading && top10\.length === 0 && <HeroSkeleton \/>/);
  assert.doesNotMatch(discoverSource, /ExplorerSkeleton|CategorySkeleton|SortSkeleton/);
});

test('#279 réserve la progression du HERO du skeleton au carrousel complet', () => {
  assert.match(discoverSource, /const HERO_PROGRESS_LAYOUT_CLASS = "flex h-1\.5 items-center justify-center gap-1\.5 mt-3 mb-2"/);
  assert.match(discoverSource, /function HeroProgressSkeleton\(\)/);
  assert.match(
    discoverSource,
    /function HeroSkeleton\(\)[\s\S]*?<HeroProgressSkeleton \/>[\s\S]*?function HeroProgressSkeleton\(\)/,
  );
  assert.match(
    discoverSource,
    /visibleHeroItems\.length > 1 \? \([\s\S]*?className=\{HERO_PROGRESS_LAYOUT_CLASS\}[\s\S]*?: \([\s\S]*?<HeroProgressSkeleton \/>/,
  );
  assert.doesNotMatch(discoverSource, /\{visibleHeroItems\.length > 1 && \(/);
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
