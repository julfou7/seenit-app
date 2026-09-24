import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const actionButtonSource = readFileSync(new URL('../src/components/ui/ActionButton.tsx', import.meta.url), 'utf8');
const checkButtonSource = readFileSync(new URL('../src/components/SeenItCheckButton.tsx', import.meta.url), 'utf8');
const episodeCardSource = readFileSync(new URL('../src/components/EpisodeCard.tsx', import.meta.url), 'utf8');
const gridCardSource = readFileSync(new URL('../src/components/GridMediaCard.tsx', import.meta.url), 'utf8');

test('SEENIT-UX-009 normalise les rôles et états des boutons communs', () => {
  assert.match(actionButtonSource, /'primary'.*'secondary'.*'danger'.*'provider'/s);
  assert.match(actionButtonSource, /min-h-11 min-w-11/);
  assert.match(actionButtonSource, /type=\{type \?\? 'button'\}/);
  assert.match(actionButtonSource, /aria-busy=\{pending \|\| undefined\}/);
  assert.match(actionButtonSource, /disabled=\{isDisabled\}/);
  assert.match(actionButtonSource, /focus-visible:ring-2/);
  assert.match(actionButtonSource, /error && 'ring-1 ring-red-400\/70'/);
});

test('SEENIT-UX-009 fiabilise Vu/Non vu et sérialise la mutation épisode', () => {
  assert.match(checkButtonSource, /isWatched \? 'Marquer comme non vu' : 'Marquer comme vu'/);
  assert.match(checkButtonSource, /aria-pressed=\{isWatched\}/);
  assert.match(checkButtonSource, /aria-busy=\{effectivePending \|\| undefined\}/);
  assert.match(checkButtonSource, /disabled=\{disabled \|\| effectivePending\}/);
  assert.match(checkButtonSource, /await onClick\(e\)/);
  assert.doesNotMatch(checkButtonSource, /1200/);

  assert.match(episodeCardSource, /setIsPending\(true\)/);
  assert.match(episodeCardSource, /await onMarkAsSeen\(show\)/);
  assert.match(episodeCardSource, /pending=\{isPending\}/);
  assert.match(episodeCardSource, /disabled=\{type !== 'watch_next' \|\| !onMarkAsSeen\}/);
  assert.doesNotMatch(episodeCardSource, /setTimeout\(/);
});

test('SEENIT-UX-009 sépare ouverture de carte, action rapide et long press', () => {
  assert.match(gridCardSource, /aria-label=\{openLabel\}/);
  assert.match(gridCardSource, /aria-label=\{quickActionLabel\}/);
  assert.ok(gridCardSource.includes('"w-full py-1 text-center'));
  assert.ok(!gridCardSource.includes('"w-full min-h-11 py-1 text-center'));
  assert.match(gridCardSource, /onPointerCancel=\{cancelLongPress\}/);
  assert.match(gridCardSource, /onPointerMove=\{cancelLongPress\}/);
  assert.match(gridCardSource, /onContextMenu=\{handlePreviewContextMenu\}/);
  assert.match(gridCardSource, /useEffect\(\(\) => \(\) => \{/);
  assert.doesNotMatch(gridCardSource, /onTouchStart=|onTouchEnd=|onMouseDown=|onMouseUp=/);

  assert.ok(episodeCardSource.includes('aria-label={`Ouvrir ${show.title}`}'));
  assert.match(episodeCardSource, /<SeenItCheckButton[\s\S]{0,220}pending=\{isPending\}/);
});
