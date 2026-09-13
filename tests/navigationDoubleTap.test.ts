import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  ACTIVE_TAB_DOUBLE_TAP_MS,
  resolveActiveTabTap,
  type ActiveTabTapState,
} from '../src/features/navigation/activeTabTap.ts';

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const bottomNavSource = readFileSync(new URL('../src/components/BottomNav.tsx', import.meta.url), 'utf8');
const downloadsScreenSource = readFileSync(new URL('../src/screens/DownloadsScreen.tsx', import.meta.url), 'utf8');
const downloadsCoreSource = readFileSync(new URL('../src/screens/DownloadsScreenCore.tsx', import.meta.url), 'utf8');
const discoverSource = readFileSync(new URL('../src/screens/DiscoverScreen.tsx', import.meta.url), 'utf8');
const watchlistSource = readFileSync(new URL('../src/screens/WatchListScreen.tsx', import.meta.url), 'utf8');
const profileSource = readFileSync(new URL('../src/screens/ProfileScreen.tsx', import.meta.url), 'utf8');

function tap(
  currentTab: string,
  tappedTab: string,
  previousTap: ActiveTabTapState | null,
  now: number,
) {
  return resolveActiveTabTap(currentTab, tappedTab, previousTap, now);
}

test('Explorer reconnait un double appui uniquement sur l’onglet déjà actif', () => {
  const first = tap('discover', 'discover', null, 1_000);
  assert.equal(first.action, 'active-single');

  const second = tap('discover', 'discover', first.nextTap, 1_250);
  assert.equal(second.action, 'active-double');
  assert.equal(second.nextTap, null);
});

test('Télécharger reconnait le même contrat de double appui qu’Explorer', () => {
  const first = tap('downloads', 'downloads', null, 10_000);
  const second = tap('downloads', 'downloads', first.nextTap, 10_300);

  assert.equal(first.action, 'active-single');
  assert.equal(second.action, 'active-double');
});

test('A vers B puis B ne compte jamais comme un double appui sur B', () => {
  const change = tap('discover', 'downloads', { tabId: 'discover', at: 1_000 }, 1_100);
  assert.equal(change.action, 'change-tab');
  assert.equal(change.nextTap, null);

  const firstActiveTap = tap('downloads', 'downloads', change.nextTap, 1_200);
  assert.equal(firstActiveTap.action, 'active-single');

  const secondActiveTap = tap('downloads', 'downloads', firstActiveTap.nextTap, 1_350);
  assert.equal(secondActiveTap.action, 'active-double');
});

test('la borne temporelle et le triple appui sont déterministes', () => {
  const first = tap('discover', 'discover', null, 2_000);
  const boundary = tap('discover', 'discover', first.nextTap, 2_000 + ACTIVE_TAB_DOUBLE_TAP_MS);
  assert.equal(boundary.action, 'active-single');

  const fastFirst = tap('downloads', 'downloads', null, 3_000);
  const double = tap('downloads', 'downloads', fastFirst.nextTap, 3_200);
  const third = tap('downloads', 'downloads', double.nextTap, 3_300);
  assert.equal(double.action, 'active-double');
  assert.equal(third.action, 'active-single');
});

test('SEENIT-UX-005 adresse un reset local distinct à chaque onglet', () => {
  assert.doesNotMatch(appSource, /document\.querySelectorAll\(/);
  assert.match(appSource, /new CustomEvent\(`\$\{rootTab\}-reset-all`\)/);
  assert.match(discoverSource, /addEventListener\('discover-reset-all'/);
  assert.match(watchlistSource, /addEventListener\('watchlist-reset-all'/);
  assert.match(downloadsCoreSource, /addEventListener\('downloads-reset-all'/);
  assert.match(profileSource, /addEventListener\('profile-reset-all'/);
  assert.doesNotMatch(bottomNavSource, /downloads-scroll-top/);
});

test('SEENIT-UX-005 Télécharger efface sa recherche sans appel métier', () => {
  const combined = `${bottomNavSource}\n${downloadsScreenSource}\n${downloadsCoreSource}`;

  const resetStart = downloadsCoreSource.indexOf('const handleResetAll = () =>');
  const resetEnd = downloadsCoreSource.indexOf("window.addEventListener('downloads-back-one-level'", resetStart);
  const resetBlock = downloadsCoreSource.slice(resetStart, resetEnd);
  assert.match(resetBlock, /setSearchQuery\(''\)/);
  assert.match(resetBlock, /setSelectedMediaType\('all'\)/);
  assert.match(resetBlock, /setSelectedQuality\('all'\)/);
  assert.match(resetBlock, /setShowConfiguration\(false\)/);
  assert.match(resetBlock, /setViewMode\('downloads'\)/);
  assert.match(resetBlock, /Télécharger réinitialisé/);
  assert.doesNotMatch(resetBlock, /fetchDownloads|removeDownload|clearAllDownloads|beginDownloadRequest|pushReleaseDirectly/);
  assert.match(combined, /searchRequestRef\.current \+= 1/,
    'un résultat C411 lancé avant le reset ne doit pas restaurer la recherche');
});
