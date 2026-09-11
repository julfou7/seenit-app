import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hasMoreTmdbPages } from '../src/features/discover/discoverPagination.ts';

const discoverSource = readFileSync(new URL('../src/screens/DiscoverScreen.tsx', import.meta.url), 'utf8');
const providerHookSource = readFileSync(new URL('../src/hooks/usePassiveWatchProvider.ts', import.meta.url), 'utf8');
const cssSource = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');

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

test('Les cartes exposent un état de recherche diffuseur sans dupliquer le cache', () => {
  assert.match(providerHookSource, /readWatchProviderCache/);
  assert.match(providerHookSource, /writeWatchProviderCache/);
  assert.match(providerHookSource, /isProviderLoading/);
  assert.match(providerHookSource, /providerLoading = 'true'/);
  assert.match(providerHookSource, /aria-busy/);
  assert.match(providerHookSource, /finishLoading/);
});

test('Le skeleton diffuseur est compact et respecte reduced-motion', () => {
  assert.match(cssSource, /data-provider-loading/);
  assert.match(cssSource, /providerSkeletonPulse/);
  assert.match(cssSource, /width:\s*1\.75rem/);
  assert.match(cssSource, /height:\s*1\.75rem/);
  assert.match(cssSource, /prefers-reduced-motion: reduce/);
});
