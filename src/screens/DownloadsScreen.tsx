import React, { useEffect, useMemo, useState } from 'react';
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
import {
  type LiveDownloadItem,
  formatBytes,
  formatCleanMediaInfo,
  pushReleaseDirectly
} from '../services/sonarrRadarr';
import { type C411Torrent, formatTorrentSize, searchC411Torrents } from '../services/c411';
import { useToastStore } from '../store/toastStore';
import { DownloadConfigSection } from '../components/DownloadConfigSection';
import {
  acceptDownloadRequest,
  beginDownloadRequest,
  failDownloadRequest
} from '../features/downloads/downloadLifecycle';

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
  onShowClick,
  onRemove,
  isRemoving
}: {
  item: LiveDownloadItem;
  onShowClick?: Props['onShowClick'];
  onRemove: (item: LiveDownloadItem) => void;
  isRemoving: boolean;
}) {
  const { cleanTitle, subTitle, isTv } = formatCleanMediaInfo(item);
  const status = String(item.status || '').toLowerCase();
  const isCompleted = status === 'completed' || item.progress >= 100;
  const isError = status === 'error' || Boolean(item.errorMessage);
  const isWarning = status === 'warning';
  const isPending = status === 'submitting' || status === 'searching' || status === 'queued';
  const progress = Math.min(100, Math.max(0, Number(item.progress || 0)));
  const qualityBadges = getQualityBadges(item.quality);
  const downloadedBytes = item.size > 0 ? Math.max(0, item.size - item.sizeleft) : 0;
  const progressLabel = isCompleted ? '100%' : progress > 0 ? `${progress.toFixed(1).replace(/\.0$/, '')}%` : '0%';
  const posterSrc = item.posterPath
    ? item.posterPath.startsWith('http')
      ? item.posterPath
      : `https://image.tmdb.org/t/p/w185${item.posterPath}`
    : null;

  const accent = isError
    ? 'text-red-300'
    : isWarning
      ? 'text-amber-300'
      : isCompleted
        ? 'text-emerald-300'
        : 'text-cyan-300';

  const progressBar = isError
    ? 'bg-red-500'
    : isWarning
      ? 'bg-amber-400'
      : isCompleted
        ? 'bg-gradient-to-r from-emerald-500 to-emerald-300'
        : 'bg-gradient-to-r from-cyan-500 via-sky-400 to-cyan-300';

  const statusLabel = isError
    ? 'Erreur'
    : isWarning
      ? (item.statusText || 'En attente')
      : isCompleted
        ? 'Terminé'
        : isPending
          ? (status === 'searching' ? 'Recherche' : 'Préparation')
          : 'Téléchargement';

  return (
    <div
      className={`relative overflow-hidden rounded-[22px] border bg-gradient-to-br from-zinc-900/95 to-zinc-950/90 p-3.5 shadow-[0_10px_30px_rgba(0,0,0,0.18)] ${
        isError
          ? 'border-red-500/25'
          : isWarning
            ? 'border-amber-500/20'
            : isCompleted
              ? 'border-emerald-500/20'
              : 'border-white/[0.08]'
      }`}
    >
      <div className="flex gap-3.5">
        <button
          type="button"
          onClick={() => item.tmdbId && onShowClick?.(item.tmdbId, item.mediaType)}
          className="relative w-16 aspect-[2/3] shrink-0 self-start overflow-hidden rounded-[14px] border border-white/10 bg-zinc-950 shadow-md flex items-center justify-center"
        >
          {posterSrc ? (
            <img
              src={posterSrc}
              alt={cleanTitle}
              className="absolute inset-0 block h-full w-full object-cover object-center"
              loading="lazy"
            />
          ) : isTv ? (
            <Tv size={22} className="text-purple-400" />
          ) : (
            <Film size={22} className="text-amber-400" />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <button
              type="button"
              onClick={() => item.tmdbId && onShowClick?.(item.tmdbId, item.mediaType)}
              className="min-w-0 flex-1 text-left"
            >
              <h3 className="text-[15px] font-black leading-tight text-white line-clamp-2">{cleanTitle}</h3>
              {subTitle && <p className="mt-1 text-[11px] font-semibold text-zinc-400">{subTitle}</p>}
            </button>

            <button
              type="button"
              disabled={isRemoving}
              onClick={() => onRemove(item)}
              className="-mr-1 -mt-1 rounded-full p-2 text-zinc-600 transition-colors hover:bg-white/5 hover:text-red-400 disabled:opacity-50"
              aria-label="Supprimer"
            >
              {isRemoving ? <Loader2 size={14} className="animate-spin" /> : <X size={15} />}
            </button>
          </div>

          {qualityBadges.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {qualityBadges.map((badge, index) => (
                <span
                  key={badge}
                  className={`rounded-md border px-1.5 py-0.5 text-[9px] font-black tracking-wide ${
                    index === 0
                      ? 'border-cyan-400/25 bg-cyan-400/10 text-cyan-200'
                      : 'border-white/10 bg-white/[0.04] text-zinc-300'
                  }`}
                >
                  {badge}
                </span>
              ))}
            </div>
          )}

          <div className="mt-3 flex items-end justify-between gap-3">
            <div className={`flex min-w-0 items-center gap-1.5 text-[11px] font-bold ${accent}`}>
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isCompleted ? 'bg-emerald-400' : isError ? 'bg-red-400' : isWarning ? 'bg-amber-400' : 'bg-cyan-400'}`} />
              <span className="truncate">{statusLabel}</span>
            </div>
            <span className={`shrink-0 text-sm font-black tabular-nums ${accent}`}>{progressLabel}</span>
          </div>

          {isPending && progress <= 0 ? (
            <div className="mt-2 flex h-2 items-center gap-1.5" aria-label="Activité en cours">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400/90 animate-pulse" />
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400/65 animate-pulse [animation-delay:160ms]" />
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400/40 animate-pulse [animation-delay:320ms]" />
            </div>
          ) : (
            <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-white/[0.07] ring-1 ring-white/[0.03]">
              <div
                className={`relative h-full rounded-full transition-[width] duration-500 ease-out ${progressBar} ${!isCompleted && !isError ? 'shadow-[0_0_12px_rgba(34,211,238,0.28)]' : ''}`}
                style={{ width: `${progress}%` }}
              >
                {!isCompleted && progress > 4 && <div className="absolute inset-0 bg-white/[0.08]" />}
              </div>
            </div>
          )}

          <div className="mt-2 flex items-center justify-between gap-3 text-[10px] text-zinc-400">
            <div className="flex min-w-0 items-center gap-1.5 tabular-nums">
              <HardDrive size={11} className="shrink-0 text-zinc-500" />
              {item.size > 0 && !isPending ? (
                <span className="truncate">{formatBytes(downloadedBytes)} / {formatBytes(item.size)}</span>
              ) : (
                <span className="truncate">{item.statusText || statusLabel}</span>
              )}
            </div>

            {!isCompleted && !isError && !isPending && (
              <div className="flex shrink-0 items-center gap-2.5 tabular-nums">
                {item.speedFormatted && (
                  <span className="flex items-center gap-1 font-semibold text-zinc-300">
                    <Download size={11} className="text-cyan-400" />
                    {item.speedFormatted}
                  </span>
                )}
                {item.timeleft && item.timeleft !== '--' && (
                  <span className="flex items-center gap-1 text-zinc-400">
                    <Clock3 size={11} />
                    {item.timeleft}
                  </span>
                )}
              </div>
            )}
          </div>

          {item.errorMessage && (
            <p className="mt-2 rounded-xl border border-red-500/15 bg-red-500/[0.07] px-2.5 py-2 text-[10px] leading-snug text-red-300">
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
    lastUpdated,
    startPolling,
    stopPolling,
    fetchDownloads,
    removeDownload,
    clearAllDownloads
  } = useLiveDownloadStore();
  const config = useDownloadConfigStore();
  const showToast = useToastStore(state => state.showToast);

  const [viewMode, setViewMode] = useState<ViewMode>('downloads');
  const [showConfiguration, setShowConfiguration] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [isClearing, setIsClearing] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMediaType, setSelectedMediaType] = useState<SearchMediaType>('all');
  const [selectedQuality, setSelectedQuality] = useState<'all' | '2160p' | '1080p' | '720p'>('all');
  const [sortBy, setSortBy] = useState<'seeders' | 'size' | 'date'>('seeders');
  const [torrents, setTorrents] = useState<C411Torrent[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [sendingTorrentId, setSendingTorrentId] = useState<number | null>(null);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  useEffect(() => {
    // DownloadsScreen reste monté dans MainApp : il sert de vue du moniteur global.
    startPolling(1000);
    return () => stopPolling();
  }, [startPolling, stopPolling]);

  const isConfigured = Boolean(
    (config.sonarrUrl && config.sonarrApiKey) ||
    (config.radarrUrl && config.radarrApiKey) ||
    config.qbittorrentUrl
  );

  const activeDownloads = useMemo(
    () => downloads.filter(item => item.status !== 'completed' && item.progress < 100),
    [downloads]
  );
  const completedDownloads = useMemo(
    () => downloads.filter(item => item.status === 'completed' || item.progress >= 100),
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

  const handleRemove = async (item: LiveDownloadItem) => {
    setRemovingId(item.id);
    const success = await removeDownload(item);
    setRemovingId(null);
    showToast({
      title: item.movieTitle || item.seriesTitle || item.title,
      action: success
        ? 'Retiré de la liste'
        : 'Retiré de la liste • arrêt non confirmé',
      posterPath: item.posterPath
    }, success ? 'success' : 'info');
  };

  const handleClearAll = async () => {
    if (!downloads.length || isClearing) return;
    setIsClearing(true);
    await clearAllDownloads();
    setIsClearing(false);
    showToast('Liste des téléchargements vidée.', 'success');
  };

  const resolveSearchMediaType = (torrent: C411Torrent): 'movie' | 'tv' | null => {
    if (selectedMediaType === 'movie' || selectedMediaType === 'tv') return selectedMediaType;
    if (/\bS\d{1,2}(?:E\d{1,3})?\b|\bseason\b|\bsaison\b/i.test(torrent.name)) return 'tv';
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
        window.location.href = torrent.magnetUri;
        showToast('Ouverture du client BitTorrent local…', 'info');
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
      statusText: 'Demande prise en compte • préparation du téléchargement…',
      releaseTitle: torrent.name
    });
    showToast('Demande prise en compte • préparation du téléchargement…', 'download');

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
        acceptDownloadRequest(requestId, 'Téléchargement accepté • mise en file d’attente', 'queued');
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
            className="w-9 h-9 rounded-xl bg-zinc-900 border border-white/10 flex items-center justify-center text-zinc-300"
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
              className="w-9 h-9 rounded-xl bg-zinc-900 border border-white/10 text-zinc-400 hover:text-white flex items-center justify-center"
              title="Actualiser"
            >
              <RefreshCw size={16} />
            </button>
            <button
              type="button"
              onClick={() => setShowConfiguration(true)}
              className="w-9 h-9 rounded-xl bg-zinc-900 border border-white/10 text-zinc-400 hover:text-white flex items-center justify-center"
              title="Réglages"
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

      <div className="flex-1 overflow-y-auto px-3.5 py-4 pb-28">
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

            {activeDownloads.length > 0 && (
              <section className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-black uppercase tracking-wider text-zinc-400">En cours • {activeDownloads.length}</h2>
                  {lastUpdated && (
                    <span className="text-[9px] text-zinc-600">
                      {new Date(lastUpdated).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                  )}
                </div>
                {activeDownloads.map(item => (
                  <DownloadItemCard
                    key={item.id}
                    item={item}
                    onShowClick={onShowClick}
                    onRemove={handleRemove}
                    isRemoving={removingId === item.id}
                  />
                ))}
              </section>
            )}

            {completedDownloads.length > 0 && (
              <section className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-black uppercase tracking-wider text-zinc-500">Terminés • {completedDownloads.length}</h2>
                  <button
                    type="button"
                    disabled={isClearing}
                    onClick={() => void handleClearAll()}
                    className="text-[10px] font-bold text-zinc-500 hover:text-red-400 flex items-center gap-1 disabled:opacity-50"
                  >
                    {isClearing ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                    Vider
                  </button>
                </div>
                {completedDownloads.map(item => (
                  <DownloadItemCard
                    key={item.id}
                    item={item}
                    onShowClick={onShowClick}
                    onRemove={handleRemove}
                    isRemoving={removingId === item.id}
                  />
                ))}
              </section>
            )}

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
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500"
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
                  className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold border shrink-0 ${
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
                  className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold border shrink-0 ${
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
              <span className="text-[9px] uppercase font-black text-zinc-600">Tri</span>
              {(['seeders', 'size', 'date'] as const).map(sort => (
                <button
                  key={sort}
                  type="button"
                  onClick={() => setSortBy(sort)}
                  className={`px-2 py-1 rounded-lg text-[9px] font-bold border ${
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
                        className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-black flex items-center justify-center gap-1.5 disabled:opacity-50"
                      >
                        {sendingTorrentId === torrent.id ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                        Envoyer
                      </button>
                      <button
                        type="button"
                        onClick={() => void copyMagnet(torrent)}
                        className="px-3 py-2.5 rounded-xl bg-zinc-800 text-zinc-300 text-[10px] font-bold flex items-center gap-1.5"
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
    </div>
  );
}
