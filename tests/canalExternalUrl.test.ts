import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveCanalProviderTarget } from '../src/features/shows/canalProviderLink.ts';

const presentationSource = readFileSync(new URL('../src/screens/showDetailPresentation.ts', import.meta.url), 'utf8');
const viewSource = readFileSync(new URL('../src/screens/ShowDetailView.tsx', import.meta.url), 'utf8');

test('SEENIT-PLATFORM-001 garde CANAL visible sans navigation non prouvée', () => {
  const target = resolveCanalProviderTarget();

  assert.equal(target.url, null);
  assert.equal(target.kind, 'provider-unavailable');
});

test('issue #446 ne fabrique plus de recherche CANAL ni de faux recours TMDB', () => {
  const resolverSource = readFileSync(new URL('../src/features/shows/canalProviderLink.ts', import.meta.url), 'utf8');

  assert.doesNotMatch(resolverSource, /canalplus\.com\/recherche/i);
  assert.doesNotMatch(resolverSource, /themoviedb\.org/i);
  assert.doesNotMatch(presentationSource, /canalplus\.com\/recherche/i);
  assert.match(presentationSource, /case 381: return '#'/);
});

test('issue #446 rend le badge Canal non navigable au point d’entrée réel', () => {
  assert.match(presentationSource, /resolveCanalProviderTarget\(\)/);
  assert.match(presentationSource, /label: 'Canal'/);
  assert.match(presentationSource, /url: canalTarget\.url/);
  assert.doesNotMatch(presentationSource, /Rechercher sur Canal/);
  assert.doesNotMatch(presentationSource, /Canal\+ · où regarder/);

  assert.match(viewSource, /if \(!directLink\) return <span/);
  assert.match(viewSource, /aria-label=\{providerLink\.title\}/);
  assert.match(viewSource, /return <a key=/);
  assert.match(viewSource, /openExternalUrl\(directLink\)/);
});
