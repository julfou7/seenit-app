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
  assert.match(discoverSource, /void getRecommendations\(20\)[\s\S]*?\.then\(recs => setRecommendations\(recs\)\)/);
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
