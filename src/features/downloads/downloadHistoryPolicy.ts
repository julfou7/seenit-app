import type { LiveDownloadItem } from '../../services/sonarrRadarr.ts';
import {
  getPhysicalDownloadIds,
  normalizeDownloadClientId,
  normalizeDownloadRelease,
  normalizeQualityLabel
} from './downloadIdentity.ts';

export interface DownloadHistorySource {
  configured: boolean;
  ok: boolean;
  records: unknown[];
  error?: string;
}

export interface DownloadHistorySnapshot {
  checkedAt: number;
  radarr: DownloadHistorySource;
  sonarr: DownloadHistorySource;
}

export interface DownloadHistoryOutcome {
  state: 'completed' | 'failed' | 'unknown';
  quality?: string;
  date?: number;
  message?: string;
}

type HistoryMatchStrength = 'physical' | 'canonical-release' | 'canonical' | 'none';

interface HistoryRecord {
  eventType?: unknown;
  date?: unknown;
  downloadId?: unknown;
  sourceTitle?: unknown;
  movie?: {
    tmdbId?: unknown;
  };
  series?: {
    tmdbId?: unknown;
  };
  episode?: {
    seasonNumber?: unknown;
    episodeNumber?: unknown;
  };
  quality?: {
    quality?: {
      name?: unknown;
    };
  };
  data?: {
    downloadId?: unknown;
    downloadClientId?: unknown;
    sourceTitle?: unknown;
    releaseTitle?: unknown;
    message?: unknown;
    reason?: unknown;
  };
}

function asRecord(value: unknown): HistoryRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as HistoryRecord
    : {};
}

