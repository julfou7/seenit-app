import { DialogLayer } from '../components/ui/DialogLayer';
import { DownloadItemCard } from '../components/DownloadItemCard';
import { SeasonDownloadCard } from '../components/SeasonDownloadCard';
import { ProgrammedSection } from '../components/ProgrammedSection';
import { RecentImportsRail, useRecentImports, useUndecidedTitles } from '../components/RecentImportsRail';
import { coveredByRecentImport } from '../features/downloads/recentImports';
import { groupSeasonDownloads } from '../features/downloads/downloadSeriesGroups';
import { downloadGroup, isPreTransferRequest, isWatchedWaitingRequest } from '../features/downloads/downloadGroups';
import { describeReleases, matchesVersionFilter, releaseAgeLabel, type VersionFilter } from '../features/downloads/releaseVersions';
import { ReleaseVersionCard, VersionFilterChips } from '../components/ReleaseVersionCard';
import './downloads.css';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ChevronLeft,
  Check,
  Copy,
  Loader2,
  Search,
  Settings,
  Trash2,
  X
} from 'lucide-react';
import { DownloadMark } from '../components/SeenItLogo';
import { useLiveDownloadStore } from '../store/liveDownloadStore';
import { useDownloadConfigStore } from '../store/downloadConfigStore';
import {
  type LiveDownloadItem,
  pushReleaseDirectly
} from '../services/sonarrRadarr';
import { type C411Torrent, openC411Magnet, searchC411Torrents } from '../services/c411';
import { useToastStore } from '../store/toastStore';
import { DownloadConfigSection } from '../components/DownloadConfigSection';
import { ActionSwipeCard } from '../components/cards/ActionSwipeCard';
import { planC411ManualDownload, resolveC411ManualMediaType } from '../features/downloads/c411ManualRouting';
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

