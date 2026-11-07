import { compareHistoryEntries, buildHistoryRows, historyGroupCode, indexHistoryPeriods, historyPeriodSummary, type TimelineRow } from '../features/history/historyTimeline';
import { HomeLoadMore } from './cards/HomeLoadMore';
import { HISTORY_PAGE_SIZE } from '../features/watchlist/homePresentation';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useShows } from '../hooks/useShows';
import type { Show } from '../types';
import { tmdb } from '../features/shows/tmdb';
import { useToastStore } from '../store/toastStore';
import { openExternalUrl, scrollAllCarouselsToStart } from '../lib/utils';
import { usePassiveWatchProvider } from '../hooks/usePassiveWatchProvider';
import { HistoryEntryRow, type HistoryRowMenu } from './HistoryEntryRow';
import {
  createWatchProviderRequestLimiter,
  scheduleWatchProviderCardEnrichment,
} from '../features/providers/watchProviderRequestPolicy';
import { openPlexWatchUrl } from '../features/plex/plexLinks';
import { readWatchProviderCache } from '../features/providers/watchProviderCache';
import { getProviderLinkPresentation } from '../features/providers/providerLink';
import { historyEpisodeEntries, historyEpisodeKey, historyRecordsWithoutTarget, historyLastWatchedAt, materializeHistoryRecords } from '../features/history/historyRecords';
import {
  buildHistoryAriaLabel,
  formatHistoryRowDate,
  formatHistoryClock,
  historyLocalDayKey,
  parseHistoryLocalDateTime,
  resolveHistoryTimestamp,
} from '../features/history/historyPresentation';

const historyDetailRequestLimiter = createWatchProviderRequestLimiter(2);

interface HistoryItem {
  key: string;
  showId: string;
  tmdbId?: number;
  showTitle: string;
  mediaType: 'tv' | 'movie';
  season: number;
  episode: number;
  episodeTitle?: string;
  watchedAt: number;
  watchedTimeKnown: boolean;
  plexImported: boolean;
  runtime?: number;
}

interface EpisodeHistoryMetadata {
  kind: 'episode';
  title?: string;
  runtime?: number;
  stillPath?: string;
  airDate?: string;
}

interface MovieHistoryMetadata {
  kind: 'movie';
  year?: string;
  runtime?: number;
  genres: string[];
  backdropPath?: string;
}

type HistoryMetadata = EpisodeHistoryMetadata | MovieHistoryMetadata;
type WatchRecord = Record<string, unknown>;

type CachedEpisode = {
  episode_number?: number;
  air_date?: string | null;
  name?: string | null;
  still_path?: string | null;
};

