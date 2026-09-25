import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveCanalProviderTarget } from '../src/features/shows/canalProviderLink.ts';

const presentationSource = readFileSync(new URL('../src/screens/showDetailPresentation.ts', import.meta.url), 'utf8');
const viewSource = readFileSync(new URL('../src/screens/ShowDetailView.tsx', import.meta.url), 'utf8');

test('SEENIT-PLATFORM-001 garde le CTA CANAL sur l’identité TMDB exacte sans faux deep link', () => {
  const exactWatchUrl = 'https://www.themoviedb.org/tv/12345/watch?locale=FR';
  const target = resolveCanalProviderTarget({
    title: 'MobLand',
    fallbackLink: exactWatchUrl,
    mediaType: 'tv',
    tmdbId: 12345,
  });

  assert.equal(target.url, exactWatchUrl);
  assert.equal(target.kind, 'exact-media-watch');
  assert.doesNotMatch(target.url, /canalplus\.com\/recherche/);
});

test('issue #446 refuse un lien TMDB appartenant à un homonyme et ne fabrique qu’une recherche CANAL', () => {
  const target = resolveCanalProviderTarget({
    title: 'Dark Matter',
    fallbackLink: 'https://www.themoviedb.org/tv/99999/watch?locale=FR',
    mediaType: 'tv',
    tmdbId: 12345,
  });

  assert.equal(target.kind, 'provider-search');
  assert.match(target.url, /^https:\/\/www\.canalplus\.com\/recherche\/\?q=Dark%20Matter$/);
});

test('issue #446 garde le fallback honnête dans la présentation et le point d’entrée réel', () => {
  assert.match(presentationSource, /resolveCanalProviderTarget\(\{ title, fallbackLink, mediaType, tmdbId \}\)/);
  assert.match(presentationSource, /label: 'Canal\+ · où regarder'/);
  assert.match(presentationSource, /label: 'Rechercher sur Canal\+'/);
  assert.match(presentationSource, /lien myCANAL direct indisponible/);

  assert.match(viewSource, /getProviderLinkPresentation\(\{/);
  assert.match(viewSource, /mediaType: isSeries \? 'tv' : 'movie'/);
  assert.match(viewSource, /tmdbId: effectiveTmdbId/);
  assert.match(viewSource, /title=\{providerLink\.title\}/);
  assert.match(viewSource, /<span>\{providerLink\.label\}<\/span>/);
});
