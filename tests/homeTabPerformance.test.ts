import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const watchListViewSource = readFileSync(
  new URL('../src/screens/WatchListView.tsx', import.meta.url),
  'utf8',
);

test('SEENIT-PERF-001 monte les panneaux lourds après le commit visuel du tab', () => {
  assert.match(
    watchListViewSource,
    /const \[mountedHomeTabs, setMountedHomeTabs\] = useState\(\(\) => new Set<WatchListTab>\(\['watch_next', activeTab\]\)\)/,
  );
  assert.match(
    watchListViewSource,
    /useEffect\(\(\) => \{\s*if \(mountedHomeTabs\.has\(activeTab\)\) return;\s*startTransition\(\(\) => \{\s*setMountedHomeTabs/,
    'le tab sélectionné doit pouvoir être peint avant le premier montage lourd',
  );
});

test('SEENIT-PERF-001 conserve À venir et Historique entre deux bascules', () => {
  assert.match(
    watchListViewSource,
    /mountedHomeTabs\.has\('upcoming'\) && <Activity mode=\{activeTab === 'upcoming' \? 'visible' : 'hidden'\}>/,
  );
  assert.match(
    watchListViewSource,
    /mountedHomeTabs\.has\('history'\) && <Activity mode=\{activeTab === 'history' \? 'visible' : 'hidden'\}>/,
  );
  assert.doesNotMatch(
    watchListViewSource,
    /\{activeTab === 'history' && <HistoryFeed/,
    'Historique ne doit plus être démonté à chaque sortie du tab',
  );
  assert.doesNotMatch(
    watchListViewSource,
    /\{activeTab === 'upcoming' && \(upcomingShows\.length/,
    'À venir ne doit plus reconstruire toutes ses cartes à chaque retour',
  );
});

test('SEENIT-PERF-001 suspend les effets des panneaux masqués sans perdre leur état', () => {
  assert.match(watchListViewSource, /import React, \{ Activity, startTransition,/);
  assert.match(
    watchListViewSource,
    /<Activity mode=\{activeTab === 'history' \? 'visible' : 'hidden'\}>\s*<HistoryFeed/,
  );
  assert.match(
    watchListViewSource,
    /<Activity mode=\{activeTab === 'upcoming' \? 'visible' : 'hidden'\}>/,
  );
});
