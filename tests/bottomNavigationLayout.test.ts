import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const bottomNavSource = readFileSync(
  new URL('../src/components/BottomNav.tsx', import.meta.url),
  'utf8'
);

test('la navigation basse garde Profil à droite et Télécharger en troisième position lorsqu’il est visible', () => {
  const watchlistIndex = bottomNavSource.indexOf("{ id: 'watchlist', label: 'À Voir'");
  const discoverIndex = bottomNavSource.indexOf("{ id: 'discover', label: 'Explorer'");
  const downloadsIndex = bottomNavSource.indexOf("{ id: 'downloads', label: 'Télécharger'");
  const profileIndex = bottomNavSource.indexOf("{ id: 'profile', label: 'Profil'");

  assert.ok(watchlistIndex >= 0);
  assert.ok(discoverIndex > watchlistIndex);
  assert.ok(downloadsIndex > discoverIndex);
  assert.ok(profileIndex > downloadsIndex);
  assert.match(
    bottomNavSource,
    /const visibleTabs = downloadsEnabled \? tabs : tabs\.filter\(tab => tab\.id !== 'downloads'\)/
  );
});

test('la navigation basse exploite sa largeur avec des icônes et cibles tactiles lisibles', () => {
  assert.match(bottomNavSource, /size=\{28\}/);
  assert.match(bottomNavSource, /min-h-\[52px\] min-w-\[44px\] flex-1/);
  assert.match(bottomNavSource, /text-\[10px\] sm:text-\[11px\]/);
  assert.doesNotMatch(bottomNavSource, /max-w-\[(72|80)px\]/);
  assert.match(bottomNavSource, /aria-current=\{isActive \? 'page' : undefined\}/);
});