export function DownloadsScreen({ onShowClick, navigationShortcut }: Props) {
  const {
    downloads,
    removeDownload,
    clearAllDownloads
  } = useLiveDownloadStore();
  const config = useDownloadConfigStore();
  const showToast = useToastStore(state => state.showToast);
  const screenRootRef = useRef<HTMLDivElement>(null);
  const searchRequestRef = useRef(0);
  const sendInFlightRef = useRef(false);

  const [viewMode, setViewMode] = useState<ViewMode>('downloads');
  const [programmedRefresh, setProgrammedRefresh] = useState(0);
  useTabShortcut(navigationShortcut, () => {
    setViewMode('search');
    const frame = requestAnimationFrame(() => screenRootRef.current?.querySelector<HTMLInputElement>('[data-navigation-search]')?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  });
  const [showConfiguration, setShowConfiguration] = useState(false);
  const openSearch = () => {
    setViewMode('search');
    requestAnimationFrame(() => screenRootRef.current?.querySelector<HTMLInputElement>('[data-navigation-search]')?.focus({ preventScroll: true }));
  };
  const [clearingSection, setClearingSection] = useState<'completed' | 'cancelled' | 'error' | null>(null);
  const [pendingCancellation, setPendingCancellation] = useState<LiveDownloadItem | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  // Recherche avancée (refonte du 07/11, même langage que « Version précise ») : un champ, une rangée de
  // filtres, la conseillée en tête et dépliée ; plus de type, de qualité, de Light ni de tri séparés.
  const [versionFilter, setVersionFilter] = useState<VersionFilter>('Toutes');
  const [openVersion, setOpenVersion] = useState<number | null>(null);
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
      setVersionFilter('Toutes');
      setOpenVersion(null);
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

  // Retours terrain du 08/11 : une demande apparaît tout de suite dans « En attente » (« Recherche en cours… ») ;
  // sans version disponible et surveillée, elle passe dans « Programmés » ; « En cours » ne garde que les
  // transferts réels et « À régler » les échecs et les attentes dont la surveillance n'est pas confirmée.
  const activeDownloads = useMemo(
    () => sortDownloadsByAddedAt(
      downloads.filter(item => downloadGroup(item) === 'active' && !isPreTransferRequest(item)),
      'asc'
    ),
    [downloads]
  );
  const errorDownloads = useMemo(
    () => sortDownloadsByAddedAt(downloads.filter(item => downloadGroup(item) === 'attention' || (downloadGroup(item) === 'waiting' && !isWatchedWaitingRequest(item))), 'desc'),
    [downloads]
  );
  const waitingDownloads = useMemo(() => sortDownloadsByAddedAt(downloads.filter(item => downloadGroup(item) === 'active' && isPreTransferRequest(item)), 'asc'), [downloads]);
  const watchedRequests = useMemo(() => sortDownloadsByAddedAt(downloads.filter(isWatchedWaitingRequest), 'asc'), [downloads]);
  const cancelledDownloads = useMemo(
    () => sortDownloadsByAddedAt(downloads.filter(item => downloadGroup(item) === 'cancelled'), 'desc'),
    [downloads]
  );
  const completedDownloads = useMemo(
    () => sortDownloadsByAddedAt(downloads.filter(item => downloadGroup(item) === 'completed'), 'desc'),
    [downloads]
  );
  // Maquette DlOngletSuivi : « Téléchargés » montre les imports réels des 7 derniers jours ; un téléchargement
  // terminé déjà présent dans cette rangée (TMDB et épisode exacts) n'est pas répété dans « Terminés ».
  const recentImports = useRecentImports(programmedRefresh);
  const undecidedTitles = useUndecidedTitles();
  const listedCompleted = useMemo(
    () => recentImports.loaded ? completedDownloads.filter(item => !coveredByRecentImport(recentImports.items, item)) : [],
    [completedDownloads, recentImports]
  );
  // Sans bouton Actualiser (maquette : deux boutons ronds tiennent en 360 px) : Programmés et Téléchargés
  // se rechargent quand un téléchargement change d'état et quand l'app revient au premier plan.
  // Revue de #907 : annuler une attente surveillée retire sa surveillance ; Programmés est rechargé pour ne pas
  // laisser réapparaître l'entrée du calendrier qu'elle masquait.
  const transitions = `${activeDownloads.length}:${completedDownloads.length}:${errorDownloads.length}:${watchedRequests.map(item => item.id).join(',')}`;
  const lastTransitions = useRef(transitions);
  useEffect(() => {
    if (lastTransitions.current === transitions) return;
    lastTransitions.current = transitions;
    setProgrammedRefresh(key => key + 1);
  }, [transitions]);
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') setProgrammedRefresh(key => key + 1); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);
  const subtitle = [activeDownloads.length ? `${activeDownloads.length} en cours` : '', waitingDownloads.length ? `${waitingDownloads.length} en attente` : '', errorDownloads.length ? `${errorDownloads.length} à régler` : ''].filter(Boolean).join(' · ') || 'Rien en cours';

  const performSearch = async () => {
    const query = searchQuery.trim();
    if (!query || isSearching) return;

    const requestId = ++searchRequestRef.current;
    setIsSearching(true);
    setSearchError(null);
    try {
      const results = await searchC411Torrents({ query });
      if (searchRequestRef.current !== requestId) return;
      setTorrents(results);
      setVersionFilter('Toutes');
      setOpenVersion(describeReleases(results)[0]?.release.id ?? null);
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

  const versions = useMemo(() => describeReleases(torrents), [torrents]);
  const visibleVersions = versions.filter(entry => matchesVersionFilter(entry, versionFilter));

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
    clearSection?: 'completed' | 'cancelled' | 'error',
    groupSeasons = false
  ) => (
    <section className={`downloads-section${title === 'À régler' ? ' downloads-section--attention' : ''}`}>
      <div className="flex items-center justify-between px-0.5">
        <h2>{title}</h2>
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
      {(groupSeasons ? groupSeasonDownloads(items) : items.map(item => ({ kind: 'single' as const, item }))).map(entry => {
        // #879 — plusieurs épisodes d'une même saison : une seule carte, ✕ par épisode (pas de balayage global).
        if (entry.kind === 'season') return <SeasonDownloadCard key={entry.key} seasonNumber={entry.seasonNumber} items={entry.items} onShowClick={onShowClick} onRemove={handleRemove} />;
        const { item } = entry;
        const isActive = downloadGroup(item) === 'active' || downloadGroup(item) === 'waiting';

        return (
          // Retour terrain du 09/11 : le geste de l'accueil (carte décalée, tuile, ✕) au lieu du fond rouge plein.
          <ActionSwipeCard
            key={getStableDownloadRenderKey(item)}
            className="download-swipe"
            actions={[{ label: isActive ? 'Annuler' : 'Retirer', ariaLabel: `${isActive ? 'Annuler le téléchargement de' : 'Retirer'} ${item.movieTitle || item.seriesTitle || item.title}`, icon: <Trash2 size={18} />, tone: 'rose', onSelect: () => handleRemove(item) }]}
          >
            <DownloadItemCard item={item} onShowClick={onShowClick} onRemove={() => handleRemove(item)} />
          </ActionSwipeCard>
        );
      })}
    </section>
  );

  return (
    <div ref={screenRootRef} className="downloads-page flex-1 min-h-0 flex flex-col text-white overflow-hidden">
      {viewMode === 'search'
        ? <header className="downloads-header downloads-header--search">
          <button type="button" onClick={() => setViewMode('downloads')} aria-label="Retour aux téléchargements" className="downloads-header__back"><ChevronLeft size={26} /></button>
          <div className="min-w-0">
            <h1>Recherche avancée</h1>
            <p className="downloads-subtitle">Toutes les versions trouvées sur C411</p>
          </div>
        </header>
        : <header className="downloads-header">
          <div className="downloads-header__row">
            <h1>Téléchargements</h1>
            <div className="downloads-header__actions">
              <button type="button" onClick={openSearch} title="Recherche avancée" aria-label="Recherche avancée"><Search size={18} /></button>
              <button type="button" onClick={() => setShowConfiguration(true)} title="Réglages" aria-label="Ouvrir les réglages de téléchargement"><Settings size={18} /></button>
            </div>
          </div>
          <p className="downloads-subtitle">{subtitle}</p>
        </header>}

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

            {errorDownloads.length > 0 && renderSection('À régler', errorDownloads)}
            {activeDownloads.length > 0 && renderSection('En cours', activeDownloads, undefined, true)}
            {waitingDownloads.length > 0 && renderSection('En attente', waitingDownloads)}
            {/* #879 : ce que Sonarr/Radarr récupéreront à la sortie (calendrier), déprogrammable. */}
            {isConfigured && <ProgrammedSection refreshKey={programmedRefresh} onShowClick={onShowClick} watching={watchedRequests} onRemoveWatching={handleRemove} />}
            <RecentImportsRail items={recentImports.items} failures={recentImports.failures} onShowClick={onShowClick} />
            {/* SEENIT-DOWNLOAD-023 : ni téléchargés ni programmés — aucun titre de Sonarr/Radarr invisible. */}
            <RecentImportsRail variant="undecided" items={undecidedTitles} failures={[]} onShowClick={onShowClick} />
            {listedCompleted.length > 0 && renderSection('Terminés', listedCompleted, 'completed')}
            {cancelledDownloads.length > 0 && renderSection('Annulés', cancelledDownloads, 'cancelled')}

            {!downloads.length && !recentImports.items.length && !undecidedTitles.length && (
              <div className="py-16 flex flex-col items-center text-center gap-3 text-zinc-500">
                <div className="w-14 h-14 rounded-2xl bg-zinc-900 border border-white/5 flex items-center justify-center">
                  <DownloadMark size={26} />
                </div>
                <div>
                  <p className="text-sm font-bold text-zinc-300">Aucun téléchargement suivi</p>
                  <p className="text-[11px] mt-1 max-w-[270px]">Depuis une fiche, choisis 1080p ou 4K : la demande apparaîtra ici immédiatement.</p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="downloads-search">
            <form
              role="search"
              onSubmit={event => {
                event.preventDefault();
                void performSearch();
              }}
              className="downloads-search__form"
            >
              <span className="downloads-search__field">
                <Search size={18} aria-hidden="true" />
                <input
                  value={searchQuery}
                  onChange={event => setSearchQuery(event.target.value)}
                  placeholder="Titre, ou titre S02E05"
                  data-navigation-search
                  enterKeyHint="search"
                  aria-label="Rechercher une release C411"
                />
                {searchQuery && <button type="button" onClick={() => setSearchQuery('')} aria-label="Effacer la recherche"><X size={16} /></button>}
              </span>
              <button type="submit" disabled={isSearching || !searchQuery.trim()} aria-label="Chercher" className="downloads-search__go">
                {isSearching ? <Loader2 size={20} className="animate-spin" /> : <Search size={20} />}
              </button>
            </form>

            {versions.length > 0 && !isSearching && <VersionFilterChips value={versionFilter} onChange={label => { setVersionFilter(label); setOpenVersion(null); }} />}

            {isSearching ? (
              <p role="status" className="downloads-search__note"><Loader2 size={18} className="animate-spin text-[#E5A93D]" />Recherche des versions…</p>
            ) : searchError ? (
              <div role="alert" className="downloads-search__error"><p>{searchError}</p><button type="button" onClick={() => void performSearch()}>Réessayer</button></div>
            ) : visibleVersions.length > 0 ? (
              <div className="flex flex-col gap-2.5">
                {visibleVersions.map(entry => {
                  const torrent = entry.release;
                  const isOpen = openVersion === torrent.id;
                  const manualRoute = planC411ManualDownload(torrent, {
                    qbittorrentConfigured: Boolean(config.qbittorrentUrl),
                    sonarrConfigured: Boolean(config.sonarrUrl && config.sonarrApiKey),
                    radarrConfigured: Boolean(config.radarrUrl && config.radarrApiKey)
                  });
                  const actionLabel = manualRoute.kind === 'qbittorrent' ? 'Télécharger' : manualRoute.kind === 'magnet' ? 'Ouvrir Magnet' : 'Indisponible';
                  const kind = resolveC411ManualMediaType(torrent);
                  return (
                    <ReleaseVersionCard key={torrent.id} entry={entry} open={isOpen} technical onToggle={() => setOpenVersion(isOpen ? null : torrent.id)}
                      details={[kind === 'movie' ? 'Film' : kind === 'tv' ? 'Série' : '', releaseAgeLabel(entry.ageDays)].filter(Boolean).join(' · ')}>
                      <div className="flex gap-2 mt-1">
                        <button type="button" disabled={sendingTorrentId !== null || manualRoute.kind === 'blocked'} onClick={() => void handleSendTorrent(torrent)}
                          className="flex-1 h-12 rounded-[14px] bg-[#E5A93D] text-black text-[15px] font-extrabold flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-60">
                          {sendingTorrentId === torrent.id ? <Loader2 size={18} className="animate-spin" /> : <DownloadMark size={20} />}{actionLabel}
                        </button>
                        <button type="button" onClick={() => void copyMagnet(torrent)} aria-label="Copier le lien Magnet"
                          className="h-12 shrink-0 px-4 rounded-[14px] text-[14.5px] font-bold text-zinc-200 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)] flex items-center gap-1.5">
                          {copiedHash === torrent.infoHash ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}Magnet
                        </button>
                      </div>
                    </ReleaseVersionCard>
                  );
                })}
              </div>
            ) : hasSearched ? (
              <p className="downloads-search__note">{versions.length ? 'Aucune version pour ce filtre.' : 'Aucune version trouvée sous ce nom.'}</p>
            ) : (
              <p className="downloads-search__hint">Cherche un film ou une série, avec l’épisode si besoin (« The Bear S03E02 ») : toutes les versions s’affichent ici, la conseillée en tête.</p>
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
