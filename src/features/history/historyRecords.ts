import type { Show } from '../../types';
import { resolveHistoryTimestamp } from './historyPresentation.ts';

export function historyEpisodeKey(value: string): string | null {
  const match = /^(?:s\s*)?(\d+)\s*(?:x|e)\s*(\d+)$/i.exec(value.trim());
  if (!match) return null;
  const season = Number(match[1]);
  const episode = Number(match[2]);
  return Number.isSafeInteger(season) && season >= 0 && Number.isSafeInteger(episode) && episode > 0
    ? `${season}x${episode}` : null;
}

export function historyEpisodeEntries(show: Pick<Show, 'seenEpisodes' | 'episodeRecords'>) {
  const seen = Array.isArray(show.seenEpisodes) ? new Set(show.seenEpisodes.map(historyEpisodeKey).filter(Boolean)) : null;
  const records = new Map<string, Record<string, unknown>>();
  for (const [rawKey, rawRecord] of Object.entries(show.episodeRecords || {})) {
    const key = historyEpisodeKey(rawKey);
    if (!key || (seen && !seen.has(key)) || !rawRecord || typeof rawRecord !== 'object') continue;
    if (!records.has(key) || rawKey === key) records.set(key, rawRecord);
  }
  const keys = seen ? [...seen] : [...records.keys()];
  return keys.flatMap(key => key ? [{ key, record: records.get(key) ?? null }] : []);
}

export function historyRecordsWithoutTarget(records: Show['episodeRecords'], key: string): Show['episodeRecords'] {
  return Object.fromEntries(Object.entries(records || {}).filter(([rawKey]) => (historyEpisodeKey(rawKey) || rawKey) !== key));
}

export function historyLastWatchedAt(records: Show['episodeRecords'], seenEpisodes: readonly string[]): number | null {
  const seen = new Set(seenEpisodes.map(key => historyEpisodeKey(key) || key));
  let latest: number | null = null;
  for (const [key, record] of Object.entries(records)) {
    if (!seen.has(historyEpisodeKey(key) || key)) continue;
    const timing = resolveHistoryTimestamp(record.watchedAt);
    if (timing) latest = Math.max(latest || 0, timing.watchedAt);
  }
  return latest;
}

/** Fige le jour legacy avant qu'une mutation voisine ne change le repli du Show. */
export function materializeHistoryRecords(show: Pick<Show, 'episodeRecords' | 'seenEpisodes' | 'lastWatchedAt' | 'updatedAt' | 'createdAt'>): Show['episodeRecords'] {
  const records = { ...show.episodeRecords };
  const fallback = resolveHistoryTimestamp(undefined, show.lastWatchedAt, show.updatedAt, show.createdAt);
  if (!fallback) return records;
  for (const entry of historyEpisodeEntries(show)) {
    if (resolveHistoryTimestamp(entry.record?.watchedAt)) continue;
    records[entry.key] = { ...entry.record, watchedAt: fallback.watchedAt, watchedTimeKnown: false };
  }
  return records;
}
