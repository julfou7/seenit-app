import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hasMoreTmdbPages } from '../src/features/discover/discoverPagination.ts';

const discoverSource = readFileSync(new URL('../src/screens/DiscoverScreen.tsx', import.meta.url), 'utf8');
const providerHookSource = readFileSync(new URL('../src/hooks/usePassiveWatchProvider.ts', import.meta.url), 'utf8');
const cssSource = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const filterModalSource = readFileSync(new URL('../src/components/FilterModal.tsx', import.meta.url), 'utf8');

test('Explorer continue après une page de doublons si TMDB annonce une suite', () => {
  const response = { ok: true, value: { results: [{ id: 42 }], total_pages: 4 } };
  assert.equal(hasMoreTmdbPages(2, response), true);
  assert.equal(hasMoreTmdbPages(4, response), false);
  assert.equal(hasMoreTmdbPages(2, { ok: true, value: { results: [{ id: 42 }] } }), true);
  assert.equal(hasMoreTmdbPages(2, { ok: false }), false);
});

test('Explorer base la fin de pagination sur les pages TMDB brutes', () => {
  assert.match(discoverSource, /hasMoreTmdbPages/);
  assert.doesNotMatch(discoverSource, /updated\.length === prev\.length/);
  assert.match(discoverSource, /hasMoreTmdbPages\(page, popTvRes, popMovRes\)/);
  assert.match(discoverSource, /hasMoreTmdbPages\(page, cinemaRes\)/);
});

test('Explorer reste monté lors d’un changement d’onglet', () => {
  const discoverStart = appSource.indexOf("mountedTabs.has('discover')");
  const downloadsStart = appSource.indexOf("mountedTabs.has('downloads')", discoverStart);
  assert.ok(discoverStart >= 0 && downloadsStart > discoverStart, 'le bloc Explorer doit être détectable');
  const discoverBlock = appSource.slice(discoverStart, downloadsStart);
  assert.doesNotMatch(discoverBlock, /<Activity\b/,
    'Activity détruit et recrée les effets d’Explorer lors du masquage/réaffichage');
  assert.match(discoverBlock, /aria-hidden=\{currentTab !== 'discover'\}/);
  assert.match(discoverBlock, /currentTab === 'discover' \? 'flex-1 min-h-0 flex flex-col' : 'hidden'/,
    'Explorer doit rester monté et être masqué uniquement par CSS hors onglet actif');
});

test('Valider les filtres remonte Explorer avant de remplacer la liste', () => {
  const validateStart = filterModalSource.indexOf('const handleValidate');
  const validateEnd = filterModalSource.indexOf('\n  };', validateStart);
  assert.ok(validateStart >= 0 && validateEnd > validateStart, 'handleValidate doit être détectable');
  const validateSource = filterModalSource.slice(validateStart, validateEnd);
  const scrollIndex = validateSource.indexOf("scrollTo({ top: 0, behavior: 'auto' })");
  const applyIndex = validateSource.indexOf('onApply(selectedPlatforms, selectedGenres, pegi, rating)');
  assert.ok(scrollIndex >= 0 && applyIndex > scrollIndex,
    'le viewport doit revenir en haut avant l’application des nouveaux résultats');
  assert.match(validateSource, /:scope > \.flex-1\.overflow-y-auto/,
    'le reset cible uniquement le scroll principal d’Explorer, pas la zone interne de la modale');
});

test('Les cartes exposent un état de recherche diffuseur sans dupliquer le cache', () => {
  assert.match(providerHookSource, /readWatchProviderCache/);
  assert.match(providerHookSource, /writeWatchProviderCache/);
  assert.match(providerHookSource, /isProviderLoading/);
  assert.match(providerHookSource, /providerLoading = 'true'/);
  assert.match(providerHookSource, /aria-busy/);
  assert.match(providerHookSource, /finishLoading/);
});

test('Le skeleton diffuseur épouse l’arrondi de la carte et respecte reduced-motion', () => {
  assert.match(cssSource, /data-provider-loading/);
  assert.match(cssSource, /providerSkeletonPulse/);
  assert.match(cssSource, /width:\s*1\.75rem/);
  assert.match(cssSource, /height:\s*1\.75rem/);
  assert.match(cssSource, /border-top-right-radius:\s*0\.75rem/,
    'le skeleton situé dans l’angle supérieur droit doit reprendre l’arrondi extérieur de la carte');
  assert.match(cssSource, /border-bottom-left-radius:\s*0\.5rem/);
  assert.match(cssSource, /prefers-reduced-motion: reduce/);
});
