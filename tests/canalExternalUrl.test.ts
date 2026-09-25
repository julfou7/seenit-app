import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getProviderLinkPresentation } from '../src/screens/showDetailPresentation.ts';

const viewSource = readFileSync(new URL('../src/screens/ShowDetailView.tsx', import.meta.url), 'utf8');

test('SEENIT-PLATFORM-001 garde le CTA CANAL sur l’identité TMDB exacte sans faux deep link', () => {
  const exactWatchUrl = 'https://www.themoviedb.org/tv/12345/watch?locale=FR';
  const target = getProviderLinkPresentation({
    providerId: 381,
    providerName: 'Canal+',
    title: 'MobLand',
    fallbackLink: exactWatchUrl,
    mediaType: 'tv',
    tmdbId: 12345,
  });

  assert.equal(target.url, exactWatchUrl);
  assert.equal(target.kind, 'exact-media-watch');
  assert.equal(target.label, 'Canal+ · où regarder');
  assert.match(target.title, /lien myCANAL direct indisponible/);
  assert.doesNotMatch(target.url, /canalplus\.com\/recherche/);
});

test('issue #446 refuse un lien TMDB appartenant à un homonyme et annonce la recherche CANAL', () => {
  const target = getProviderLinkPresentation({
    providerId: 381,
    providerName: 'Canal+',
    title: 'Dark Matter',
    fallbackLink: 'https://www.themoviedb.org/tv/99999/watch?locale=FR',
    mediaType: 'tv',
    tmdbId: 12345,
  });

  assert.equal(target.kind, 'provider-search');
  assert.equal(target.label, 'Rechercher sur Canal+');
  assert.match(target.url, /^https:\/\/www\.canalplus\.com\/recherche\/\?q=Dark%20Matter$/);
  assert.equal(target.title, 'Rechercher « Dark Matter » sur Canal+');
});

test('issue #446 câble le média exact dans le point d’entrée réel de la fiche', () => {
  assert.match(viewSource, /getProviderLinkPresentation\(\{/);
  assert.match(viewSource, /mediaType: isSeries \? 'tv' : 'movie'/);
  assert.match(viewSource, /tmdbId: effectiveTmdbId/);
  assert.match(viewSource, /title=\{providerLink\.title\}/);
  assert.match(viewSource, /<span>\{providerLink\.label\}<\/span>/);
  assert.doesNotMatch(viewSource, /title=\{`Ouvrir \$\{provider\.provider_name\}`\}/);
});
