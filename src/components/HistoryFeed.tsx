import { DialogLayer } from './ui/DialogLayer';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useShows } from '../hooks/useShows';
import type { Show } from '../types';
import { AlertCircle } from 'lucide-react';
import { tmdb } from '../features/shows/tmdb';
import { getFormattedProviderLogo } from '../utils/providerLogos';
import { useToastStore } from '../store/toastStore';
import { openExternalUrl, scrollAllCarouselsToStart } from '../lib/utils';
import { usePassiveWatchProvider } from '../hooks/usePassiveWatchProvider';
import { SeriesEpisodeCard, type SeriesCardAction } from './cards/SeriesEpisodeCard';
import {
  createWatchProviderRequestLimiter,
  scheduleWatchProviderCardEnrichment,
} from '../features/providers/watchProviderRequestPolicy';
import { openPlexWatchUrl } from '../features/plex/plexLinks';
import {
  buildHistoryAriaLabel,
  buildMovieCollectionProgress,
  formatHistoryDayLabel,
  formatHistoryRuntime,
  historyDateInputValue,
  historyLocalDayKey,
  historyTimeInputValue,
  parseHistoryLocalDateTime,
  resolveHistoryTimestamp,
  type HistoryCollectionPart,
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
  collectionParts: HistoryCollectionPart[];
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
  return isMovieShow(show) && (Boolean(show.seenEpisodes?.includes('movie')) || Boolean(record?.watchedAt));
}

function getMetadataKey(item: HistoryItem): string {
  return item.mediaType === 'movie'
    ? `movie:${item.tmdbId || item.showId}`
    : `tv:${item.tmdbId || item.showId}:${item.season}x${item.episode}`;
}

function recalculateLastWatchedAt(records: Record<string, unknown>): number | null {
  const times = Object.values(records).flatMap(record => {
    const watchedAt = asPositiveNumber(asRecord(record)?.watchedAt);
    return watchedAt ? [watchedAt < 10_000_000_000 ? watchedAt * 1000 : watchedAt] : [];
  });
  return times.length > 0 ? Math.max(...times) : null;
}

function localTodayKey(): string {
  return historyLocalDayKey(Date.now());
}

function HistoryRowItem({
  item,
  metadata,
  show,
  watchedMovieIds,
  onShowClick,
  onEpisodeClick,
  setUnseenModalItem,
  onEdit,
  onRewatch,
}: {
  item: HistoryItem;
  metadata?: HistoryMetadata;
  show: Show;
  watchedMovieIds: ReadonlySet<number>;
  onShowClick?: (id: string, mediaType?: 'tv' | 'movie') => void;
  onEpisodeClick?: (showId: string, season: number, episode: number) => void;
  setUnseenModalItem: (item: HistoryItem) => void;
  onEdit: (item: HistoryItem) => void;
  onRewatch: (item: HistoryItem, show: Show, providerName?: string | null) => void | Promise<void>;
}) {
  const forcePlex = item.plexImported;
  const { cardRef, providerLogo, providerName } = usePassiveWatchProvider({
    tmdbId: item.tmdbId,
    mediaType: item.mediaType,
    title: item.showTitle,
    hasKnownProvider: forcePlex,
    retainInLibraryCache: true,
  });
  const effectiveProviderName = forcePlex ? 'Plex' : providerName;
  const networkLogo = forcePlex
    ? getFormattedProviderLogo(null, 'Plex')
    : getFormattedProviderLogo(providerLogo, providerName);

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
  const runtime = formatHistoryRuntime(episodeMetadata?.runtime ?? movieMetadata?.runtime);
  const movieProgress = item.mediaType === 'movie'
    ? buildMovieCollectionProgress(movieMetadata?.collectionParts, item.tmdbId || 0, watchedMovieIds, localTodayKey())
    : undefined;
  const movieCode = item.mediaType === 'movie'
    ? `Film${movieMetadata?.year ? ` · ${movieMetadata.year}` : ''}`
    : undefined;
  const subtitle = item.mediaType === 'movie'
    ? (movieMetadata?.genres.slice(0, 2).join(', ') || null)
    : (episodeTitle || `Épisode ${item.episode}`);
  const ariaLabel = buildHistoryAriaLabel({
    title: item.showTitle,
    mediaType: item.mediaType,
    season: item.season,
    episode: item.episode,
    episodeTitle,
    watchedAt: item.watchedAt,
    timeKnown: item.watchedTimeKnown,
  });
  const historyActions: SeriesCardAction[] = [
    { label: 'Marquer non vu', onSelect: () => setUnseenModalItem(item) },
    { label: 'Changer la date/heure', onSelect: () => onEdit(item) },
    { label: 'Revoir', onSelect: () => onRewatch(item, show, effectiveProviderName) },
    ...(item.mediaType === 'tv' ? [{ label: 'Ouvrir la série', onSelect: () => onShowClick?.(item.showId, 'tv') }] : []),
  ];

  return (
    <div ref={cardRef} className="series-8f-host history-16d__card">
      <SeriesEpisodeCard
        show={show}
        episode={item.mediaType === 'movie' ? null : {
          season_number: item.season,
          episode_number: item.episode,
          name: episodeTitle,
          air_date: episodeMetadata?.airDate,
        }}
        context={{ kind: 'history', watchedAt: item.watchedAt, watchedTimeKnown: item.watchedTimeKnown, onUnseen: () => setUnseenModalItem(item) }}
        detail={runtime || undefined}
        presentation={{
          code: movieCode,
          subtitle,
          backdropPath: item.mediaType === 'movie' ? movieMetadata?.backdropPath : episodeMetadata?.stillPath,
          progress: movieProgress,
          ariaLabel,
        }}
        providerLogo={networkLogo}
        providerName={effectiveProviderName}
        historyActions={historyActions}
        onProviderOpen={() => onRewatch(item, show, effectiveProviderName)}
        onOpen={handleRowClick}
        onOpenEpisode={item.mediaType === 'tv' ? handleRowClick : undefined}
        onOpenSeries={item.mediaType === 'tv' ? () => onShowClick?.(item.showId, 'tv') : undefined}
      />
    </div>
  );
}

