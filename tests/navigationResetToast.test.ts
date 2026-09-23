import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  NAVIGATION_TABS,
  getActiveNavigationResetPresentation,
  getNavigationTabPresentation,
  resolveRootNavigationTab,
  withNavigationResetToastContext,
} from '../src/features/navigation/tabPresentation.ts';

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const bottomNavSource = readFileSync(new URL('../src/components/BottomNav.tsx', import.meta.url), 'utf8');
const toastStoreSource = readFileSync(new URL('../src/store/toastStore.ts', import.meta.url), 'utf8');
const toastContainerSource = readFileSync(new URL('../src/components/ToastContainer.tsx', import.meta.url), 'utf8');

test('#292 partage le même mapping glyph entre barre basse et toast de reset', () => {
  assert.deepEqual(
    NAVIGATION_TABS.map(({ id, symbol }) => [id, symbol]),
    [
      ['watchlist', 'watch'],
      ['discover', 'discover'],
      ['downloads', 'download'],
      ['profile', 'profile'],
    ],
  );

  assert.match(bottomNavSource, /NAVIGATION_TABS/);
  assert.doesNotMatch(bottomNavSource, /\{ id: 'watchlist', label: 'À Voir', symbol: 'watch' \}/);
});

test('#292 normalise les sous-vues Profil vers le même onglet racine', () => {
  assert.equal(resolveRootNavigationTab('library'), 'profile');
  assert.equal(resolveRootNavigationTab('settings'), 'profile');
  assert.equal(resolveRootNavigationTab('discover'), 'discover');
  assert.equal(resolveRootNavigationTab('unknown'), null);
});

test('#292 borne le contexte de reset au dispatch synchrone', () => {
  assert.equal(getActiveNavigationResetPresentation(), null);

  withNavigationResetToastContext('watchlist', () => {
    assert.equal(getActiveNavigationResetPresentation()?.symbol, 'watch');
    assert.equal(getNavigationTabPresentation('watchlist').label, 'À Voir');
  });

  assert.equal(getActiveNavigationResetPresentation(), null);
});

test('#292 câble le reset réel vers le contexte puis vers le toast', () => {
  assert.match(appSource, /withNavigationResetToastContext\(rootTab, \(\) => \{/);
  assert.match(appSource, /new CustomEvent\(`\$\{rootTab\}-reset-all`\)/);
  assert.match(toastStoreSource, /getActiveNavigationResetPresentation\(\)/);
  assert.match(toastStoreSource, /iconSymbol: resetPresentation\.symbol/);
  assert.match(toastContainerSource, /if \(parsed\.iconSymbol\)/);
  assert.match(toastContainerSource, /symbol=\{parsed\.iconSymbol\}/);
});

test('#292 retire le cast any du changement d’onglet dans BottomNav', () => {
  assert.doesNotMatch(bottomNavSource, /onTabChange\(tabId as any\)/);
});