function recordDate(record: HistoryRecord): number {
  const parsed = Date.parse(typeof record.date === 'string' ? record.date : '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function eventKind(record: HistoryRecord): 'completed' | 'failed' | 'other' {
  const raw = record.eventType;
  const numeric = Number(raw);
  if (numeric === 3) return 'completed';
  if (numeric === 4) return 'failed';

  const text = String(raw || '').toLowerCase();
  if (text.includes('downloadfolderimported') || text.includes('seriesfolderimported')) return 'completed';
  if (text.includes('downloadfailed')) return 'failed';
  return 'other';
}

function recordDownloadId(record: HistoryRecord): string | null {
  return normalizeDownloadClientId(
    record.downloadId
    ?? record.data?.downloadId
    ?? record.data?.downloadClientId
  );
}

function canonicalTmdbMatches(item: LiveDownloadItem, record: HistoryRecord): boolean {
  if (!item.tmdbId) return false;
  const remoteTmdbId = item.mediaType === 'movie'
    ? record.movie?.tmdbId
    : record.series?.tmdbId;
  return Boolean(remoteTmdbId && Number(item.tmdbId) === Number(remoteTmdbId));
}

function episodeScopeMatches(item: LiveDownloadItem, record: HistoryRecord): boolean {
  if (item.mediaType !== 'tv') return true;
  const episode = record.episode;
  if (item.seasonNumber != null && episode?.seasonNumber != null
      && Number(item.seasonNumber) !== Number(episode.seasonNumber)) return false;
  if (item.episodeNumber != null && episode?.episodeNumber != null
      && Number(item.episodeNumber) !== Number(episode.episodeNumber)) return false;
  return true;
}

function releaseMatches(item: LiveDownloadItem, record: HistoryRecord): boolean {
  const expected = normalizeDownloadRelease(item.releaseTitle || '');
  const actual = normalizeDownloadRelease(
    record.sourceTitle
    ?? record.data?.sourceTitle
    ?? record.data?.releaseTitle
  );
  if (!expected || !actual) return false;
  return expected === actual || expected.includes(actual) || actual.includes(expected);
}

function matchStrength(item: LiveDownloadItem, record: HistoryRecord, checkedAt: number): HistoryMatchStrength {
  const itemIds = new Set(getPhysicalDownloadIds(item));
  const historyId = recordDownloadId(record);
  if (historyId && itemIds.has(historyId)) return 'physical';

  if (!canonicalTmdbMatches(item, record) || !episodeScopeMatches(item, record)) return 'none';

  const date = recordDate(record);
  const requestAt = Number(item.addedAt || 0);
  if (item.isOptimistic && (!requestAt || !date)) return 'none';

  const earliest = requestAt
    ? requestAt - (item.isOptimistic ? 5_000 : 5 * 60_000)
    : checkedAt - 24 * 60 * 60_000;
  if (date && date < earliest) return 'none';

  if (releaseMatches(item, record)) return 'canonical-release';

  // Une intention optimiste peut ne jamais avoir observé le vrai nom de release.
  // Le TMDB exact + scope + fenêtre temporelle n'est accepté qu'après contrôle
  // d'ambiguïté dans resolveDownloadHistoryOutcome.
  if (item.isOptimistic || !item.releaseTitle) return 'canonical';

  return 'none';
}

function matchRank(strength: HistoryMatchStrength): number {
  if (strength === 'physical') return 3;
  if (strength === 'canonical-release') return 2;
  if (strength === 'canonical') return 1;
  return 0;
}

function hasAmbiguousTransfers(candidates: Array<{ record: HistoryRecord }>): boolean {
  if (candidates.length <= 1) return false;

  const ids = candidates.map(candidate => recordDownloadId(candidate.record));
  const presentIds = ids.filter((id): id is string => Boolean(id));
  if (new Set(presentIds).size > 1) return true;

  // Sans ID physique sur tous les événements, plusieurs terminaux restent
  // ambigus même pour le même TMDB : on échoue fermé.
  return ids.some(id => !id);
}

function outcomeFromRecord(record: HistoryRecord, date: number): DownloadHistoryOutcome {
  const kind = eventKind(record);
  if (kind === 'completed') {
    return {
      state: 'completed',
      date,
      quality: normalizeQualityLabel(
        record.sourceTitle,
        record.quality?.quality?.name
      )
    };
  }
  if (kind === 'failed') {
    const message = typeof record.data?.message === 'string'
      ? record.data.message
      : typeof record.data?.reason === 'string'
        ? record.data.reason
        : 'Le gestionnaire de téléchargement signale un échec.';
    return { state: 'failed', date, message };
  }
  return { state: 'unknown' };
}

export function shouldResolveMissingDownloadFromHistory(
  item: LiveDownloadItem,
  now = Date.now(),
  optimisticDelayMs = 3_000
): boolean {
  const status = String(item.status || '').toLowerCase();
  if (status === 'completed' || status === 'cancelled' || status === 'error' || Number(item.progress || 0) >= 100) {
    return false;
  }
  if (!item.isOptimistic) return true;
  if (!item.tmdbId) return false;

  const addedAt = Number(item.addedAt || 0);
  if (!addedAt || addedAt > now + 5_000) return false;
  return now - addedAt >= optimisticDelayMs;
}

export function resolveDownloadHistoryOutcome(
  item: LiveDownloadItem,
  snapshot: DownloadHistorySnapshot
): DownloadHistoryOutcome {
  const source = item.mediaType === 'movie' ? snapshot.radarr : snapshot.sonarr;
  if (!source.configured || !source.ok) return { state: 'unknown' };

  const terminalMatches = source.records
    .map(asRecord)
    .map(record => ({
      record,
      date: recordDate(record),
      kind: eventKind(record),
      strength: matchStrength(item, record, snapshot.checkedAt)
    }))
    .filter(candidate => candidate.kind !== 'other' && candidate.strength !== 'none');

  if (!terminalMatches.length) return { state: 'unknown' };

  const bestRank = Math.max(...terminalMatches.map(candidate => matchRank(candidate.strength)));
  const strongest = terminalMatches
    .filter(candidate => matchRank(candidate.strength) === bestRank)
    .sort((a, b) => b.date - a.date);

  if (bestRank < matchRank('physical') && hasAmbiguousTransfers(strongest)) {
    return { state: 'unknown' };
  }

  const latest = strongest[0];
  return latest ? outcomeFromRecord(latest.record, latest.date) : { state: 'unknown' };
}
