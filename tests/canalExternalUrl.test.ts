import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveCanalProviderTarget } from '../src/features/shows/canalProviderLink.ts';
import { CANAL_ANDROID_PACKAGE, CANAL_WEB_URL, isCanalWebUrl } from '../src/lib/canalExternalUrl.ts';

const presentationSource = readFileSync(new URL('../src/screens/showDetailPresentation.ts', import.meta.url), 'utf8');
const viewSource = readFileSync(new URL('../src/screens/ShowDetailView.tsx', import.meta.url), 'utf8');
const utilsSource = readFileSync(new URL('../src/lib/utils.ts', import.meta.url), 'utf8');
const manifestSource = readFileSync(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');

test('SEENIT-PLATFORM-001 ouvre CANAL par l’application Android sans faux deep link média', () => {
  const target = resolveCanalProviderTarget();

  assert.equal(target.url, CANAL_WEB_URL);
  assert.equal(target.kind, 'provider-app-home');
  assert.equal(CANAL_ANDROID_PACKAGE, 'com.canal.android.canal');
  assert.equal(isCanalWebUrl(target.url), true);
});

test('issue #446 ne réintroduit ni recherche CANAL ni faux recours TMDB', () => {
  const resolverSource = readFileSync(new URL('../src/features/shows/canalProviderLink.ts', import.meta.url), 'utf8');

  assert.doesNotMatch(resolverSource, /canalplus\.com\/recherche/i);
  assert.doesNotMatch(resolverSource, /themoviedb\.org/i);
  assert.doesNotMatch(presentationSource, /canalplus\.com\/recherche/i);
  assert.doesNotMatch(presentationSource, /Rechercher sur Canal/);
  assert.match(presentationSource, /label: 'Canal'/);
  assert.match(presentationSource, /title: 'Ouvrir Canal'/);
});

test('issue #446 câble le tap Canal vers le package Android officiel au point d’entrée réel', () => {
  assert.match(viewSource, /openExternalUrl\(directLink\)/);
  assert.match(utilsSource, /isCanalWebUrl\(targetUrl\)/);
  assert.match(utilsSource, /AppLauncher\.openUrl\(\{ url: CANAL_ANDROID_PACKAGE \}\)/);
  assert.match(utilsSource, /Browser\.open\(\{ url: targetUrl, windowName: '_system' \}\)/);
  assert.match(manifestSource, /<package android:name="com\.canal\.android\.canal" \/>/);
});
