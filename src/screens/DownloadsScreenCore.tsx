import { DialogLayer } from '../components/ui/DialogLayer';
import { DownloadItemCard } from '../components/DownloadItemCard';
import { downloadGroup } from '../features/downloads/downloadGroups';
import { matchesLightFilter, type LightFilter } from '../features/downloads/releaseQuality';
import { ReleaseLightFilter } from '../components/ReleaseLightFilter';
import './downloads.css';
import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  pushReleaseDirectly
} from '../services/sonarrRadarr';
import { type C411Torrent, formatTorrentSize, openC411Magnet, searchC411Torrents } from '../services/c411';
import { useToastStore } from '../store/toastStore';
import { DownloadConfigSection } from '../components/DownloadConfigSection';
import { SwipeableCard } from '../components/cards/SwipeableCard';
import {
  getC411ManualMediaTypeLabel,
  planC411ManualDownload,
  resolveC411ManualMediaType
} from '../features/downloads/c411ManualRouting';
import {
  acceptDownloadRequest,
  beginDownloadRequest,
  failDownloadRequest
} from '../features/downloads/downloadLifecycle';
import { sortDownloadsByAddedAt } from '../features/downloads/downloadPresentation';
import { getStableDownloadRenderKey } from '../features/downloads/downloadPosterStability';
import { useTabShortcut } from '../features/navigation/useTabShortcut';

interface Props {
  onShowClick?: (id: string | number, mediaType?: 'tv' | 'movie') => void;
  navigationShortcut?: number;
}

type ViewMode = 'downloads' | 'search';
type SearchMediaType = 'all' | 'movie' | 'tv';

