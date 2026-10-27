import assert from 'node:assert/strict';
import test from 'node:test';
import { buildHistoryRows, historyPeriod, historyPeriodSummary, indexHistoryPeriods, type TimelineEntry } from '../src/features/history/historyTimeline.ts';
import { formatHistoryAriaWhen, formatHistoryClock, formatHistoryRowDate } from '../src/features/history/historyPresentation.ts';

test('SEENIT-PERF-001 indexe 6300 visionnages sans perdre les totaux complets des périodes', () => {
  const now = new Date(2026, 9, 27, 14).getTime();
  const entries: TimelineEntry[] = Array.from({ length: 6300 }, (_, index) => ({
    key: `show:${index}`, showId: `show-${index % 50}`, mediaType: index % 10 ? 'tv' : 'movie',
    season: 1, episode: index + 1, watchedAt: now - (index % 1000) * 86_400_000,
  }));
  const rows = buildHistoryRows(entries);
  const periods = indexHistoryPeriods(rows, now);
  assert.equal([...periods.values()].reduce((sum, period) => sum + period.rows.length, 0), 6300);
  assert.equal(new Set([...periods.values()].flatMap(period => period.rows.map(row => row.key))).size, 6300);
  assert.equal(periods.get('today')?.rows.length, 7);
  assert.equal(periods.get('yesterday')?.rows.length, 7);
  let resolved = 0;
  const totals = [...periods.values()].map(period => historyPeriodSummary(period.rows, () => { resolved++; return 42; }));
  assert.equal(resolved, entries.length, 'une seule résolution de durée par visionnage');
  assert.equal(totals.reduce((sum, total) => sum + total.episodes + total.films, 0), 6300);
  assert.equal(rows.length, 6300, 'l’index ne tronque ni ne mute l’historique source');
});

test('SEENIT-PERF-001 réutilise les formateurs de date sur les grands historiques', () => {
  const original = Intl.DateTimeFormat;
  const originalLocale = Date.prototype.toLocaleDateString;
  let constructions = 0, localeCalls = 0;
  Intl.DateTimeFormat = new Proxy(original, { construct(target, args) { constructions++; return Reflect.construct(target, args); } });
  Date.prototype.toLocaleDateString = function (...args) { localeCalls++; return originalLocale.apply(this, args); };
  try {
    const now = new Date(2026, 9, 27, 14).getTime();
    for (let index = 0; index < 6300; index++) {
      const at = now - (index % 1000) * 86_400_000;
      assert.ok(historyPeriod(at, now).label);
      assert.ok(formatHistoryRowDate(at, now));
      assert.ok(formatHistoryAriaWhen(at, true, now));
      assert.match(formatHistoryClock(at, true)!, /^\d{2}:\d{2}$/);
    }
    assert.equal(constructions, 0, 'aucun nouveau formateur pendant le parcours');
    assert.equal(localeCalls, 0, 'aucune création native cachée par toLocaleDateString');
    assert.equal(formatHistoryClock(now, false), null);
    assert.equal(formatHistoryClock(now, true), '14:00');
  } finally { Intl.DateTimeFormat = original; Date.prototype.toLocaleDateString = originalLocale; }
});
