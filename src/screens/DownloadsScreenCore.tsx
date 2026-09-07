import React, { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Copy,
  Download,
  Film,
  HardDrive,
  Clock3,
  Loader2,
  RefreshCw,
  Search,
  Settings,
  Trash2,
  Tv,
  X
} from 'lucide-react';
import { useLiveDownloadStore } from '../store/liveDownloadStore';
import { useDownloadConfigStore } from '../store/downloadConfigStore';
import { useShowsStore } from '../store/showsStore';
import {
  type LiveDownloadItem,
  formatBytes,
  formatCleanMediaInfo,
  pushReleaseDirectly
} from '../services/sonarrRadarr';
import { type C411Torrent, formatTorrentSize, openC411Magnet, searchC411Torrents } from '../services/c411';
import { useToastStore } from '../store/toastStore';
import { DownloadConfigSection } from '../components/DownloadConfigSection';
import { SwipeableCard } from '../components/cards/SwipeableCard';
import {
  acceptDownloadRequest,
  beginDownloadRequest,
  failDownloadRequest
} from '../features/downloads/downloadLifecycle';
import {
  sortDownloadsByAddedAt,
  truncateDownloadProgressPercent
} from '../features/downloads/downloadPresentation';
import {
  getStableDownloadRenderKey,
  preferSeenItImagePath,
  selectStableDownloadPosterPath
} from '../features/downloads/downloadPosterStability';
import { findMatchingShowForDownload } from '../features/downloads/downloadIdentity';
import { isDownloadInHistorySection } from '../features/downloads/downloadStatePolicy';

interface Props {
  onShowClick?: (id: any, mediaType?: 'tv' | 'movie') => void;
}

type ViewMode = 'downloads' | 'search';
type SearchMediaType = 'all' | 'movie' | 'tv';

function getQualityBadges(quality?: string) {
  if (!quality) return [] as string[];
  const q = quality.toUpperCase();
  const badges: string[] = [];

  if (/2160|4K|UHD/.test(q)) badges.push('4K');
  else if (/1080/.test(q)) badges.push('1080p');
  else if (/720/.test(q)) badges.push('720p');

  if (/REMUX/.test(q)) badges.push('REMUX');
  else if (/BLU.?RAY|BDRIP/.test(q)) badges.push('BluRay');
  else if (/WEB.?DL|WEBDL|WEBRIP/.test(q)) badges.push('WEB-DL');
  else if (/HDTV/.test(q)) badges.push('HDTV');

  if (/HDR/.test(q)) badges.push('HDR');
  else if (/DOLBY.?VISION|DOVI|\bDV\b/.test(q)) badges.push('DV');

  return Array.from(new Set(badges)).slice(0, 3);
}