export function DownloadsScreen({ onShowClick, navigationShortcut }: Props) {
  const {
    downloads,
    fetchDownloads,
    removeDownload,
    clearAllDownloads
  } = useLiveDownloadStore();
  const config = useDownloadConfigStore();
  const showToast = useToastStore(state => state.showToast);
  const screenRootRef = useRef<HTMLDivElement>(null);
  const searchRequestRef = useRef(0);
  const sendInFlightRef = useRef(false);

  const [viewMode, setViewMode] = useState<ViewMode>('downloads');
  useTabShortcut(navigationShortcut, () => {
    setViewMode('search');
    const frame = requestAnimationFrame(() => screenRootRef.current?.querySelector<HTMLInputElement>('[data-navigation-search]')?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  });
  const [showConfiguration, setShowConfiguration] = useState(false);
  const [clearingSection, setClearingSection] = useState<'completed' | 'cancelled' | 'error' | null>(null);
  const [pendingCancellation, setPendingCancellation] = useState<LiveDownloadItem | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMediaType, setSelectedMediaType] = useState<SearchMediaType>('all');
  const [selectedQuality, setSelectedQuality] = useState<'all' | '2160p' | '1080p' | '720p'>('all');
  const [lightFilter, setLightFilter] = useState<LightFilter>('all');
  const [sortBy, setSortBy] = useState<'seeders' | 'size' | 'date'>('seeders');
  const [torrents, setTorrents] = useState<C411Torrent[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [sendingTorrentId, setSendingTorrentId] = useState<number | null>(null);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  useEffect(() => {
    const scrollToTop = () => {
      const scrollRoot = screenRootRef.current?.querySelector<HTMLElement>('.overflow-y-auto');
      if (scrollRoot) scrollRoot.scrollTop = 0;
    };
    const handleBackOneLevel = (event: Event) => {
      if (pendingCancellation || showConfiguration || viewMode === 'search') event.preventDefault();
      if (pendingCancellation) {
        setPendingCancellation(null);
        return;
      }
      if (showConfiguration) {
        setShowConfiguration(false);
        return;
      }
      if (viewMode === 'search') setViewMode('downloads');
    };
    const handleResetAll = () => {
      searchRequestRef.current += 1;
      setViewMode('downloads');
      setShowConfiguration(false);
      setClearingSection(null);
      setPendingCancellation(null);
      setSearchQuery('');
      setSelectedMediaType('all');
      setSelectedQuality('all');
      setLightFilter('all');
      setSortBy('seeders');
      setTorrents([]);
      setIsSearching(false);
      setHasSearched(false);
      setSearchError(null);
      setSendingTorrentId(null);
      setCopiedHash(null);
      requestAnimationFrame(scrollToTop);
      showToast('Télécharger réinitialisé : recherche et filtres effacés.', 'info');
    };

    window.addEventListener('downloads-back-one-level', handleBackOneLevel);
    window.addEventListener('downloads-reset-all', handleResetAll);
    return () => {
      window.removeEventListener('downloads-back-one-level', handleBackOneLevel);
      window.removeEventListener('downloads-reset-all', handleResetAll);
    };
  }, [pendingCancellation, showConfiguration, showToast, viewMode]);

  const isConfigured = Boolean(
    (config.sonarrUrl && config.sonarrApiKey)
    || (config.radarrUrl && config.radarrApiKey)
    || config.qbittorrentUrl
  );

  const activeDownloads = useMemo(
    () => sortDownloadsByAddedAt(
      downloads.filter(item => downloadGroup(item) === 'active'),
      'asc'
    ),
    [downloads]
  );
  const errorDownloads = useMemo(
    () => sortDownloadsByAddedAt(downloads.filter(item => downloadGroup(item) === 'attention'), 'desc'),
    [downloads]
  );
  const waitingDownloads = useMemo(() => sortDownloadsByAddedAt(downloads.filter(item => downloadGroup(item) === 'waiting'), 'asc'), [downloads]);
  const cancelledDownloads = useMemo(
    () => sortDownloadsByAddedAt(downloads.filter(item => downloadGroup(item) === 'cancelled'), 'desc'),
    [downloads]
  );
  const completedDownloads = useMemo(
    () => sortDownloadsByAddedAt(downloads.filter(item => downloadGroup(item) === 'completed'), 'desc'),
    [downloads]
  );

  const performSearch = async () => {
    const query = searchQuery.trim();
    if (!query || isSearching) return;

    const requestId = ++searchRequestRef.current;
    setIsSearching(true);
    setSearchError(null);
    try {
      const results = await searchC411Torrents({
        query,
        mediaType: selectedMediaType === 'all' ? undefined : selectedMediaType
      });
      if (searchRequestRef.current !== requestId) return;
      setTorrents(results);
      setHasSearched(true);
    } catch (error: unknown) {
      if (searchRequestRef.current !== requestId) return;
      setTorrents([]);
      setHasSearched(true);
      setSearchError(error instanceof Error ? error.message : 'C411 est momentanément indisponible.');
    } finally {
      if (searchRequestRef.current === requestId) setIsSearching(false);
    }
  };

  const filteredTorrents = useMemo(() => {
    let list = torrents.filter(torrent => matchesLightFilter(`${torrent.name} ${torrent.quality || ''}`, lightFilter));

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
  }, [torrents, selectedQuality, lightFilter, sortBy]);

  const performRemove = async (item: LiveDownloadItem) => {
    const status = String(item.status || '').toLowerCase();
    const wasActive = downloadGroup(item) === 'active';

    const success = await removeDownload(item);
    showToast({
      title: item.movieTitle || item.seriesTitle || item.title,
      action: success
        ? (status === 'waiting' ? 'Attente annulée' : wasActive ? 'Téléchargement annulé' : 'Retiré de la liste')
        : (wasActive ? 'Annulation non confirmée' : 'Retrait non confirmé'),
      posterPath: item.posterPath
    }, success ? 'success' : 'info');
  };

  const handleRemove = (item: LiveDownloadItem) => {
    const isActive = downloadGroup(item) === 'active';
    if (isActive || item.status === 'waiting') {
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

  const handleSendTorrent = async (torrent: C411Torrent) => {
    if (sendInFlightRef.current) return;

    const route = planC411ManualDownload(torrent, {
      qbittorrentConfigured: Boolean(config.qbittorrentUrl),
      sonarrConfigured: Boolean(config.sonarrUrl && config.sonarrApiKey),
      radarrConfigured: Boolean(config.radarrUrl && config.radarrApiKey)
    });

    if (route.kind === 'blocked') {
      showToast(route.message, 'error');
      return;
    }

    sendInFlightRef.current = true;
    setSendingTorrentId(torrent.id);

    if (route.kind === 'magnet') {
      try {
        const opened = await openC411Magnet(torrent.magnetUri);
        showToast(
          opened
            ? 'Ouverture du client BitTorrent local…'
            : 'Associe la release à une fiche SeenIt exacte ou configure qBittorrent.',
          opened ? 'info' : 'error'
        );
      } finally {
        sendInFlightRef.current = false;
        setSendingTorrentId(null);
      }
      return;
    }

    const requestId = beginDownloadRequest({
      title: torrent.name,
      mediaType: route.mediaType,
      downloadClient: 'qBittorrent',
      statusText: 'Téléchargement manuel qBittorrent • hors import automatique',
      releaseTitle: torrent.name
    });
    showToast('Envoi à qBittorrent…', 'download');

    try {
      const result = await pushReleaseDirectly({
        service: 'qbittorrent',
        url: config.qbittorrentUrl,
        username: config.qbittorrentUsername,
        password: config.qbittorrentPassword,
        torrent,
        mediaType: route.mediaType,
        qbittorrentCategory: route.qbittorrentCategory
      });

      if (result.success) {
        acceptDownloadRequest(
          requestId,
          'Téléchargement manuel lancé • import Plex automatique non associé',
          'queued'
        );
        showToast('Téléchargement manuel lancé dans qBittorrent.', 'success');
      } else {
        failDownloadRequest(requestId, result.message);
        showToast(result.message, 'error');
      }
    } catch (error: unknown) {
      const message = error instanceof Error && error.message
        ? error.message
        : "Erreur lors de l'envoi au client.";
      failDownloadRequest(requestId, message);
      showToast(message, 'error');
    } finally {
      sendInFlightRef.current = false;
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
      <div ref={screenRootRef} className="flex-1 min-h-0 flex flex-col bg-premium-ambient text-white overflow-hidden">
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
    clearSection?: 'completed' | 'cancelled' | 'error'
  ) => (
    <section className={`downloads-section${title === 'À traiter' ? ' downloads-section--attention' : ''}`}>
      <div className="flex items-center justify-between px-0.5">
        <h2>{title} · {items.length}</h2>
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
        const isActive = downloadGroup(item) === 'active' || downloadGroup(item) === 'waiting';

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
            <DownloadItemCard item={item} onShowClick={onShowClick} onRemove={() => handleRemove(item)} />
          </SwipeableCard>
        );
      })}
    </section>
  );

  return (
    <div ref={screenRootRef} className="downloads-page flex-1 min-h-0 flex flex-col text-white overflow-hidden">
      <div className="shrink-0 px-4 pt-4 pb-3 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-black tracking-tight">Téléchargements</h1>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
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

        <div className="downloads-segments" role="tablist" aria-label="Téléchargements">
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'downloads'}
            onClick={() => setViewMode('downloads')}
            className={`py-2 rounded-lg text-xs font-bold ${viewMode === 'downloads' ? 'bg-zinc-700 text-white' : 'text-zinc-400'}`}
          >
            Mes téléchargements
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'search'}
            onClick={() => setViewMode('search')}
            className={`py-2 rounded-lg text-xs font-bold ${viewMode === 'search' ? 'bg-zinc-700 text-white' : 'text-zinc-400'}`}
          >
            Recherche C411
          </button>
        </div>
      </div>

      <div className="downloads-content flex-1 overflow-y-auto px-4 py-3.5">
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

            {errorDownloads.length > 0 && renderSection('À traiter', errorDownloads, 'error')}
            {activeDownloads.length > 0 && renderSection('En cours', activeDownloads)}
            {waitingDownloads.length > 0 && renderSection('En attente de disponibilité', waitingDownloads)}
            {completedDownloads.length > 0 && renderSection('Terminés', completedDownloads, 'completed')}
            {cancelledDownloads.length > 0 && renderSection('Annulés', cancelledDownloads, 'cancelled')}

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
                  data-navigation-search
                  aria-label="Rechercher une release C411"
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

            <p className="text-[10px] leading-relaxed text-zinc-500">
              Recherche globale : téléchargement manuel qBittorrent, sans import automatique Radarr/Sonarr/Plex.
              Pour l’import automatique, lance la release depuis la fiche SeenIt du média.
            </p>

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

            <ReleaseLightFilter value={lightFilter} onChange={setLightFilter} />
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
                {filteredTorrents.map(torrent => {
                  const c411MediaType = resolveC411ManualMediaType(torrent);
                  const mediaTypeLabel = getC411ManualMediaTypeLabel(c411MediaType);
                  const manualRoute = planC411ManualDownload(torrent, {
                    qbittorrentConfigured: Boolean(config.qbittorrentUrl),
                    sonarrConfigured: Boolean(config.sonarrUrl && config.sonarrApiKey),
                    radarrConfigured: Boolean(config.radarrUrl && config.radarrApiKey)
                  });
                  const actionLabel = manualRoute.kind === 'qbittorrent'
                    ? 'Télécharger'
                    : manualRoute.kind === 'magnet'
                      ? 'Ouvrir Magnet'
                      : 'Indisponible';

                  return (
                    <div key={torrent.id} className="rounded-2xl bg-zinc-900/85 border border-white/10 p-3.5 space-y-2.5">
                      <h3 className="text-xs font-bold text-white break-words leading-snug">{torrent.name}</h3>
                      <div className="flex flex-wrap items-center gap-2 text-[10px] text-zinc-400">
                        {mediaTypeLabel && (
                          <span className="inline-flex items-center gap-1 font-bold text-[#E5A93D]">
                            {c411MediaType === 'tv' ? <Tv size={11} /> : <Film size={11} />}
                            {mediaTypeLabel}
                          </span>
                        )}
                        {torrent.quality && <span className="font-bold text-blue-300">{torrent.quality}</span>}
                        {torrent.language && <span>{torrent.language}</span>}
                        <span>{formatTorrentSize(torrent.size)}</span>
                        <span className="text-emerald-400 font-bold">↑ {torrent.seeders || 0}</span>
                        <span>↓ {torrent.leechers || 0}</span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={sendingTorrentId !== null}
                          onClick={() => void handleSendTorrent(torrent)}
                          className="flex-1 min-h-11 rounded-xl bg-[#E5A93D] hover:bg-[#f0b84c] text-black text-xs font-black flex items-center justify-center gap-1.5 disabled:opacity-50"
                        >
                          {sendingTorrentId === torrent.id ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                          {actionLabel}
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
                  );
                })}
              </div>
            ) : searchError ? (
              <div role="alert" className="py-10 space-y-3 text-center text-sm text-zinc-300"><p>{searchError}</p><button type="button" onClick={() => void performSearch()} className="min-h-11 px-4 rounded-xl border border-white/15">Réessayer</button></div>
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
        <DialogLayer onDismiss={() => setPendingCancellation(null)} label="Annuler le téléchargement" historyMode="local" role="alertdialog"
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/75 p-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-[max(16px,env(safe-area-inset-top))]"

          onMouseDown={event => {
            if (event.target === event.currentTarget) setPendingCancellation(null);
          }}
        >
          <div


            aria-labelledby="cancel-download-title"
            aria-describedby="cancel-download-description"
            className="w-full max-w-sm max-h-full overflow-y-auto rounded-3xl border border-white/10 bg-zinc-950 p-5 shadow-2xl"
            onKeyDown={event => {
              if (event.key === 'Escape') setPendingCancellation(null);
            }}
          >
            <h2 id="cancel-download-title" className="text-lg font-black text-white">{pendingCancellation.status === 'waiting' ? 'Annuler l’attente ?' : 'Annuler le téléchargement ?'}</h2>
            <p id="cancel-download-description" className="mt-2 text-sm leading-relaxed text-zinc-300">
              « {pendingCancellation.movieTitle || pendingCancellation.seriesTitle || pendingCancellation.title} » {pendingCancellation.status === 'waiting' ? 'ne sera plus surveillé pour un téléchargement futur. Les fichiers existants seront conservés.' : `sera retiré de ${pendingCancellation.downloadClient || 'son client distant'}.`}
              {String(pendingCancellation.downloadClient || '').toLowerCase().includes('qbittorrent') && ' Les fichiers déjà téléchargés seront conservés.'}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPendingCancellation(null)}
                data-dialog-initial-focus
                className="min-h-11 rounded-xl border border-white/10 bg-zinc-900 px-4 text-sm font-bold text-zinc-200"
              >
                Garder
              </button>
              <button
                type="button"
                onClick={() => {
                  const item = pendingCancellation;
                  setPendingCancellation(null);
                  void performRemove(item);
                }}
                className="min-h-11 rounded-xl bg-red-500 px-4 text-sm font-black text-white"
              >
                {pendingCancellation.status === 'waiting' ? 'Annuler l’attente' : 'Annuler le téléchargement'}
              </button>
            </div>
          </div>
        </DialogLayer>
      )}
    </div>
  );
}
