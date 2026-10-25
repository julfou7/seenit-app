import { historyLocalDayKey } from './historyPresentation.ts';

export interface TimelineEntry { key: string; showId: string; mediaType: 'tv' | 'movie'; season: number; episode: number; watchedAt: number; watchedTimeKnown?: boolean }
export interface TimelineRow<T extends TimelineEntry> { key: string; item: T; members: T[]; day: string }
const ordinal = (day: string) => { const [year, month, date] = day.split('-').map(Number); return Date.UTC(year, month - 1, date) / 86_400_000; };

/** Bulk season writes share one timestamp: order their episodes numerically before grouping. */
export function compareHistoryEntries(left: TimelineEntry, right: TimelineEntry): number {
  const leftDay = historyLocalDayKey(left.watchedAt), rightDay = historyLocalDayKey(right.watchedAt);
  if (leftDay !== rightDay) return rightDay.localeCompare(leftDay);
  const leftKnown = left.watchedTimeKnown !== false, rightKnown = right.watchedTimeKnown !== false;
  if (leftKnown !== rightKnown) return leftKnown ? -1 : 1;
  if (leftKnown && left.watchedAt !== right.watchedAt) return right.watchedAt - left.watchedAt;
  const showOrder = left.showId.localeCompare(right.showId);
  if (showOrder) return showOrder;
  if (leftKnown && left.mediaType === 'tv' && right.mediaType === 'tv') {
    const episodeOrder = right.season - left.season || right.episode - left.episode;
    if (episodeOrder) return episodeOrder;
  }
  return left.key.localeCompare(right.key);
}

/** One persisted viewing is one row, including bulk writes with equal timestamps. */
export function buildHistoryRows<T extends TimelineEntry>(items: readonly T[]): TimelineRow<T>[] {
  return items.map(item => ({ key: item.key, item, members: [item], day: historyLocalDayKey(item.watchedAt) }));
}

export function historyPeriod(watchedAt: number, now = Date.now()): { key: string; label: string; today: boolean } {
  const day = historyLocalDayKey(watchedAt), today = historyLocalDayKey(now), age = ordinal(today) - ordinal(day);
  if (age <= 0) return { key: 'today', label: "Aujourd’hui", today: true };
  if (age === 1) return { key: 'yesterday', label: 'Hier', today: false };
  if (age <= 6) return { key: 'week', label: 'Cette semaine', today: false };
  if (age <= 13) return { key: 'last-week', label: 'La semaine dernière', today: false };
  const date = new Date(watchedAt), current = new Date(now), month = date.toLocaleDateString('fr-FR', { month: 'long' });
  if (day.slice(0, 7) === today.slice(0, 7)) return { key: 'earlier-month', label: `Plus tôt en ${month}`, today: false };
  return { key: day.slice(0, 7), label: month[0].toUpperCase() + month.slice(1) + (date.getFullYear() !== current.getFullYear() ? ` ${date.getFullYear()}` : ''), today: false };
}

export function historyGroupCode<T extends TimelineEntry>(row: TimelineRow<T>): string | undefined {
  if (row.item.mediaType === 'movie') return undefined;
  const first = row.item;
  const season = (value: number) => `S${String(value).padStart(2, '0')}`;
  const episode = (value: number) => `E${String(value).padStart(2, '0')}`;
  return `${season(first.season)} | ${episode(first.episode)}`;
}

export function historyPeriodSummary<T extends TimelineEntry>(rows: readonly TimelineRow<T>[], minutes: (item: T) => number | null) {
  const items = rows.flatMap(row => row.members);
  const episodes = items.filter(item => item.mediaType === 'tv').length, films = items.length - episodes;
  const durations = items.map(minutes), sum = durations.reduce<number>((total, value) => total + (value || 0), 0);
  const known = durations.some(value => value !== null), partial = durations.some(value => value === null);
  return { episodes, films, duration: known ? `${partial ? '≥ ' : ''}${Math.floor(sum / 60)} h ${String(Math.round(sum % 60)).padStart(2, '0')}` : null };
}
