import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('src/screens/EpisodeDetailModalCore.tsx', 'utf8');
const css = readFileSync('src/index.css', 'utf8');

test('le re-téléchargement épisode reste compact et accessible', () => {
  assert.equal(source.includes('<span>Télécharger à nouveau</span>'), false);
  assert.ok(source.includes('className="sr-only">Télécharger à nouveau</span>'));
  assert.ok(css.includes('min-width: 44px;'));
  assert.ok(css.includes('min-height: 44px;'));
});