type CachedSeason = {
  season_number?: number;
  episodes?: CachedEpisode[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asPositiveNumber(value: unknown): number | undefined {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

function getRecord(show: Show, key: string): WatchRecord | null {
  return asRecord(show.episodeRecords?.[key]);
}

function getRecordTitle(record: WatchRecord | null): string | undefined {
  return asString(record?.episodeTitle) || asString(record?.name) || asString(record?.title);
}

function isPlexRecord(record: WatchRecord | null): boolean {
  return record?.plexImported === true;
}

function resolveRecordTime(show: Show, record: WatchRecord | null) {
  const resolved = resolveHistoryTimestamp(record?.watchedAt, show.lastWatchedAt, show.updatedAt, show.createdAt);
  if (!resolved) return null;
  return {
    ...resolved,
    timeKnown: record?.watchedTimeKnown === false ? false : resolved.timeKnown,
  };
}

function isMovieShow(show: Show): boolean {
  return show.mediaType === 'movie' || show.seenEpisodes?.includes('movie') || Boolean(show.episodeRecords && 'movie' in show.episodeRecords);
}

function isMovieWatched(show: Show): boolean {
  const record = getRecord(show, 'movie');
  return isMovieShow(show) && (Array.isArray(show.seenEpisodes) ? show.seenEpisodes.includes('movie') : Boolean(record?.watchedAt));
}

function getMetadataKey(item: HistoryItem): string {
  return item.mediaType === 'movie'
    ? `movie:${item.tmdbId || item.showId}`
    : `tv:${item.tmdbId || item.showId}:${item.season}x${item.episode}`;
}

function localTodayKey(): string {
  return historyLocalDayKey(Date.now());
}

function HistoryRowItem({
  item,
  row,
  metadata,
  show,
  onShowClick,
  onEpisodeClick,
  onUnseen,
  onSaveDate,
  onRewatch,
}: {
  item: HistoryItem;
  row: TimelineRow<HistoryItem>;
  metadata?: HistoryMetadata;
  show: Show;
  onShowClick?: (id: string, mediaType?: 'tv' | 'movie') => void;
  onEpisodeClick?: (showId: string, season: number, episode: number) => void;
  onUnseen: (item: HistoryItem) => void | Promise<void>;
  onSaveDate: (item: HistoryItem, date: string, time: string) => void | Promise<void>;
  onRewatch: (item: HistoryItem, show: Show, providerName?: string | null) => void | Promise<void>;
}) {
  const forcePlex = item.plexImported;
  const { cardRef, providerName } = usePassiveWatchProvider({
    tmdbId: item.tmdbId,
    mediaType: item.mediaType,
    title: item.showTitle,
    hasKnownProvider: forcePlex,
    retainInLibraryCache: true,
  });
  const effectiveProviderName = forcePlex ? 'Plex' : providerName;

  const handleRowClick = () => {
    if (item.mediaType === 'movie') {
      onShowClick?.(item.showId, 'movie');
    } else if (onEpisodeClick) {
      onEpisodeClick(item.showId, item.season, item.episode);
    } else {
      onShowClick?.(item.showId, 'tv');
    }
  };

  const episodeMetadata = metadata?.kind === 'episode' ? metadata : undefined;
  const movieMetadata = metadata?.kind === 'movie' ? metadata : undefined;
  const episodeTitle = episodeMetadata?.title || item.episodeTitle;
  const ariaLabel = buildHistoryAriaLabel({
    title: item.showTitle,
    mediaType: item.mediaType,
    season: item.season,
    episode: item.episode,
    episodeTitle,
    watchedAt: item.watchedAt,
    timeKnown: item.watchedTimeKnown,
  });
  const clock = formatHistoryClock(item.watchedAt, item.watchedTimeKnown);
  const dateLabel = formatHistoryRowDate(item.watchedAt);
  // #9 Historique : menu ancré (maquette validée le 07/11) ; « Aujourd’hui à 07:41 » rappelle la date courante.
  const dayGap = Math.round((Date.parse(`${localTodayKey()}T12:00:00`) - Date.parse(`${historyLocalDayKey(item.watchedAt)}T12:00:00`)) / 86_400_000);
  const dayLabel = dayGap === 0 ? 'Aujourd’hui' : dayGap === 1 ? 'Hier' : dayGap === 2 ? 'Avant-hier' : dateLabel;
  const menu: HistoryRowMenu = {
    whenLabel: clock ? `${dayLabel} à ${clock}` : `${dayLabel} · heure inconnue`,
    watchedAt: item.watchedAt, timeKnown: item.watchedTimeKnown,
    onSaveDate: (date, time) => onSaveDate(item, date, time),
    onRewatch: () => onRewatch(item, show, effectiveProviderName),
    onOpenSeries: item.mediaType === 'tv' ? () => onShowClick?.(item.showId, 'tv') : undefined,
    onUnseen: () => onUnseen(item),
  };


  return <div ref={cardRef} className="history-entry-host">
    <HistoryEntryRow title={item.showTitle} episodeTitle={item.mediaType === 'tv' ? episodeTitle || `Épisode ${item.episode}` : movieMetadata?.genres[0]}
      code={historyGroupCode(row)}
      date={dateLabel} clock={clock || 'heure inconnue'} today={historyLocalDayKey(item.watchedAt) === localTodayKey()} timestamp={item.watchedAt}
      images={[show.posterPath, show.backdropPath]}
      label={ariaLabel} onOpen={handleRowClick} menu={menu} />
  </div>;
}

export const HistoryFeed = memo(function HistoryFeed({
  active = true,
  today = historyLocalDayKey(Date.now()),
  onExplore,
  onShowClick,
  onEpisodeClick
}: {
  onShowClick?: (id: string, mediaType?: 'tv' | 'movie') => void;
  onEpisodeClick?: (showId: string, season: number, episode: number) => void;
  onExplore?: () => void;
  active?: boolean;
  today?: string;
}) {
  const [page, setPage] = useState(1);
  const itemsPerPage = HISTORY_PAGE_SIZE;
  const { shows, loading, updateShow } = useShows();
  const showsById = useMemo(() => new Map((active ? shows : []).map(show => [show.id, show])), [shows, active]);
  const showToast = useToastStore(state => state.showToast);
  const [metadataByKey, setMetadataByKey] = useState<Record<string, HistoryMetadata>>({});

  const historyItems = useMemo(() => {
    if (!active) return [];
    if (!shows) return [];
    const items: HistoryItem[] = [];

    for (const show of shows) {
      if (!show.id) continue;

      if (isMovieShow(show)) {
        const record = getRecord(show, 'movie');
        if (!isMovieWatched(show)) continue;
        const timing = resolveRecordTime(show, record);
        if (!timing) continue;
        items.push({
          key: `${show.id}:movie`,
          showId: show.id,
          tmdbId: show.tmdbId,
          showTitle: show.title,
          mediaType: 'movie',
          season: 0,
          episode: 0,
          episodeTitle: 'Film',
          watchedAt: timing.watchedAt,
          watchedTimeKnown: timing.timeKnown,
          plexImported: isPlexRecord(record),
          runtime: asPositiveNumber(record?.runtime),
        });
        continue;
      }

      for (const { key: epKey, record } of historyEpisodeEntries(show)) {
        const match = /^(\d+)x(\d+)$/i.exec(epKey.trim());
        if (!match) continue;
        const season = Number(match[1]);
        const episode = Number(match[2]);
        if (!Number.isInteger(season) || !Number.isInteger(episode) || episode <= 0) continue;
        const timing = resolveRecordTime(show, record);
        if (!timing) continue;
        items.push({
          key: `${show.id}:${epKey}`,
          showId: show.id,
          tmdbId: show.tmdbId,
          showTitle: show.title,
          mediaType: 'tv',
          season,
          episode,
          episodeTitle: getRecordTitle(record),
          watchedAt: timing.watchedAt,
          watchedTimeKnown: timing.timeKnown,
          plexImported: isPlexRecord(record),
          runtime: asPositiveNumber(record?.runtime),
        });
      }

    }

    return items.sort(compareHistoryEntries);
  }, [shows, active]);

  const rows = useMemo(() => buildHistoryRows(historyItems), [historyItems]);
  const displayedRows = useMemo(() => rows.slice(0, page * itemsPerPage), [rows, page]);
  const displayedItems = useMemo(() => displayedRows.flatMap(row => row.members), [displayedRows]);
  const periods = useMemo(() => indexHistoryPeriods(rows), [rows, today]);
  const summaries = useMemo(() => {
    const movieDurations = new Map<number, number | null>();
    const minutes = (item: HistoryItem): number | null => {
      const duration = asPositiveNumber(metadataByKey[getMetadataKey(item)]?.runtime) || asPositiveNumber(item.runtime);
      if (duration) return duration;
      if (item.mediaType !== 'movie' || !item.tmdbId) return null;
      if (!movieDurations.has(item.tmdbId)) movieDurations.set(item.tmdbId, asPositiveNumber(tmdb.peekRenderableMediaDetails(item.tmdbId, 'movie')?.runtime) || null);
      return movieDurations.get(item.tmdbId) ?? null;
    };
    return new Map([...periods].map(([key, period]) => [key, historyPeriodSummary(period.rows, minutes)]));
  }, [periods, metadataByKey]);
  const visiblePeriods = useMemo(() => {
    let remaining = displayedRows.length;
    return [...periods.values()].flatMap(period => {
      if (remaining <= 0) return [];
      const visible = period.rows.slice(0, remaining);
      remaining -= visible.length;
      return [{ ...period, rows: visible }];
    });
  }, [periods, displayedRows]);

  useEffect(() => {
    let mounted = true;
    const missing = displayedItems.filter(item => Boolean(item.tmdbId) && !metadataByKey[getMetadataKey(item)]);
    if (missing.length === 0) return () => { mounted = false; };

    const cancel = scheduleWatchProviderCardEnrichment(() => {
      void Promise.all(missing.map(item => historyDetailRequestLimiter.run(async () => {
        const key = getMetadataKey(item);
        if (item.mediaType === 'tv') {
          const result = await tmdb.getEpisodeHistoryMetadata(item.tmdbId!, item.season, item.episode);
          const value = result.ok ? asRecord(result.value) : null;
          return [key, {
            kind: 'episode',
            title: asString(value?.name),
            runtime: asPositiveNumber(value?.runtime),
            stillPath: asString(value?.still_path),
            airDate: asString(value?.air_date),
          } satisfies EpisodeHistoryMetadata] as const;
        }

        const result = await tmdb.getMovieDetails(item.tmdbId!);
        const value = result.ok ? asRecord(result.value) : null;
        const genres = Array.isArray(value?.genres)
          ? value.genres.flatMap(rawGenre => {
            const name = asString(asRecord(rawGenre)?.name);
            return name ? [name] : [];
          }).slice(0, 2)
          : [];
        return [key, {
          kind: 'movie',
          year: asString(value?.release_date)?.slice(0, 4),
          runtime: asPositiveNumber(value?.runtime),
          genres,
          backdropPath: asString(value?.backdrop_path),
        } satisfies MovieHistoryMetadata] as const;
      }))).then(results => {
        if (!mounted) return;
        setMetadataByKey(previous => ({ ...previous, ...Object.fromEntries(results) }));
      });
    });

    return () => { mounted = false; cancel(); };
  }, [displayedItems, metadataByKey]);

  const handleRewatch = useCallback(async (item: HistoryItem, show: Show, providerName?: string | null) => {
    if (item.plexImported || providerName?.toLocaleLowerCase('fr-FR').includes('plex')) {
      await openPlexWatchUrl(show);
      return;
    }
    if (!item.tmdbId) {
      showToast('Diffuseur indisponible pour ce visionnage.', 'info');
      return;
    }
    const payload = asRecord(tmdb.peekWatchProviders(item.tmdbId, item.mediaType)
      ?? readWatchProviderCache(item.tmdbId, item.mediaType, { allowStale: true })?.data);
    const results = asRecord(payload?.results);
    const france = asRecord(results?.FR);
    const candidates = [france?.flatrate, france?.free, france?.ads].flatMap(value => Array.isArray(value) ? value : []);
    const provider = candidates.map(asRecord).find(value => value?.provider_name === providerName);
    const destination = provider ? getProviderLinkPresentation({
      providerId: Number(provider.provider_id), providerName: providerName || '',
      title: show.title, fallbackLink: asString(france?.link) || '',
    }).url : asString(france?.link);
    const link = destination && destination !== '#' ? destination : null;
    if (!link || !await openExternalUrl(link, { title: show.title, mediaType: show.mediaType, tmdbId: show.tmdbId })) {
      showToast('Impossible d’ouvrir le diffuseur pour le moment.', 'info');
    }
  }, [showToast]);

  const handleSaveWatchDate = useCallback(async (editingItem: HistoryItem, editDate: string, editTime: string) => {
    const parsed = parseHistoryLocalDateTime(editDate, editTime);
    if (!parsed) {
      showToast('Date ou heure invalide.', 'error');
      return;
    }
    const targetShow = shows.find(show => show.id === editingItem.showId);
    if (!targetShow) return;
    const epKey = editingItem.mediaType === 'movie' ? 'movie' : `${editingItem.season}x${editingItem.episode}`;
    const previousRecords = { ...(targetShow.episodeRecords || {}) };
    const previousLastWatchedAt = targetShow.lastWatchedAt || null;
    const previousRecord = editingItem.mediaType === 'movie' ? asRecord(previousRecords.movie) || {}
      : historyEpisodeEntries(targetShow).find(entry => entry.key === epKey)?.record || {};
    const nextRecords = {
      ...historyRecordsWithoutTarget(materializeHistoryRecords(targetShow), epKey),
      [epKey]: {
        ...previousRecord,
        watchedAt: parsed.watchedAt,
        watchedTimeKnown: parsed.timeKnown,
      },
    };
    const nextLastWatchedAt = historyLastWatchedAt(nextRecords, targetShow.seenEpisodes || [epKey]);
    await updateShow(targetShow.id, {
      episodeRecords: nextRecords,
      lastWatchedAt: nextLastWatchedAt,
      updatedAt: Date.now(),
      isSynced: false,
    });
    scrollAllCarouselsToStart();
    showToast(
      parsed.timeKnown ? 'Date et heure de visionnage mises à jour' : 'Date de visionnage mise à jour',
      'success',
      targetShow,
      async () => {
        await updateShow(targetShow.id, {
          episodeRecords: previousRecords,
          lastWatchedAt: previousLastWatchedAt,
          updatedAt: Date.now(),
          isSynced: false,
        });
        scrollAllCarouselsToStart();
      }
    );
  }, [showToast, shows, updateShow]);

  const handleConfirmUnseen = useCallback(async (item: HistoryItem) => {
    const targetShow = shows.find(show => show.id === item.showId);
    if (!targetShow) return;

    const isMovie = item.mediaType === 'movie' || targetShow.mediaType === 'movie';
    const epKey = isMovie ? 'movie' : `${item.season}x${item.episode}`;
    const newSeenEpisodes = (targetShow.seenEpisodes || []).filter(key => (historyEpisodeKey(key) || key) !== epKey);
    const newRecords = historyRecordsWithoutTarget(materializeHistoryRecords(targetShow), epKey);
    const newLastWatchedAt = historyLastWatchedAt(newRecords, newSeenEpisodes);

    const prevSeenEpisodes = targetShow.seenEpisodes || [];
    const prevEpisodeRecords = targetShow.episodeRecords || {};
    const prevStatus = targetShow.status;
    const prevLastWatchedAt = targetShow.lastWatchedAt || null;
    const prevNextEpisodeToWatch = targetShow.nextEpisodeToWatch || null;
    const prevIsArchived = targetShow.isArchived || false;

    let newNextEp = targetShow.nextEpisodeToWatch;
    let newStatus = targetShow.status;
    let newIsArchived = targetShow.isArchived;

    if (isMovie) {
      if (targetShow.status === 'completed') newStatus = 'plan_to_watch';
    } else {
      const cachedSeason = (targetShow.seasonsCache as CachedSeason[] | undefined)?.find(season => season.season_number === item.season);
      // Un dé-vu est un delta utilisateur local, jamais dépendant d'une réponse TMDB.
      const epDetails = cachedSeason?.episodes?.find(episode => episode.episode_number === item.episode);
      newNextEp = {
        ...(targetShow.nextEpisodeToWatch?.season_number === item.season ? targetShow.nextEpisodeToWatch : {}),
        ...targetShow.seasonProgress?.[String(item.season)],
        season_number: item.season,
        episode_number: item.episode,
        air_date: epDetails?.air_date || null,
        name: epDetails?.name || item.episodeTitle || null,
        still_path: epDetails?.still_path || null,
      };
      if (newStatus === 'completed') newStatus = 'watching';
      newIsArchived = false;
    }

    try {
      await updateShow(targetShow.id, {
        seenEpisodes: newSeenEpisodes,
        episodeRecords: newRecords,
        status: newStatus,
        isArchived: newIsArchived,
        lastWatchedAt: newLastWatchedAt,
        nextEpisodeToWatch: newNextEp,
        updatedAt: Date.now(),
        isSynced: false,
      });
    } catch {
      showToast('Le passage en non vu n’a pas pu être enregistré. Réessaie.', 'error');
      return;
    }
    scrollAllCarouselsToStart();

    // Toast d'épisode (104 px) : « Retiré de l’historique » et Annuler pendant 5 s, date exacte restaurée.
    showToast(
      { title: item.showTitle, subtitle: isMovie ? undefined : `S${item.season} | E${item.episode}`, action: 'Retiré de l’historique', posterPath: targetShow.posterPath || undefined },
      'info',
      targetShow,
      async () => {
        await updateShow(targetShow.id, {
          seenEpisodes: prevSeenEpisodes,
          episodeRecords: prevEpisodeRecords,
          status: prevStatus,
          lastWatchedAt: prevLastWatchedAt,
          nextEpisodeToWatch: prevNextEpisodeToWatch,
          isArchived: prevIsArchived,
          updatedAt: Date.now(),
          isSynced: false,
        });
        scrollAllCarouselsToStart();
      }
    );
  }, [showToast, shows, updateShow]);

  if (!active) return null;
  if (loading) {
    return <div className="history-entry-list" role="status" aria-label="Chargement de l’historique">{[0, 1, 2, 3, 4].map(index => <div key={index} className="history-entry history-entry--skeleton"><div className="history-entry__image" /><div className="history-entry__text"><span /><span /></div></div>)}</div>;
  }

  const hasMore = displayedRows.length < rows.length;

  return (
    <div className="history-timeline">
      {historyItems.length === 0 && (
        <div className="home-empty"><h2>Rien de vu pour l’instant</h2>{onExplore && <button type="button" className="home-explore" onClick={onExplore}>Explorer</button>}</div>
      )}

      {visiblePeriods.map(period => {
        const summary = summaries.get(period.key)!;
        return <section key={period.key} className={`history-period${period.today ? ' history-period--today' : ''}`}>
          <h2 className="history-period__heading"><span className="home-section-name">{period.label}</span></h2>
          <p className="history-period__summary">{[summary.episodes ? `${summary.episodes} épisode${summary.episodes > 1 ? 's' : ''}` : '', summary.films ? `${summary.films} film${summary.films > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ')}{summary.duration && <> · <strong>{summary.duration}</strong></>}</p>
          <div className="history-entry-list">{period.rows.map(row => {
            const item = row.item, show = showsById.get(item.showId);
            return show ? <HistoryRowItem key={row.key} item={item} row={row} metadata={metadataByKey[getMetadataKey(item)]} show={show}
              onShowClick={onShowClick} onEpisodeClick={onEpisodeClick} onUnseen={handleConfirmUnseen}
              onSaveDate={handleSaveWatchDate} onRewatch={handleRewatch} /> : null;
          })}</div>
        </section>;
      })}
      {hasMore && <HomeLoadMore step={HISTORY_PAGE_SIZE} lastLabel="Afficher la dernière" remainingCount={rows.length - displayedRows.length} items={rows.slice(displayedRows.length, displayedRows.length + 3).flatMap(row => { const show = showsById.get(row.item.showId); return show ? [show] : []; })} onLoad={() => setPage(value => value + 1)} />}


    </div>
  );
});