function DownloadItemCard({
  item,
  onShowClick
}: {
  item: LiveDownloadItem;
  onShowClick?: Props['onShowClick'];
}) {
  const { cleanTitle, subTitle, isTv } = formatCleanMediaInfo(item);
  const libraryShow = useShowsStore(state => findMatchingShowForDownload(item, state.shows));
  const libraryPosterPath = libraryShow?.posterPath || undefined;
  const preferredPoster = preferSeenItImagePath(item.posterPath, libraryPosterPath);

  const status = String(item.status || '').toLowerCase();
  const isCompleted = status === 'completed' || item.progress >= 100;
  const isCancelled = status === 'cancelled';
  const isError = !isCancelled && (status === 'error' || Boolean(item.errorMessage));
  const isWarning = !isCancelled && status === 'warning';
  const isPending = status === 'submitting' || status === 'searching' || status === 'queued';
  const progress = Math.min(100, Math.max(0, Number(item.progress || 0)));
  const progressPercent = truncateDownloadProgressPercent(progress);
  const qualityBadges = getQualityBadges(`${item.quality || ''} ${item.releaseTitle || ''}`);
  const downloadedBytes = item.size > 0 ? Math.max(0, item.size - item.sizeleft) : 0;
  const pendingWithoutProgress = isPending && progress <= 0;
  const progressLabel = isPending
    ? null
    : isCancelled
      ? (progress > 0 ? `${progressPercent}%` : '—')
      : isCompleted
        ? '100%'
        : `${progressPercent}%`;

  const lockedPosterPathRef = useRef<string | undefined>(undefined);
  lockedPosterPathRef.current = selectStableDownloadPosterPath(
    lockedPosterPathRef.current,
    preferredPoster
  );
  const stablePosterPath = lockedPosterPathRef.current;
  const posterSrc = stablePosterPath
    ? stablePosterPath.startsWith('http')
      ? stablePosterPath
      : `https://image.tmdb.org/t/p/w342${stablePosterPath}`
    : null;

  const effectiveTmdbId = item.tmdbId || (libraryShow?.tmdbId ? Number(libraryShow.tmdbId) : undefined);
  const canOpenDetails = Boolean(effectiveTmdbId && onShowClick);
  const openDetails = () => {
    if (!effectiveTmdbId || !onShowClick) return;
    onShowClick(effectiveTmdbId, item.mediaType);
  };

  const accent = isCancelled
    ? 'text-zinc-400'
    : isError
      ? 'text-red-300'
      : isWarning
        ? 'text-amber-300'
        : isCompleted
          ? 'text-emerald-300'
          : 'text-cyan-300';

  const progressBar = isCancelled
    ? 'bg-zinc-600'
    : isError
      ? 'bg-red-500'
      : isWarning
        ? 'bg-amber-400'
        : isCompleted
          ? 'bg-gradient-to-r from-emerald-500 via-emerald-400 to-emerald-300'
          : 'bg-gradient-to-r from-cyan-500 via-sky-400 to-cyan-300';

  const statusLabel = isCancelled
    ? 'Annulé'
    : isError
      ? 'Erreur'
      : isWarning
        ? 'En attente'
        : isCompleted
          ? 'Terminé'
          : 'Téléchargement';

  const pendingLabel = status === 'searching'
    ? 'Recherche en cours'
    : 'Préparation du téléchargement';
  const pendingHint = status === 'searching'
    ? 'Sélection de la meilleure release disponible'
    : 'Connexion au client de téléchargement';

  const hasTransferMeta = item.size > 0
    || Boolean(item.speedFormatted)
    || Boolean(item.timeleft && item.timeleft !== '--');

  return (
    <div
      onClick={canOpenDetails ? openDetails : undefined}
      className={`group relative isolate min-h-[116px] overflow-hidden rounded-2xl bg-zinc-900/60 shadow-[0_12px_30px_rgba(0,0,0,0.20)] ${canOpenDetails ? 'cursor-pointer active:scale-[0.995]' : ''}`}
    >
      <div className="pointer-events-none absolute inset-0 z-20 rounded-2xl ring-1 ring-inset ring-white/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.08)]" />
      <div className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-br from-white/[0.035] via-transparent to-black/10" />

      <div className="relative z-10 flex min-h-[116px] items-stretch">
        <div className="flex w-[92px] shrink-0 flex-col overflow-hidden bg-zinc-950">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              openDetails();
            }}
            className="relative min-h-0 flex-1 overflow-hidden bg-zinc-950"
          >
            {posterSrc ? (
              <img
                src={posterSrc}
                alt={cleanTitle}
                className="absolute inset-0 h-full w-full object-cover object-center transition-transform duration-500 group-hover:scale-105"
                loading={isCompleted ? 'lazy' : 'eager'}
                decoding="async"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center bg-zinc-900">
                {isTv ? <Tv size={24} className="text-indigo-400" /> : <Film size={24} className="text-rose-400" />}
              </div>
            )}
          </button>
          <div className={`flex h-[22px] shrink-0 items-center justify-center gap-1 text-[8px] font-extrabold uppercase tracking-wide text-white ${isTv ? 'bg-indigo-600' : 'bg-rose-600'}`}>
            {isTv ? <Tv size={9} /> : <Film size={9} />}
            <span>{isTv ? 'Série' : 'Film'}</span>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col justify-center px-3 py-2.5">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              openDetails();
            }}
            className="block min-w-0 max-w-full text-left"
          >
            <h3 className="line-clamp-2 text-[15px] font-black leading-[1.15] text-[#E5A93D]">{cleanTitle}</h3>
            {subTitle && <p className="mt-0.5 line-clamp-1 text-[10px] font-semibold text-zinc-400">{subTitle}</p>}
          </button>

          {qualityBadges.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {qualityBadges.map((badge, index) => (
                <span
                  key={badge}
                  className={`rounded-md border px-1.5 py-0.5 text-[9px] font-black tracking-wide ${
                    index === 0
                      ? 'border-cyan-400/20 bg-cyan-400/[0.08] text-cyan-300'
                      : 'border-white/10 bg-white/[0.045] text-zinc-300'
                  }`}
                >
                  {badge}
                </span>
              ))}
            </div>
          )}

          {pendingWithoutProgress ? (
            <div className="mt-2 flex min-w-0 items-center gap-2 rounded-xl border border-cyan-400/10 bg-cyan-400/[0.055] px-2.5 py-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cyan-400/10 text-cyan-300 ring-1 ring-cyan-300/10">
                {status === 'searching' ? <Search size={13} /> : <Loader2 size={13} className="animate-spin" />}
              </div>
              <div className="min-w-0">
                <div className="truncate text-[11px] font-bold text-cyan-200">{pendingLabel}</div>
                <div className="truncate text-[9px] text-zinc-500">{pendingHint}</div>
              </div>
            </div>
          ) : (
            <>
              <div className="mt-2 flex items-end justify-between gap-3">
                <div className={`flex min-w-0 items-center gap-1.5 text-[11px] font-bold ${accent}`}>
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isCancelled ? 'bg-zinc-500' : isCompleted ? 'bg-emerald-400' : isError ? 'bg-red-400' : isWarning ? 'bg-amber-400' : 'bg-cyan-400'}`} />
                  <span className="truncate">{statusLabel}</span>
                </div>
                {progressLabel && <span className={`shrink-0 text-sm font-black tabular-nums ${accent}`}>{progressLabel}</span>}
              </div>

              <div className="relative mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.07] ring-1 ring-white/[0.03]">
                <div
                  className={`h-full rounded-full transition-[width] duration-500 ease-out ${progressBar}`}
                  style={{ width: `${progress}%` }}
                />
              </div>

              {hasTransferMeta && (
                <div className="mt-1.5 flex items-center justify-between gap-2 text-[9px] text-zinc-400">
                  <div className="flex min-w-0 items-center gap-1.5 tabular-nums">
                    {item.size > 0 && (
                      <>
                        <HardDrive size={10} className="shrink-0 text-zinc-500" />
                        <span className="truncate">{formatBytes(downloadedBytes)} / {formatBytes(item.size)}</span>
                      </>
                    )}
                  </div>

                  {!isCompleted && !isCancelled && !isError && (
                    <div className="flex shrink-0 items-center gap-2 tabular-nums">
                      {item.speedFormatted && (
                        <span className="flex items-center gap-1 font-semibold text-zinc-300">
                          <Download size={10} className="text-cyan-400" />
                          {item.speedFormatted}
                        </span>
                      )}
                      {item.timeleft && item.timeleft !== '--' && (
                        <span className="flex items-center gap-1 text-zinc-400">
                          <Clock3 size={10} />
                          {item.timeleft}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {item.errorMessage && (
            <p className="mt-2 rounded-lg border border-red-500/15 bg-red-500/[0.07] px-2 py-1.5 text-[9px] leading-snug text-red-300">
              {item.errorMessage}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function DownloadsScreen({ onShowClick }: Props) {
  const {
    downloads,
    fetchDownloads,
    removeDownload,
    clearAllDownloads
  } = useLiveDownloadStore();
  const config = useDownloadConfigStore();
  const showToast = useToastStore(state => state.showToast);

  const [viewMode, setViewMode] = useState<ViewMode>('downloads');
  const [showConfiguration, setShowConfiguration] = useState(false);
  const [clearingSection, setClearingSection] = useState<'completed' | 'cancelled' | 'error' | null>(null);
  const [pendingCancellation, setPendingCancellation] = useState<LiveDownloadItem | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMediaType, setSelectedMediaType] = useState<SearchMediaType>('all');
  const [selectedQuality, setSelectedQuality] = useState<'all' | '2160p' | '1080p' | '720p'>('all');
  const [sortBy, setSortBy] = useState<'seeders' | 'size' | 'date'>('seeders');
  const [torrents, setTorrents] = useState<C411Torrent[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [sendingTorrentId, setSendingTorrentId] = useState<number | null>(null);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  const isConfigured = Boolean(
    (config.sonarrUrl && config.sonarrApiKey)
    || (config.radarrUrl && config.radarrApiKey)
    || config.qbittorrentUrl
  );

  const activeDownloads = useMemo(
    () => sortDownloadsByAddedAt(
      downloads.filter(item => item.status !== 'completed' && item.status !== 'cancelled' && item.status !== 'error' && item.progress < 100),
      'asc'
    ),
    [downloads]
  );
  const errorDownloads = useMemo(
    () => sortDownloadsByAddedAt(downloads.filter(item => isDownloadInHistorySection(item, 'error')), 'desc'),
    [downloads]
  );
  const cancelledDownloads = useMemo(
    () => sortDownloadsByAddedAt(downloads.filter(item => isDownloadInHistorySection(item, 'cancelled')), 'desc'),
    [downloads]
  );
  const completedDownloads = useMemo(
    () => sortDownloadsByAddedAt(downloads.filter(item => isDownloadInHistorySection(item, 'completed')), 'desc'),
    [downloads]
  );

  const performSearch = async () => {
    const query = searchQuery.trim();
    if (!query || isSearching) return;

    setIsSearching(true);
    try {
      const results = await searchC411Torrents({
        query,
        mediaType: selectedMediaType === 'all' ? undefined : selectedMediaType
      });
      setTorrents(results);
      setHasSearched(true);
    } catch (error: any) {
      setTorrents([]);
      setHasSearched(true);
      showToast(error?.message || 'C411 est momentanément indisponible.', 'error');
    } finally {
      setIsSearching(false);
    }
  };

  const filteredTorrents = useMemo(() => {
    let list = [...torrents];

    if (selectedQuality !== 'all') {
      list = list.filter(torrent => {
        const haystack = `${torrent.quality || ''} ${torrent.name}`.toLowerCase();
        if (selectedQuality === '2160p') return /2160|4k|uhd/.test(haystack);
        if (selectedQuality === '1080p') return /1080p|1080i/.test(haystack);
        return /720p/.test(haystack);
      });
    }

    list.sort((a, b) => {
      if (sortBy === 'size') return (b.size || 0) - (a.size || 0);
      if (sortBy === 'date') {
        return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
      }
      return (b.seeders || 0) - (a.seeders || 0);
    });

    return list;
  }, [torrents, selectedQuality, sortBy]);

  const performRemove = async (item: LiveDownloadItem) => {
    const status = String(item.status || '').toLowerCase();
    const wasActive = status !== 'completed'
      && status !== 'cancelled'
      && status !== 'error'
      && Number(item.progress || 0) < 100;

    const success = await removeDownload(item);
    showToast({
      title: item.movieTitle || item.seriesTitle || item.title,
      action: success
        ? (wasActive ? 'Téléchargement annulé' : 'Retiré de la liste')
        : (wasActive ? 'Annulation non confirmée' : 'Retrait non confirmé'),
      posterPath: item.posterPath
    }, success ? 'success' : 'info');
  };

  const handleRemove = (item: LiveDownloadItem) => {
    const isActive = item.status !== 'completed'
      && item.status !== 'cancelled'
      && item.status !== 'error'
      && Number(item.progress || 0) < 100;
    if (isActive) {
      setPendingCancellation(item);
      return;
    }
    void performRemove(item);
  };

  const handleClearAll = async (section: 'completed' | 'cancelled' | 'error') => {
    if (clearingSection) return;
    setClearingSection(section);
    await clearAllDownloads(section);
    setClearingSection(null);
    showToast('Cette section a été vidée sans toucher aux téléchargements actifs.', 'success');
  };

  const resolveSearchMediaType = (_torrent: C411Torrent): 'movie' | 'tv' | null => {
    if (selectedMediaType === 'movie' || selectedMediaType === 'tv') return selectedMediaType;
    return null;
  };

  const handleSendTorrent = async (torrent: C411Torrent) => {
    const mediaType = resolveSearchMediaType(torrent);
    if (!mediaType) {
      showToast('Choisis “Film” ou “Série” avant d’envoyer cette release.', 'error');
      return;
    }

    let service: 'sonarr' | 'radarr' | 'qbittorrent' | null = null;
    let url = '';
    let apiKey = '';
    let username = '';
    let password = '';

    if (mediaType === 'tv' && config.sonarrUrl && config.sonarrApiKey) {
      service = 'sonarr';
      url = config.sonarrUrl;
      apiKey = config.sonarrApiKey;
    } else if (mediaType === 'movie' && config.radarrUrl && config.radarrApiKey) {
      service = 'radarr';
      url = config.radarrUrl;
      apiKey = config.radarrApiKey;
    } else if (config.qbittorrentUrl) {
      service = 'qbittorrent';
      url = config.qbittorrentUrl;
      username = config.qbittorrentUsername;
      password = config.qbittorrentPassword;
    }

    if (!service) {
      if (torrent.magnetUri) {
        const opened = await openC411Magnet(torrent.magnetUri);
        showToast(
          opened ? 'Ouverture du client BitTorrent local…' : 'Aucun client BitTorrent ne peut ouvrir ce lien.',
          opened ? 'info' : 'error'
        );
      } else {
        showToast('Aucun client de téléchargement configuré.', 'error');
      }
      return;
    }

    setSendingTorrentId(torrent.id);
    const clientLabel = service === 'sonarr' ? 'Sonarr' : service === 'radarr' ? 'Radarr' : 'qBittorrent';
    const requestId = beginDownloadRequest({
      title: torrent.name,
      mediaType,
      downloadClient: clientLabel,
      statusText: 'Recherche en cours',
      releaseTitle: torrent.name
    });
    showToast('Recherche du téléchargement…', 'download');

    try {
      const result = await pushReleaseDirectly({
        service,
        url,
        apiKey,
        username,
        password,
        torrent,
        mediaType,
        mediaInfo: { title: torrent.name }
      });

      if (result.success) {
        acceptDownloadRequest(requestId, 'Préparation du téléchargement', 'queued');
        showToast('Téléchargement lancé.', 'success');
      } else {
        failDownloadRequest(requestId, result.message);
        showToast(result.message, 'error');
      }
    } catch (error: any) {
      const message = error?.message || "Erreur lors de l'envoi au client.";
      failDownloadRequest(requestId, message);
      showToast(message, 'error');
    } finally {
      setSendingTorrentId(null);
    }
  };

  const copyMagnet = async (torrent: C411Torrent) => {
    if (!torrent.magnetUri) return;
    try {
      await navigator.clipboard.writeText(torrent.magnetUri);
      setCopiedHash(torrent.infoHash);
      window.setTimeout(() => setCopiedHash(null), 1800);
      showToast('Lien Magnet copié.', 'success');
    } catch {
      showToast('Impossible de copier le lien Magnet.', 'error');
    }
  };

  if (showConfiguration) {
    return (
      <div className="flex-1 min-h-0 flex flex-col bg-premium-ambient text-white overflow-hidden">
        <div className="shrink-0 px-4 pt-4 pb-3 border-b border-white/5 bg-zinc-950/70 backdrop-blur-xl flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowConfiguration(false)}
            className="w-11 h-11 rounded-xl bg-zinc-900 border border-white/10 flex items-center justify-center text-zinc-300"
            aria-label="Retour aux téléchargements"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-lg font-black">Configuration téléchargements</h1>
            <p className="text-[11px] text-zinc-400">C411 • Sonarr • Radarr • qBittorrent</p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 pb-28">
          <DownloadConfigSection defaultOpen hideToggle />
        </div>
      </div>
    );
  }

  const renderSection = (
    title: string,
    items: LiveDownloadItem[],
    tone: string,
    clearSection?: 'completed' | 'cancelled' | 'error'
  ) => (
    <section className="space-y-2">
      <div className="flex items-center justify-between px-0.5">
        <h2 className={`text-xs font-black uppercase tracking-wider ${tone}`}>{title} • {items.length}</h2>
        {clearSection && (
          <button
            type="button"
            disabled={Boolean(clearingSection)}
            onClick={() => void handleClearAll(clearSection)}
            className="min-h-10 px-2 text-xs font-bold text-zinc-500 hover:text-red-400 flex items-center gap-1 disabled:opacity-50"
            aria-label={`Effacer la section ${title}`}
          >
            {clearingSection === clearSection ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            Effacer
          </button>
        )}
      </div>
      {items.map(item => {
        const itemStatus = String(item.status || '').toLowerCase();
        const isActive = itemStatus !== 'completed'
          && itemStatus !== 'cancelled'
          && itemStatus !== 'error'
          && Number(item.progress || 0) < 100;

        return (
          <SwipeableCard
            key={getStableDownloadRenderKey(item)}
            onSwipeRight={() => handleRemove(item)}
            rightAction={{
              title: isActive ? 'Annuler' : 'Retirer',
              subtitle: isActive ? 'Arrêter le téléchargement' : 'Effacer de la liste',
              icon: <Trash2 size={20} className="text-white" />,
              tone: 'rose'
            }}
          >
            <DownloadItemCard item={item} onShowClick={onShowClick} />
          </SwipeableCard>
        );
      })}
    </section>
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-premium-ambient text-white overflow-hidden">
      <div className="shrink-0 px-4 pt-4 pb-3 border-b border-white/5 bg-zinc-950/70 backdrop-blur-xl space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-black tracking-tight">Téléchargements</h1>
            <p className="text-[11px] text-zinc-400">
              {viewMode === 'downloads' ? 'Suivi en temps réel' : 'Recherche manuelle C411'}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void fetchDownloads()}
              className="w-11 h-11 rounded-xl bg-zinc-900 border border-white/10 text-zinc-400 hover:text-white flex items-center justify-center"
              title="Actualiser"
              aria-label="Actualiser les téléchargements"
            >
              <RefreshCw size={16} />
            </button>
            <button
              type="button"
              onClick={() => setShowConfiguration(true)}
              className="w-11 h-11 rounded-xl bg-zinc-900 border border-white/10 text-zinc-400 hover:text-white flex items-center justify-center"
              title="Réglages"
              aria-label="Ouvrir les réglages de téléchargement"
            >
              <Settings size={16} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-zinc-900/90 border border-white/5">
          <button
            type="button"
            onClick={() => setViewMode('downloads')}
            className={`py-2 rounded-lg text-xs font-bold ${viewMode === 'downloads' ? 'bg-zinc-700 text-white' : 'text-zinc-400'}`}
          >
            Mes téléchargements
          </button>
          <button
            type="button"
            onClick={() => setViewMode('search')}
            className={`py-2 rounded-lg text-xs font-bold ${viewMode === 'search' ? 'bg-zinc-700 text-white' : 'text-zinc-400'}`}
          >
            Recherche C411
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3.5 pb-28">
        {viewMode === 'downloads' ? (
          <div className="space-y-4">
            {!isConfigured && (
              <button
                type="button"
                onClick={() => setShowConfiguration(true)}
                className="w-full p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-left flex items-start gap-2.5"
              >
                <AlertCircle size={17} className="text-amber-400 shrink-0 mt-0.5" />
                <span>
                  <span className="block text-xs font-bold text-amber-200">Clients de téléchargement à configurer</span>
                  <span className="block text-[10px] text-amber-300/80 mt-0.5">Ajoute Sonarr, Radarr ou qBittorrent pour activer le suivi.</span>
                </span>
              </button>
            )}

            {activeDownloads.length > 0 && renderSection('En cours', activeDownloads, 'text-zinc-400')}
            {errorDownloads.length > 0 && renderSection('En erreur', errorDownloads, 'text-red-400', 'error')}
            {cancelledDownloads.length > 0 && renderSection('Annulés', cancelledDownloads, 'text-zinc-500', 'cancelled')}
            {completedDownloads.length > 0 && renderSection('Terminés', completedDownloads, 'text-zinc-500', 'completed')}

            {!downloads.length && (
              <div className="py-16 flex flex-col items-center text-center gap-3 text-zinc-500">
                <div className="w-14 h-14 rounded-2xl bg-zinc-900 border border-white/5 flex items-center justify-center">
                  <Download size={24} />
                </div>
                <div>
                  <p className="text-sm font-bold text-zinc-300">Aucun téléchargement suivi</p>
                  <p className="text-[11px] mt-1 max-w-[270px]">Depuis une fiche, choisis 1080p ou 4K : la demande apparaîtra ici immédiatement.</p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3.5">
            <form
              onSubmit={event => {
                event.preventDefault();
                void performSearch();
              }}
              className="flex gap-2"
            >
              <div className="relative flex-1">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  value={searchQuery}
                  onChange={event => setSearchQuery(event.target.value)}
                  placeholder="Film, série, S02E05…"
                  className="w-full pl-9 pr-9 py-2.5 rounded-xl bg-zinc-900 border border-zinc-700 text-xs text-white outline-none focus:border-[#E5A93D]"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-0 top-1/2 -translate-y-1/2 w-11 h-11 text-zinc-500 flex items-center justify-center"
                    aria-label="Effacer la recherche"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              <button
                type="submit"
                disabled={isSearching || !searchQuery.trim()}
                className="px-3.5 py-2.5 rounded-xl bg-[#E5A93D] text-black text-xs font-black disabled:opacity-50"
              >
                {isSearching ? <Loader2 size={15} className="animate-spin" /> : 'Chercher'}
              </button>
            </form>

            <div className="flex items-center gap-1 overflow-x-auto pb-1">
              {([
                { id: 'all' as const, label: 'Tous' },
                { id: 'movie' as const, label: 'Films' },
                { id: 'tv' as const, label: 'Séries' }
              ]).map(option => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setSelectedMediaType(option.id)}
                  className={`min-h-11 px-3 rounded-lg text-xs font-bold border shrink-0 ${
                    selectedMediaType === option.id
                      ? 'bg-zinc-700 text-white border-zinc-600'
                      : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                  }`}
                >
                  {option.label}
                </button>
              ))}

              <span className="w-px h-5 bg-zinc-800 mx-1 shrink-0" />

              {(['all', '2160p', '1080p', '720p'] as const).map(quality => (
                <button
                  key={quality}
                  type="button"
                  onClick={() => setSelectedQuality(quality)}
                  className={`min-h-11 px-3 rounded-lg text-xs font-bold border shrink-0 ${
                    selectedQuality === quality
                      ? 'bg-blue-600 text-white border-blue-500'
                      : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                  }`}
                >
                  {quality === 'all' ? 'Toutes qualités' : quality === '2160p' ? '4K' : quality}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-xs uppercase font-black text-zinc-500">Tri</span>
              {(['seeders', 'size', 'date'] as const).map(sort => (
                <button
                  key={sort}
                  type="button"
                  onClick={() => setSortBy(sort)}
                  className={`min-h-11 px-3 rounded-lg text-xs font-bold border ${
                    sortBy === sort
                      ? 'bg-zinc-700 text-white border-zinc-600'
                      : 'bg-zinc-900 text-zinc-500 border-zinc-800'
                  }`}
                >
                  {sort === 'seeders' ? 'Seeders' : sort === 'size' ? 'Taille' : 'Date'}
                </button>
              ))}
            </div>

            {isSearching ? (
              <div className="py-16 flex flex-col items-center gap-2 text-zinc-400">
                <Loader2 size={28} className="animate-spin text-[#E5A93D]" />
                <span className="text-xs font-bold">Recherche C411…</span>
              </div>
            ) : filteredTorrents.length > 0 ? (
              <div className="space-y-2.5">
                {filteredTorrents.map(torrent => (
                  <div key={torrent.id} className="rounded-2xl bg-zinc-900/85 border border-white/10 p-3.5 space-y-2.5">
                    <h3 className="text-xs font-bold text-white break-words leading-snug">{torrent.name}</h3>
                    <div className="flex flex-wrap items-center gap-2 text-[10px] text-zinc-400">
                      {torrent.quality && <span className="font-bold text-blue-300">{torrent.quality}</span>}
                      {torrent.language && <span>{torrent.language}</span>}
                      <span>{formatTorrentSize(torrent.size)}</span>
                      <span className="text-emerald-400 font-bold">↑ {torrent.seeders || 0}</span>
                      <span>↓ {torrent.leechers || 0}</span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={sendingTorrentId === torrent.id}
                        onClick={() => void handleSendTorrent(torrent)}
                        className="flex-1 min-h-11 rounded-xl bg-[#E5A93D] hover:bg-[#f0b84c] text-black text-xs font-black flex items-center justify-center gap-1.5 disabled:opacity-50"
                      >
                        {sendingTorrentId === torrent.id ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                        Envoyer
                      </button>
                      <button
                        type="button"
                        onClick={() => void copyMagnet(torrent)}
                        className="min-h-11 px-3 rounded-xl bg-zinc-800 text-zinc-300 text-xs font-bold flex items-center gap-1.5"
                      >
                        {copiedHash === torrent.infoHash ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                        Magnet
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : hasSearched ? (
              <div className="py-14 text-center text-xs text-zinc-500">Aucune release trouvée.</div>
            ) : (
              <div className="py-14 text-center text-[11px] text-zinc-500 max-w-[300px] mx-auto">
                La recherche manuelle est séparée du suivi : taper ici ne masque plus tes téléchargements en cours.
              </div>
            )}
          </div>
        )}
      </div>

      {pendingCancellation && (
        <div
          className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center bg-black/75 p-4"
          role="presentation"
          onMouseDown={event => {
            if (event.target === event.currentTarget) setPendingCancellation(null);
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="cancel-download-title"
            aria-describedby="cancel-download-description"
            className="w-full max-w-sm rounded-3xl border border-white/10 bg-zinc-950 p-5 shadow-2xl"
            onKeyDown={event => {
              if (event.key === 'Escape') setPendingCancellation(null);
            }}
          >
            <h2 id="cancel-download-title" className="text-lg font-black text-white">Annuler le téléchargement ?</h2>
            <p id="cancel-download-description" className="mt-2 text-sm leading-relaxed text-zinc-300">
              « {pendingCancellation.movieTitle || pendingCancellation.seriesTitle || pendingCancellation.title} » sera retiré de {pendingCancellation.downloadClient || 'son client distant'}.
              {String(pendingCancellation.downloadClient || '').toLowerCase().includes('qbittorrent') && ' Les fichiers déjà téléchargés seront conservés.'}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPendingCancellation(null)}
                className="min-h-11 rounded-xl border border-white/10 bg-zinc-900 px-4 text-sm font-bold text-zinc-200"
              >
                Garder
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => {
                  const item = pendingCancellation;
                  setPendingCancellation(null);
                  void performRemove(item);
                }}
                className="min-h-11 rounded-xl bg-red-500 px-4 text-sm font-black text-white"
              >
                Confirmer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
