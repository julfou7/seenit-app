import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildHistoryAriaLabel,
  buildMovieCollectionProgress,
  formatHistoryDayLabel,
  formatHistoryRuntime,
  historyTimeInputValue,
  parseHistoryLocalDateTime,
  resolveHistoryTimestamp,
} from '../src/features/history/historyPresentation.ts';

test('SEENIT-UX-014 16d ne fabrique jamais une heure de visionnage legacy', () => {
  const explicit = resolveHistoryTimestamp(1_760_000_000_000, 1_750_000_000_000);
  assert.deepEqual(explicit, { watchedAt: 1_760_000_000_000, timeKnown: true });
  const legacy = resolveHistoryTimestamp(undefined, 1_750_000_000_000);
  assert.deepEqual(legacy, { watchedAt: 1_750_000_000_000, timeKnown: false });
  assert.equal(historyTimeInputValue(legacy!.watchedAt, legacy!.timeKnown), '');
  assert.equal(resolveHistoryTimestamp(undefined, undefined), null);
});

test('SEENIT-UX-014 16d groupe les jours et formate les durées sans répéter la date dans les cartes', () => {
  const now = new Date(2026, 9, 21, 23, 0).getTime();
  assert.equal(formatHistoryDayLabel(new Date(2026, 9, 21, 8, 0).getTime(), now), "Aujourd'hui");
  assert.equal(formatHistoryDayLabel(new Date(2026, 9, 20, 8, 0).getTime(), now), 'Hier');
  assert.match(formatHistoryDayLabel(new Date(2026, 9, 13, 8, 0).getTime(), now), /^Mardi 13 octobre$/);
  assert.match(formatHistoryDayLabel(new Date(2025, 9, 13, 8, 0).getTime(), now), /2025$/);
  assert.equal(formatHistoryRuntime(47), '47 min');
  assert.equal(formatHistoryRuntime(169), '2 h 49');
  assert.equal(formatHistoryRuntime(null), null);
});

test('SEENIT-UX-014 16d conserve une heure facultative lors de la correction manuelle', () => {
  const withTime = parseHistoryLocalDateTime('2026-10-21', '22:07');
  assert.equal(withTime?.timeKnown, true);
  assert.equal(new Date(withTime!.watchedAt).getHours(), 22);
  assert.equal(new Date(withTime!.watchedAt).getMinutes(), 7);
  const dateOnly = parseHistoryLocalDateTime('2026-10-21', '');
  assert.equal(dateOnly?.timeKnown, false);
  assert.equal(historyTimeInputValue(dateOnly!.watchedAt, dateOnly!.timeKnown), '');
  assert.equal(parseHistoryLocalDateTime('2026-02-31', ''), null);
});

test('SEENIT-UX-014 16d présente les collections film avec le film courant distinct', () => {
  const progress = buildMovieCollectionProgress([
    { id: 1, releaseDate: '2010-01-01' },
    { id: 2, releaseDate: '2014-01-01' },
    { id: 3, releaseDate: '2030-01-01' },
    { id: 4 },
  ], 2, new Set([1, 2]), '2026-10-21');
  assert.deepEqual(progress.segments.map(segment => segment.state), ['seen', 'history', 'future', 'unknown']);
  assert.equal(progress.continuous, false);
  const standalone = buildMovieCollectionProgress([], 2, new Set([2]), '2026-10-21');
  assert.deepEqual(standalone.segments, [{ state: 'history', count: 1 }]);
});

test('SEENIT-UX-014 16d expose une carte unique, une heure décorative et les actions d’historique', () => {
  const source = readFileSync(new URL('../src/components/HistoryFeed.tsx', import.meta.url), 'utf8');
  assert.match(source, /<SeriesEpisodeCard/);
  assert.doesNotMatch(source, /CheckCircle2|RotateCcw/);
  assert.match(source, /Marquer non vu/);
  assert.match(source, /Changer la date\/heure/);
  assert.match(source, /Revoir/);
  assert.match(source, /history-16d__group-title/);
  assert.match(source, /onUnseen: \(\) => setUnseenModalItem\(item\)/);
  assert.match(source, /onOpen=\{handleRowClick\}/);

  const card = readFileSync(new URL('../src/components/cards/SeriesEpisodeCard.tsx', import.meta.url), 'utf8');
  assert.match(card, /watchedTimeKnown/);
  assert.match(card, /<div className="series-8f__history" aria-hidden="true">/);
  assert.doesNotMatch(card, /Heure inconnue/);

  const aria = buildHistoryAriaLabel({
    title: 'Breaking Bad', mediaType: 'tv', season: 5, episode: 14, episodeTitle: 'Ozymandias',
    watchedAt: new Date(2026, 9, 21, 22, 7).getTime(), timeKnown: true,
    now: new Date(2026, 9, 21, 23, 0).getTime(),
  });
  assert.equal(aria, "Breaking Bad, saison 5 épisode 14, Ozymandias, vu aujourd'hui à 22 h 07");
});
