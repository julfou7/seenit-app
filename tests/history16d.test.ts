import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildHistoryAriaLabel,
  buildMovieCollectionProgress,
  formatHistoryDayLabel,
  formatHistoryRowDate,
  formatHistoryRuntime,
  historyTimeInputValue,
  parseHistoryLocalDateTime,
  resolveHistoryTimestamp,
} from '../src/features/history/historyPresentation.ts';
import { historyEpisodeEntries, historyEpisodeKey, historyRecordsWithoutTarget, historyLastWatchedAt, materializeHistoryRecords } from '../src/features/history/historyRecords.ts';

test('SEENIT-UX-015 ne fabrique jamais une heure de visionnage legacy', () => {
  const explicit = resolveHistoryTimestamp(1_760_000_000_000, 1_750_000_000_000);
  assert.deepEqual(explicit, { watchedAt: 1_760_000_000_000, timeKnown: true });
  const legacy = resolveHistoryTimestamp(undefined, 1_750_000_000_000);
  assert.deepEqual(legacy, { watchedAt: 1_750_000_000_000, timeKnown: false });
  assert.equal(historyTimeInputValue(legacy!.watchedAt, legacy!.timeKnown), '');
  assert.equal(resolveHistoryTimestamp(undefined, undefined), null);
  const dateOnly = resolveHistoryTimestamp('2026-10-21');
  assert.equal(dateOnly?.timeKnown, false);
  assert.equal(new Date(dateOnly!.watchedAt).getDate(), 21);
});

test('SEENIT-UX-015 conserve les jours calendaires et présente la date courte de la liste v3', () => {
  const now = new Date(2026, 9, 21, 23, 0).getTime();
  assert.equal(formatHistoryRowDate(new Date(2026, 9, 21, 8).getTime(), now), 'Aujourd’hui');
  assert.equal(formatHistoryRowDate(new Date(2026, 9, 13, 8).getTime(), now), '13 oct.');
  assert.equal(formatHistoryDayLabel(new Date(2026, 9, 21, 8, 0).getTime(), now), "Aujourd'hui");
  assert.equal(formatHistoryDayLabel(new Date(2026, 9, 20, 8, 0).getTime(), now), 'Hier');
  assert.match(formatHistoryDayLabel(new Date(2026, 9, 13, 8, 0).getTime(), now), /^Mardi 13 octobre$/);
  assert.match(formatHistoryDayLabel(new Date(2025, 9, 13, 8, 0).getTime(), now), /2025$/);
  assert.equal(formatHistoryRuntime(47), '47 min');
  assert.equal(formatHistoryRuntime(169), '2 h 49');
  assert.equal(formatHistoryRuntime(null), null);
  for (const [year, month, day] of [[2026, 9, 26], [2026, 2, 30]]) {
    assert.equal(formatHistoryDayLabel(new Date(year, month, day - 1, 12).getTime(), new Date(year, month, day, 12).getTime()), 'Hier');
  }
});

test('SEENIT-UX-015 normalise les preuves sans doublon ni résurrection et retire toutes les clés du même épisode', () => {
  const source = { seenEpisodes: ['S01E02', '1x2', '1x3'], episodeRecords: {
    S01E02: { watchedAt: 100, rating: 8 }, '1x2': { watchedAt: 200, rating: 9 },
    '1x8': { watchedAt: 300 },
  } };
  const entries = historyEpisodeEntries(source);
  assert.deepEqual(entries.map(entry => entry.key), ['1x2', '1x3']);
  assert.deepEqual(entries[0].record, { watchedAt: 200, rating: 9 });
  assert.equal(entries[1].record, null);
  assert.equal(historyEpisodeKey(' S01 E02 '), '1x2');
  assert.deepEqual(historyRecordsWithoutTarget(source.episodeRecords, '1x2'), { '1x8': { watchedAt: 300 } });
  assert.deepEqual(historyEpisodeEntries({ ...source, seenEpisodes: [] }), []);
  assert.equal(historyLastWatchedAt(source.episodeRecords, source.seenEpisodes), 200_000);
  assert.equal(historyLastWatchedAt(source.episodeRecords, ['1x3']), null);
});

test('SEENIT-UX-015 conserve une heure facultative lors de la correction manuelle', () => {
  const withTime = parseHistoryLocalDateTime('2026-10-21', '22:07');
  assert.equal(withTime?.timeKnown, true);
  assert.equal(new Date(withTime!.watchedAt).getHours(), 22);
  assert.equal(new Date(withTime!.watchedAt).getMinutes(), 7);
  const dateOnly = parseHistoryLocalDateTime('2026-10-21', '');
  assert.equal(dateOnly?.timeKnown, false);
  assert.equal(historyTimeInputValue(dateOnly!.watchedAt, dateOnly!.timeKnown), '');
  assert.equal(parseHistoryLocalDateTime('2026-02-31', ''), null);
});

test('SEENIT-UX-015 conserve le jour des épisodes legacy voisins avant édition ou retrait', () => {
  const source = { seenEpisodes: ['1x1', '1x2', '1x3'], episodeRecords: {}, lastWatchedAt: new Date(2026, 8, 1, 12).getTime(), createdAt: 1, updatedAt: Date.now() };
  const records = materializeHistoryRecords(source);
  const edited = { ...records, '1x1': { watchedAt: new Date(2026, 9, 21, 20).getTime() } };
  assert.equal(edited['1x2'].watchedAt, source.lastWatchedAt);
  assert.equal(edited['1x2'].watchedTimeKnown, false);
  const removed = historyRecordsWithoutTarget(records, '1x1');
  assert.equal(historyLastWatchedAt(removed, ['1x2', '1x3']), source.lastWatchedAt);
  assert.deepEqual(source.episodeRecords, {}, 'la lecture ne modifie pas le record original utilisé par Annuler');
});

test('SEENIT-UX-015 présente les collections film avec le film courant distinct', () => {
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

test('SEENIT-UX-015 expose la liste compacte v3 et conserve les actions d’historique', () => {
  const source = readFileSync(new URL('../src/components/HistoryFeed.tsx', import.meta.url), 'utf8');
  assert.match(source, /<HistoryEntryRow/);
  assert.doesNotMatch(source, /<SeriesEpisodeCard|displayedGroups|collectionParts/);
  assert.doesNotMatch(source, /CheckCircle2|RotateCcw/);
  assert.match(source, /Marquer non vu/);
  assert.match(source, /Changer la date\/heure/);
  assert.match(source, /Revoir/);
  assert.match(source, /history-entry-list/);
  assert.match(source, /label: 'Marquer non vu', onSelect: \(\) => setUnseenModalItem\(target\)/);
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
