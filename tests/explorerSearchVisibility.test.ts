import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const discoverSource = readFileSync(new URL('../src/screens/DiscoverScreen.tsx', import.meta.url), 'utf8');

test('Explorer garde la recherche masquée pendant une descente tactile', () => {
  const touchHandler = discoverSource.match(/const handleTouchMove = \(e: React\.TouchEvent\) => \{([\s\S]*?)\n  \};/);
  assert.ok(touchHandler, 'le gestionnaire tactile Explorer doit rester déclaré');
  assert.match(
    touchHandler[1],
    /diff < -25 && isSearchVisible[\s\S]*?setIsSearchVisible\(false\)/,
    'un doigt qui remonte (contenu qui descend) doit masquer ou garder masquée la recherche',
  );
  assert.doesNotMatch(
    touchHandler[1],
    /diff < -25 && !isSearchVisible[\s\S]*?setIsSearchVisible\(true\)/,
    'une descente dans le contenu ne doit jamais réafficher la recherche',
  );
});

test('Explorer ne réaffiche la recherche tactile que lors de la remontée', () => {
  const touchHandler = discoverSource.match(/const handleTouchMove = \(e: React\.TouchEvent\) => \{([\s\S]*?)\n  \};/);
  assert.ok(touchHandler, 'le gestionnaire tactile Explorer doit rester déclaré');
  assert.match(
    touchHandler[1],
    /diff > 25 && !isSearchVisible[\s\S]*?setIsSearchVisible\(true\)/,
    'un doigt qui redescend (contenu qui remonte) doit réafficher la recherche',
  );
});

test('le scroll réel conserve la même sémantique de direction', () => {
  const scrollHandler = discoverSource.match(/const handleScroll = useCallback\(\(event: React\.UIEvent<HTMLDivElement>\) => \{([\s\S]*?)\n  \}, \[\]\);/);
  assert.ok(scrollHandler, 'le gestionnaire de scroll Explorer doit rester déclaré');
  assert.match(scrollHandler[1], /currentScrollY > lastScrollY\.current \+ 10[\s\S]*?setIsSearchVisible\(current => current \? false : current\)/);
  assert.match(scrollHandler[1], /currentScrollY < lastScrollY\.current - 10[\s\S]*?setIsSearchVisible\(current => current \? current : true\)/);
});
