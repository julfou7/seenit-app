import { groupHistoryRows, historyGroupCode, historyPeriod, historyPeriodSummary, type TimelineRow } from '../features/history/historyTimeline';
import { HomeLoadMore } from './cards/HomeLoadMore';
import { DialogLayer } from './ui/DialogLayer';
import { HISTORY_PAGE_SIZE } from '../features/watchlist/homePresentation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useShows } from '../hooks/useShows';
import type { Show } from '../types';
import { AlertCircle } from 'lucide-react';
import { tmdb } from '../features/shows/tmdb';
import { useToastStore } from '../store/toastStore';
import { openExternalUrl, scrollAllCarouselsToStart } from '../lib/utils';
import { usePassiveWatchProvider } from '../hooks/usePassiveWatchProvider';
import type { SeriesCardAction } from './cards/SeriesEpisodeCard';
import { HistoryEntryRow } from './HistoryEntryRow';
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
  historyDateInputValue,
  historyLocalDayKey,
  historyTimeInputValue,
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
  setUnseenModalItem,
  onEdit,
  onRewatch,
}: {
  item: HistoryItem;
  row: TimelineRow<HistoryItem>;
  metadata?: HistoryMetadata;
  show: Show;
  onShowClick?: (id: string, mediaType?: 'tv' | 'movie') => void;
  onEpisodeClick?: (showId: string, season: number, episode: number) => void;
  setUnseenModalItem: (item: HistoryItem) => void;
  onEdit: (item: HistoryItem) => void;
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
    if (row.members.length > 1) { onShowClick?.(item.showId, 'tv'); }
    else if (item.mediaType === 'movie') {
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
  const actionsFor = (target: HistoryItem): SeriesCardAction[] => [
    { label: 'Marquer non vu', onSelect: () => setUnseenModalItem(target) },
    { label: 'Changer la date/heure', onSelect: () => onEdit(target) },
    { label: 'Revoir', onSelect: () => onRewatch(target, show, effectiveProviderName) },
    ...(target.mediaType === 'tv' ? [{ label: 'Ouvrir la série', onSelect: () => onShowClick?.(target.showId, 'tv') }] : []),
  ];
  const grouped = row.members.length > 1;
  const historyActions = grouped ? [{ label: 'Ouvrir la série', onSelect: () => onShowClick?.(item.showId, 'tv') }] : actionsFor(item);
  const actionGroups = grouped ? [...row.members].reverse().map(target => ({ label: `S${target.season} · E${target.episode}`, actions: actionsFor(target) })) : undefined;


  return <div ref={cardRef} className="history-entry-host">
    <HistoryEntryRow title={item.showTitle} episodeTitle={grouped ? `${row.members.length} épisodes d’affilée` : item.mediaType === 'tv' ? episodeTitle || `Épisode ${item.episode}` : movieMetadata?.genres[0]}
      code={historyGroupCode(row)} groupCount={row.members.length} actionGroups={actionGroups}
      date={formatHistoryRowDate(item.watchedAt)} today={historyLocalDayKey(item.watchedAt) === localTodayKey()} timestamp={item.watchedAt}
      images={[show.posterPath, show.backdropPath]}
      label={grouped ? `${show.title}, ${row.members.length} épisodes d’affilée, ${historyGroupCode(row)}` : ariaLabel} onOpen={handleRowClick} actions={historyActions} />
  </div>;
}

export function HistoryFeed({
  active = true,
  onExplore,
  onShowClick,
  onEpisodeClick
}: {
  onShowClick?: (id: string, mediaType?: 'tv' | 'movie') => void;
  onEpisodeClick?: (showId: string, season: number, episode: number) => void;
  onExplore?: () => void;
  active?: boolean;
}) {
  const [page, setPage] = useState(1);
  const itemsPerPage = HISTORY_PAGE_SIZE;
  const { shows, loading, updateShow } = useShows();
  const showsById = useMemo(() => new Map((active ? shows : []).map(show => [show.id, show])), [shows, active]);
  const { showToast } = useToastStore();
  const [metadataByKey, setMetadataByKey] = useState<Record<string, HistoryMetadata>>({});
  const [unseenModalItem, setUnseenModalItem] = useState<HistoryItem | null>(null);
  const [editingItem, setEditingItem] = useState<HistoryItem | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');

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
        });
      }

    }

    return items.sort((left, right) => {
      const leftDay = historyLocalDayKey(left.watchedAt);
      const rightDay = historyLocalDayKey(right.watchedAt);
      if (leftDay !== rightDay) return rightDay.localeCompare(leftDay);
      if (left.watchedTimeKnown !== right.watchedTimeKnown) return left.watchedTimeKnown ? -1 : 1;
      if (left.watchedTimeKnown && right.watchedTimeKnown && left.watchedAt !== right.watchedAt) return right.watchedAt - left.watchedAt;
      return left.key.localeCompare(right.key);
    });
  }, [shows, active]);

  const rows = useMemo(() => groupHistoryRows(historyItems, (id, season) => showsById.get(id)?.seasonProgress?.[String(season)]?.episode_count || showsById.get(id)?.seasonsCache?.find(item => item.season_number === season)?.episode_count || null), [historyItems, showsById]);
  const displayedRows = useMemo(() => rows.slice(0, page * itemsPerPage), [rows, page]);
  const displayedItems = useMemo(() => displayedRows.map(row => row.item), [displayedRows]);

  useEffect(() => {
    let mounted = true;
    const missing = displayedItems.filter(item => Boolean(item.tmdbId) && !metadataByKey[getMetadataKey(item)]);
    if (missing.length === 0) return () => { mounted = false; };

    const cancel = scheduleWatchProviderCardEnrichment(() => {
      void Promise.all(missing.map(item => historyDetailRequestLimiter.run(async () => {
        const key = getMetadataKey(item);
        if (item.mediaType === 'tv') {
          const result = await tmdb.getEpisodeDetails(item.tmdbId!, item.season, item.episode);
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

  const handleEdit = useCallback((item: HistoryItem) => {
    setEditingItem(item);
    setEditDate(historyDateInputValue(item.watchedAt));
    setEditTime(historyTimeInputValue(item.watchedAt, item.watchedTimeKnown));
  }, []);

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

  const handleSaveWatchDate = useCallback(async () => {
    if (!editingItem) return;
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
    setEditingItem(null);
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
  }, [editDate, editTime, editingItem, showToast, shows, updateShow]);

  const handleConfirmUnseen = useCallback(async (item: HistoryItem) => {
    setUnseenModalItem(null);
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
      let epDetails: CachedEpisode | undefined;
      const cachedSeason = (targetShow.seasonsCache as CachedSeason[] | undefined)?.find(season => season.season_number === item.season);
      epDetails = cachedSeason?.episodes?.find(episode => episode.episode_number === item.episode);
      if (!epDetails && targetShow.tmdbId) {
        const result = await tmdb.getEpisodeDetails(targetShow.tmdbId, item.season, item.episode);
        if (result.ok) {
          const value = asRecord(result.value);
          epDetails = {
            episode_number: item.episode,
            air_date: asString(value?.air_date) || null,
            name: asString(value?.name) || null,
            still_path: asString(value?.still_path) || null,
          };
        }
      }
      newNextEp = {
        season_number: item.season,
        episode_number: item.episode,
        air_date: epDetails?.air_date || null,
        name: epDetails?.name || item.episodeTitle || null,
        still_path: epDetails?.still_path || null,
      };
      if (newStatus === 'completed') newStatus = 'watching';
      newIsArchived = false;
    }

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
    scrollAllCarouselsToStart();

    const epLabel = isMovie
      ? `« ${item.showTitle} »`
      : `« ${item.showTitle} » S${String(item.season).padStart(2, '0')}E${String(item.episode).padStart(2, '0')}`;
    showToast(
      `${epLabel} retiré de l'historique`,
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
  const periods = new Map<string, { label: string; today: boolean; rows: TimelineRow<HistoryItem>[] }>();
  for (const row of displayedRows) {
    const period = historyPeriod(row.item.watchedAt);
    if (!periods.has(period.key)) periods.set(period.key, { ...period, rows: [] });
    periods.get(period.key)!.rows.push(row);
  }
  const minutes = (item: HistoryItem): number | null => {
    const metadata = metadataByKey[getMetadataKey(item)];
    const cached = item.tmdbId ? tmdb.peekRenderableMediaDetails(item.tmdbId, item.mediaType) : null;
    const value = metadata?.runtime || (item.mediaType === 'movie' ? cached?.runtime : cached?.episode_run_time?.[0]);
    return asPositiveNumber(value) || null;
  };

  return (
    <div className="history-timeline">
      {historyItems.length === 0 && (
        <div className="home-empty"><h2>Rien de vu pour l’instant</h2>{onExplore && <button type="button" className="home-explore" onClick={onExplore}>Explorer</button>}</div>
      )}

      {[...periods].map(([key, period]) => {
        const allPeriodRows = rows.filter(row => historyPeriod(row.item.watchedAt).key === key);
        const summary = historyPeriodSummary(allPeriodRows, minutes);
        return <section key={key} className={`history-period${period.today ? ' history-period--today' : ''}`}>
          <h2 className="history-period__heading"><span className="home-section-name">{period.label}</span></h2>
          <p className="history-period__summary">{[summary.episodes ? `${summary.episodes} épisode${summary.episodes > 1 ? 's' : ''}` : '', summary.films ? `${summary.films} film${summary.films > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ')}{summary.duration && <> · <strong>{summary.duration}</strong></>}</p>
          <div className="history-entry-list">{period.rows.map(row => {
            const item = row.item, show = showsById.get(item.showId);
            return show ? <HistoryRowItem key={row.key} item={item} row={row} metadata={metadataByKey[getMetadataKey(item)]} show={show}
              onShowClick={onShowClick} onEpisodeClick={onEpisodeClick} setUnseenModalItem={setUnseenModalItem}
              onEdit={handleEdit} onRewatch={handleRewatch} /> : null;
          })}</div>
        </section>;
      })}
      {hasMore && <HomeLoadMore step={HISTORY_PAGE_SIZE} lastLabel="Afficher la dernière" items={rows.slice(displayedRows.length).flatMap(row => { const show = showsById.get(row.item.showId); return show ? [show] : []; })} onLoad={() => setPage(value => value + 1)} />}


      {editingItem && (
        <DialogLayer onDismiss={() => setEditingItem(null)} label="Changer la date et l’heure" historyMode="local" role="dialog" className="fixed inset-0 z-[110] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-white/10 rounded-2xl p-5 max-w-sm w-full space-y-4 shadow-2xl">
            <div>
              <h3 className="text-base font-bold text-white">Changer la date/heure</h3>
              <p className="text-xs text-zinc-400 mt-1">Laissez l’heure vide si elle n’est pas connue : SeenIt ne l’inventera pas.</p>
            </div>
            <label className="block text-xs font-bold text-zinc-300">
              Date
              <input type="date" value={editDate} onChange={event => setEditDate(event.target.value)} className="mt-1.5 w-full min-h-11 rounded-xl bg-zinc-950 border border-white/10 px-3 text-sm text-white" />
            </label>
            <label className="block text-xs font-bold text-zinc-300">
              Heure (facultative)
              <input type="time" value={editTime} onChange={event => setEditTime(event.target.value)} className="mt-1.5 w-full min-h-11 rounded-xl bg-zinc-950 border border-white/10 px-3 text-sm text-white" />
            </label>
            <div className="flex items-center justify-end gap-2.5 pt-1">
              <button type="button" data-dialog-initial-focus onClick={() => setEditingItem(null)} className="min-h-11 px-4 rounded-xl bg-zinc-800 text-zinc-300 text-xs font-bold">Annuler</button>
              <button type="button" onClick={() => { void handleSaveWatchDate(); }} className="min-h-11 px-4 rounded-xl bg-[#E5A93D] text-zinc-950 text-xs font-extrabold">Enregistrer</button>
            </div>
          </div>
        </DialogLayer>
      )}

      {unseenModalItem && (
        <DialogLayer onDismiss={() => setUnseenModalItem(null)} label="Marquer comme non vu" historyMode="local" role="alertdialog" className="fixed inset-0 z-[110] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-zinc-900 border border-white/10 rounded-2xl p-5 max-w-sm w-full space-y-4 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 text-amber-400">
              <div className="w-10 h-10 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0"><AlertCircle size={20} /></div>
              <h3 className="text-base font-bold text-white">Marquer comme non vu ?</h3>
            </div>
            <p className="text-zinc-300 text-xs sm:text-sm leading-relaxed">
              Voulez-vous vraiment retirer <strong className="text-white">{unseenModalItem.showTitle}</strong> {unseenModalItem.mediaType === 'movie' ? 'de vos films vus' : `(S${String(unseenModalItem.season).padStart(2, '0')}E${String(unseenModalItem.episode).padStart(2, '0')})`} de votre historique ?
            </p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button type="button" onClick={() => setUnseenModalItem(null)} data-dialog-initial-focus className="min-h-11 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold transition-colors cursor-pointer">Annuler</button>
              <button type="button" onClick={() => { void handleConfirmUnseen(unseenModalItem); }} className="min-h-11 px-4 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition-colors shadow-lg shadow-red-600/30 cursor-pointer">Oui, marquer non vu</button>
            </div>
          </div>
        </DialogLayer>
      )}
    </div>
  );
}
