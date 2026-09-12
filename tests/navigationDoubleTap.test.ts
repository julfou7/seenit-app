import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  ACTIVE_TAB_DOUBLE_TAP_MS,
  resolveActiveTabTap,
  type ActiveTabTapState,
} from '../src/features/navigation/activeTabTap.ts';

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

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

test('le retour en haut est limité au root de l’onglet actif', () => {
  assert.doesNotMatch(appSource, /document\.querySelectorAll\(/);
  assert.match(appSource, /document\.querySelector<HTMLElement>\(`\[data-app-tab=/);
  assert.match(appSource, /data-app-tab="discover"/);
  assert.match(appSource, /data-app-tab="downloads"/);
  assert.match(appSource, /data-app-tab="watchlist"/);
  assert.match(appSource, /data-app-tab="profile"/);
});

test('le double appui ne déclenche aucune action métier de téléchargement', () => {
  const start = appSource.indexOf('const handleActiveTabDoubleClick = () => {');
  const end = appSource.indexOf('\n\n  return (', start);
  assert.ok(start >= 0 && end > start);
  const handler = appSource.slice(start, end);

  assert.doesNotMatch(handler, /fetchDownloads|removeDownload|clearAllDownloads|beginDownloadRequest|pushReleaseDirectly/);
  assert.match(handler, /currentTab === 'discover'/);
  assert.doesNotMatch(handler, /currentTab === 'downloads'[\s\S]*dispatchEvent/);
});