export function HistoryFeed({
  onShowClick,
  onEpisodeClick
}: {
  onShowClick?: (id: string, mediaType?: 'tv' | 'movie') => void;
  onEpisodeClick?: (showId: string, season: number, episode: number) => void;
}) {
  const [page, setPage] = useState(1);
  const itemsPerPage = 20;
  const { shows, loading, updateShow } = useShows();
  const showsById = useMemo(() => new Map(shows.map(show => [show.id, show])), [shows]);
  const { showToast } = useToastStore();
  const [metadataByKey, setMetadataByKey] = useState<Record<string, HistoryMetadata>>({});
  const [unseenModalItem, setUnseenModalItem] = useState<HistoryItem | null>(null);
  const [editingItem, setEditingItem] = useState<HistoryItem | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');

  const historyItems = useMemo(() => {
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

      const processedEpKeys = new Set<string>();
      for (const [epKey, rawRecord] of Object.entries(show.episodeRecords || {})) {
        const record = asRecord(rawRecord);
        if (!record?.watchedAt) continue;
        const match = /^(\d+)x(\d+)$/i.exec(epKey.trim());
        if (!match) continue;
        const season = Number(match[1]);
        const episode = Number(match[2]);
        if (!Number.isInteger(season) || !Number.isInteger(episode) || episode <= 0) continue;
        const timing = resolveRecordTime(show, record);
        if (!timing) continue;
        processedEpKeys.add(epKey);
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

      for (const epKey of show.seenEpisodes || []) {
        if (epKey === 'movie' || processedEpKeys.has(epKey)) continue;
        const match = /^(?:s\s*)?(\d+)\s*(?:x|e)\s*(\d+)$/i.exec(epKey.trim());
        if (!match) continue;
        const season = Number(match[1]);
        const episode = Number(match[2]);
        if (!Number.isInteger(season) || !Number.isInteger(episode) || episode <= 0) continue;
        const timing = resolveHistoryTimestamp(undefined, show.lastWatchedAt, show.updatedAt, show.createdAt);
        if (!timing) continue;
        items.push({
          key: `${show.id}:${season}x${episode}:legacy`,
          showId: show.id,
          tmdbId: show.tmdbId,
          showTitle: show.title,
          mediaType: 'tv',
          season,
          episode,
          watchedAt: timing.watchedAt,
          watchedTimeKnown: false,
          plexImported: false,
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
  }, [shows]);

  const watchedMovieIds = useMemo(() => new Set(
    shows.filter(isMovieWatched).map(show => Number(show.tmdbId)).filter(id => Number.isInteger(id) && id > 0)
  ), [shows]);

  const displayedItems = useMemo(() => historyItems.slice(0, page * itemsPerPage), [historyItems, page]);

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
        const collection = asRecord(value?.belongs_to_collection);
        const collectionId = asPositiveNumber(collection?.id);
        let collectionParts: HistoryCollectionPart[] = [];
        if (collectionId) {
          const collectionResult = await tmdb.getCollectionDetails(collectionId);
          const collectionValue = collectionResult.ok ? asRecord(collectionResult.value) : null;
          if (Array.isArray(collectionValue?.parts)) {
            collectionParts = collectionValue.parts.flatMap(rawPart => {
              const part = asRecord(rawPart);
              const id = asPositiveNumber(part?.id);
              return id ? [{ id, releaseDate: asString(part?.release_date) || null }] : [];
            });
          }
        }
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
          collectionParts,
        } satisfies MovieHistoryMetadata] as const;
      }))).then(results => {
        if (!mounted) return;
        setMetadataByKey(previous => ({ ...previous, ...Object.fromEntries(results) }));
      });
    });

    return () => { mounted = false; cancel(); };
  }, [displayedItems, metadataByKey]);

  const displayedGroups = useMemo(() => {
    const groups: Array<{ key: string; label: string; items: HistoryItem[] }> = [];
    for (const item of displayedItems) {
      const key = historyLocalDayKey(item.watchedAt);
      const last = groups[groups.length - 1];
      if (!last || last.key !== key) {
        groups.push({ key, label: formatHistoryDayLabel(item.watchedAt), items: [item] });
      } else {
        last.items.push(item);
      }
    }
    return groups;
  }, [displayedItems]);

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
    const result = await tmdb.getWatchProviders(item.tmdbId, item.mediaType);
    const payload = result.ok ? asRecord(result.value) : null;
    const results = asRecord(payload?.results);
    const france = asRecord(results?.FR);
    const link = asString(france?.link);
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
    const previousRecord = asRecord(previousRecords[epKey]) || {};
    const nextRecords = {
      ...previousRecords,
      [epKey]: {
        ...previousRecord,
        watchedAt: parsed.watchedAt,
        watchedTimeKnown: parsed.timeKnown,
      },
    };
    const nextLastWatchedAt = recalculateLastWatchedAt(nextRecords);
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
    const newSeenEpisodes = (targetShow.seenEpisodes || []).filter(key => key !== epKey && (isMovie ? key !== 'movie' : true));
    const newRecords = { ...(targetShow.episodeRecords || {}) };
    delete newRecords[epKey];
    if (isMovie) delete newRecords.movie;
    const newLastWatchedAt = recalculateLastWatchedAt(newRecords);

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

  if (loading) {
    return <div className="py-20 flex justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" /></div>;
  }

  const hasMore = displayedItems.length < historyItems.length;

  return (
    <div className="pb-8">
      {historyItems.length === 0 && (
        <div className="py-20 text-center text-zinc-500 text-sm">Aucun historique de visionnage.</div>
      )}

      {displayedGroups.map(group => (
        <section key={group.key} aria-labelledby={`history-day-${group.key}`}>
          <h3 id={`history-day-${group.key}`} className="history-16d__group-title">{group.label}</h3>
          <div className="history-16d__group-cards">
            {group.items.map(item => {
              const show = showsById.get(item.showId);
              if (!show) return null;
              return (
                <HistoryRowItem
                  key={item.key}
                  item={item}
                  metadata={metadataByKey[getMetadataKey(item)]}
                  show={show}
                  watchedMovieIds={watchedMovieIds}
                  onShowClick={onShowClick}
                  onEpisodeClick={onEpisodeClick}
                  setUnseenModalItem={setUnseenModalItem}
                  onEdit={handleEdit}
                  onRewatch={handleRewatch}
                />
              );
            })}
          </div>
        </section>
      ))}

      {hasMore && (
        <button onClick={() => setPage(value => value + 1)} className="w-full py-3 mt-4 bg-zinc-900 border border-white/5 rounded-xl text-xs font-bold text-zinc-400 hover:text-white transition-colors">
          Charger plus
        </button>
      )}

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