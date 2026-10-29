import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { searchKeyboardGeometry } from '../src/features/discover/searchKeyboardDock.ts';

test('SEENIT-DISCOVER-003 place la recherche au clavier sans double compensation Android', () => {
  assert.deepEqual(searchKeyboardGeometry(900, 560, 0, 900), { bottom: 340, keyboard: true });
  assert.deepEqual(searchKeyboardGeometry(560, 560, 0, 900), { bottom: 0, keyboard: true });
  assert.deepEqual(searchKeyboardGeometry(900, 560, 30, 900), { bottom: 310, keyboard: true });
  assert.deepEqual(searchKeyboardGeometry(900, 900, 0, 900), { bottom: 0, keyboard: false });
  assert.deepEqual(searchKeyboardGeometry(900, 850, 0, 900), { bottom: 50, keyboard: false });
  assert.deepEqual(searchKeyboardGeometry(560, 560, 40, 900), { bottom: 0, keyboard: true });
});

test('SEENIT-DISCOVER-003 câble le dock réel et restaure la nav sans vider la requête', () => {
  const read = (file: string) => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  assert.match(read('src/screens/DiscoverViewCore.tsx'), /<DiscoverSearchDock \{\.\.\.model\} \/>/);
  assert.match(read('src/screens/DiscoverScreen.tsx'), /isSearchMode, enterSearch, exitSearch/);
  assert.match(read('src/components/DiscoverSearchDock.tsx'), /geometry\.keyboard \? 8/);
  assert.match(read('src/components/DiscoverSearchDock.tsx'), /inputRef\.current\?\.blur\(\)/);
  assert.match(read('src/components/bottomNav.css'), /data-discover-search-mode=true/);
  const hook = read('src/hooks/useSearchKeyboardDock.ts');
  assert.match(hook, /viewport\?\.removeEventListener\('resize', update\)/);
  assert.doesNotMatch(hook, /setQuery|setSelected|fetch\(|setInterval/);
});
