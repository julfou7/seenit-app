import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  HardDrive,
  Layers,
  Loader2,
  PlaySquare,
  Radio,
  Search,
  Tv,
  X
} from 'lucide-react';
import { type C411Torrent, formatTorrentSize, openC411Magnet, searchC411Torrents } from '../services/c411';
import { useDownloadConfigStore } from '../store/downloadConfigStore';
import { useLiveDownloadStore } from '../store/liveDownloadStore';
import { useToastStore } from '../store/toastStore';
import { LiveDownloadBanner } from './LiveDownloadBanner';
import {
  fetchQualityProfiles,
  pushReleaseDirectly,
  searchAndDownloadInRadarr,
  searchAndDownloadInSonarr
} from '../services/sonarrRadarr';
import { tmdb } from '../features/shows/tmdb';
import {
  acceptDownloadRequest,
  beginDownloadRequest,
  failDownloadRequest,
  updateDownloadRequest
} from '../features/downloads/downloadLifecycle';
import { resolveEffectiveQualityProfileId } from '../features/downloads/qualityProfileSelection';
import { downloadEpisodeWithSeasonPackFallback } from '../features/downloads/episodeSeasonPackFallback';

export interface SeasonInfo {
  season_number: number;
  episode_count: number;
  name?: string;
}

export interface DownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  originalTitle?: string;
  year?: string | number;
  mediaType: 'movie' | 'tv';
  tmdbId?: number | string;
  tvdbId?: number | string;
  imdbId?: string;
  posterPath?: string;
  initialSeason?: number;
  initialEpisode?: number;
  totalSeasons?: number;
  seasonsData?: SeasonInfo[];
  onSuccessToast?: (msg: string) => void;
}

type ScopeMode = 'all' | 'season' | 'episode';

type DownloadActionResult = {
  success: boolean;
  message: string;
  status?: 'searching' | 'queued';
  fallbackUsed?: boolean;
  downloadId?: string;
};

export function DownloadModal({
  isOpen,
  onClose,
  title,
  year,
  mediaType,
  tmdbId,
  tvdbId,
  imdbId,
  posterPath,
  initialSeason,
  initialEpisode,
  totalSeasons = 1,
  seasonsData,
  onSuccessToast
}: DownloadModalProps) {
  const isTv = mediaType === 'tv';
  const config = useDownloadConfigStore();
  const showToast = useToastStore(state => state.showToast);
  const downloads = useLiveDownloadStore(state => state.downloads);

  const [scopeMode, setScopeMode] = useState<ScopeMode>('all');
  const [selectedSeason, setSelectedSeason] = useState(1);
  const [selectedEpisode, setSelectedEpisode] = useState(1);
  const [availableSeasons, setAvailableSeasons] = useState<SeasonInfo[]>([]);
  const [isSeasonPickerOpen, setIsSeasonPickerOpen] = useState(false);
  const [isEpisodePickerOpen, setIsEpisodePickerOpen] = useState(false);

  const [isTriggeringAuto, setIsTriggeringAuto] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  const [manualOpen, setManualOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [torrents, setTorrents] = useState<C411Torrent[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedQuality, setSelectedQuality] = useState<'all' | '2160p' | '1080p' | '720p'>('all');
  const [sortBy, setSortBy] = useState<'seeders' | 'size' | 'date'>('seeders');
  const [sendingTorrentId, setSendingTorrentId] = useState<number | null>(null);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const getGeneratedQuery = (mode: ScopeMode, season: number, episode: number) => {
    const base = title.trim();
    if (mediaType === 'movie') return year ? `${base} ${year}` : base;
    if (mode === 'episode') {
      return `${base} S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
    }
    if (mode === 'season') {
      return `${base} S${String(season).padStart(2, '0')}`;
    }
    return base;
  };

  useEffect(() => {
    if (!isOpen) return;

    const initialMode: ScopeMode = initialEpisode && initialSeason
      ? 'episode'
      : initialSeason
        ? 'season'
        : 'all';
    const season = initialSeason || 1;
    const episode = initialEpisode || 1;

    setScopeMode(initialMode);
    setSelectedSeason(season);
    setSelectedEpisode(episode);
    setSearchQuery(getGeneratedQuery(initialMode, season, episode));
    setActionMessage(null);
    setManualOpen(false);
    setTorrents([]);
    setHasSearched(false);
    setIsTriggeringAuto(false);
  }, [isOpen, title, year, initialSeason, initialEpisode]);

  useEffect(() => {
    if (!isOpen) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => dialogRef.current?.focus(), 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      onCloseRef.current();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || mediaType !== 'tv') return;

    if (seasonsData?.length) {
      setAvailableSeasons(seasonsData.filter(season => season.season_number > 0));
      return;
    }

    if (!tmdbId) {
      setAvailableSeasons(
        Array.from({ length: Math.max(totalSeasons, 1) }, (_, index) => ({
          season_number: index + 1,
          episode_count: 24,
          name: `Saison ${index + 1}`
        }))
      );
      return;
    }

    tmdb.getShowDetails(Number(tmdbId)).then(result => {
      if (result.ok && result.value && Array.isArray(result.value.seasons)) {
        const seasons = result.value.seasons
          .filter((season: any) => season.season_number > 0)
          .map((season: any) => ({
            season_number: season.season_number,
            episode_count: season.episode_count || 1,
            name: season.name || `Saison ${season.season_number}`
          }));
        if (seasons.length) {
          setAvailableSeasons(seasons);
          return;
        }
      }

      setAvailableSeasons(
        Array.from({ length: Math.max(totalSeasons, 1) }, (_, index) => ({
          season_number: index + 1,
          episode_count: 24,
          name: `Saison ${index + 1}`
        }))
      );
    }).catch(() => {
      setAvailableSeasons(
        Array.from({ length: Math.max(totalSeasons, 1) }, (_, index) => ({
          season_number: index + 1,
          episode_count: 24,
          name: `Saison ${index + 1}`
        }))
      );
    });
  }, [isOpen, mediaType, tmdbId, seasonsData, totalSeasons]);

  const currentSeason = useMemo(
    () => availableSeasons.find(season => season.season_number === selectedSeason)
      || availableSeasons[0]
      || { season_number: selectedSeason, episode_count: 24, name: `Saison ${selectedSeason}` },
    [availableSeasons, selectedSeason]
  );

  const maxEpisodes = Math.max(currentSeason.episode_count || 1, 1);

  const activeDownloads = useMemo(() => {
    if (mediaType === 'tv') {
      return useLiveDownloadStore.getState().getShowDownloads(tmdbId, undefined, title);
    }
    const movie = useLiveDownloadStore.getState().getMovieDownload(tmdbId, title);
    return movie ? [movie] : [];
  }, [downloads, mediaType, tmdbId, title]);

  const hasAutomationClient = mediaType === 'tv'
    ? Boolean(config.sonarrUrl && config.sonarrApiKey)
    : Boolean(config.radarrUrl && config.radarrApiKey);

  const automationClientName = mediaType === 'tv' ? 'Sonarr' : 'Radarr';

  const showMediaDownloadToast = (action: string, toastType: 'download' | 'success' | 'error' | 'info' = 'download') => {
    const subtitle = mediaType === 'tv'
      ? scopeMode === 'episode'
        ? `S${String(selectedSeason).padStart(2, '0')}E${String(selectedEpisode).padStart(2, '0')}`
        : scopeMode === 'season'
          ? `Saison ${selectedSeason}`
          : undefined
      : undefined;
    showToast({ title, subtitle, action, posterPath }, toastType);
  };

  const handleScopeChange = (mode: ScopeMode, season = selectedSeason, episode = selectedEpisode) => {
    const targetSeason = availableSeasons.find(item => item.season_number === season);
    const episodeMax = Math.max(targetSeason?.episode_count || 24, 1);
    const adjustedEpisode = Math.min(episode, episodeMax);

    setScopeMode(mode);
    setSelectedSeason(season);
    setSelectedEpisode(adjustedEpisode);
    setSearchQuery(getGeneratedQuery(mode, season, adjustedEpisode));
    setTorrents([]);
    setHasSearched(false);
  };

  const handleAutoSearchClient = async (qualityPreference: '1080p' | '4k') => {
    if (isTriggeringAuto) return;

    const isTv = mediaType === 'tv';
    const client = isTv ? 'Sonarr' : 'Radarr';
    const hasClient = isTv
      ? Boolean(config.sonarrUrl && config.sonarrApiKey)
      : Boolean(config.radarrUrl && config.radarrApiKey);

    if (!hasClient) {
      const message = `${client} n'est pas configuré pour ce média.`;
      setActionMessage({ text: message, type: 'error' });
      showMediaDownloadToast(message, 'error');
      return;
    }

    setIsTriggeringAuto(true);
    setActionMessage(null);

    const qualityLabel = qualityPreference === '4k' ? '4K' : '1080p';
    const targetLabel = isTv
      ? scopeMode === 'all'
        ? 'Toute la série'
        : scopeMode === 'season'
          ? `Saison ${selectedSeason}`
          : `S${String(selectedSeason).padStart(2, '0')}E${String(selectedEpisode).padStart(2, '0')}`
      : 'Film';
    const displayTitle = isTv ? `${title} (${targetLabel})` : title;

    const requestId = beginDownloadRequest({
      title: displayTitle,
      seriesTitle: isTv ? title : undefined,
      movieTitle: !isTv ? title : undefined,
      mediaType,
      tmdbId,
      tvdbId,
      imdbId,
      seasonNumber: isTv && scopeMode !== 'all' ? selectedSeason : undefined,
      episodeNumber: isTv && scopeMode === 'episode' ? selectedEpisode : undefined,
      posterPath,
      downloadClient: client,
      statusText: 'Demande prise en compte • préparation du téléchargement…',
      releaseTitle: `${displayTitle} • ${qualityLabel}`
    });

    showMediaDownloadToast(`Recherche ${qualityLabel} en cours…`, 'download');
    onClose();

    try {
      let verifiedTvdbId = tvdbId;
      let verifiedImdbId = imdbId;
      if (isTv && tmdbId && !verifiedTvdbId && !verifiedImdbId) {
        const identityResult = await tmdb.getShowDetails(Number(tmdbId));
        if (identityResult.ok) {
          verifiedTvdbId = identityResult.value?.external_ids?.tvdb_id || undefined;
          verifiedImdbId = identityResult.value?.external_ids?.imdb_id || undefined;
        }
      }

      const configuredProfileId = isTv
        ? (qualityPreference === '4k' ? config.sonarr4kProfileId : config.sonarr1080pProfileId)
        : (qualityPreference === '4k' ? config.radarr4kProfileId : config.radarr1080pProfileId);
      const clientUrl = isTv ? config.sonarrUrl : config.radarrUrl;
      const clientApiKey = isTv ? config.sonarrApiKey : config.radarrApiKey;

      let effectiveProfileId = configuredProfileId ?? undefined;
      if (!effectiveProfileId) {
        const profiles = await fetchQualityProfiles(isTv ? 'sonarr' : 'radarr', clientUrl, clientApiKey);
        effectiveProfileId = resolveEffectiveQualityProfileId(profiles, qualityPreference);
        if (!effectiveProfileId) {
          throw new Error(`Aucun profil ${qualityLabel} compatible n’est disponible dans ${client}.`);
        }
      }

      const result: DownloadActionResult = isTv
        ? scopeMode === 'episode'
          ? await downloadEpisodeWithSeasonPackFallback({
              url: config.sonarrUrl,
              apiKey: config.sonarrApiKey,
              title,
              tmdbId,
              tvdbId: verifiedTvdbId,
              imdbId: verifiedImdbId,
              season: selectedSeason,
              episode: selectedEpisode,
              qualityPreference,
              qualityProfileId: effectiveProfileId,
              qbittorrentUrl: config.qbittorrentUrl,
              qbittorrentUsername: config.qbittorrentUsername,
              qbittorrentPassword: config.qbittorrentPassword
            })
          : await searchAndDownloadInSonarr({
              url: config.sonarrUrl,
              apiKey: config.sonarrApiKey,
              title,
              tmdbId,
              tvdbId: verifiedTvdbId,
              imdbId: verifiedImdbId,
              season: scopeMode === 'all' ? undefined : selectedSeason,
              qualityPreference,
              qualityProfileId: effectiveProfileId
            })
        : await searchAndDownloadInRadarr({
            url: config.radarrUrl,
            apiKey: config.radarrApiKey,
            title,
            tmdbId,
            year,
            qualityPreference,
            qualityProfileId: effectiveProfileId
          });

      if (result.success) {
        const nextStatus = result.status || 'searching';
        const statusText = result.message || `Demande acceptée • recherche ${qualityLabel} en cours`;
        acceptDownloadRequest(requestId, statusText, nextStatus);

        if (result.downloadId) {
          updateDownloadRequest(requestId, {
            downloadId: result.downloadId,
            downloadIdAliases: [result.downloadId],
            statusText
          });
        }

        if (result.fallbackUsed) {
          showMediaDownloadToast(statusText, 'download');
        }
      } else {
        failDownloadRequest(requestId, result.message);
        showMediaDownloadToast(result.message, 'error');
      }
    } catch (error: any) {
      const message = error?.message || `Impossible de joindre ${client}.`;
      failDownloadRequest(requestId, message);
      showMediaDownloadToast(message, 'error');
    } finally {
      setIsTriggeringAuto(false);
    }
  };

  const performSearch = async () => {
    const query = searchQuery.trim();
    if (!query || isSearching) return;

    setIsSearching(true);
    setActionMessage(null);
    try {
      const results = await searchC411Torrents({
        query,
        mediaType,
        year: mediaType === 'movie' ? year : undefined
      });
      setTorrents(results);
      setHasSearched(true);
    } catch (error: any) {
      const message = error?.message || 'C411 est momentanément indisponible.';
      setTorrents([]);
      setHasSearched(true);
      setActionMessage({ text: message, type: 'error' });
      showToast(message, 'error');
    } finally {
      setIsSearching(false);
    }
  };

  const handleCopyMagnet = async (torrent: C411Torrent) => {
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

  const handleSendToClient = async (torrent: C411Torrent) => {
    if (sendingTorrentId) return;

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
        showToast('Aucun client de téléchargement disponible.', 'error');
      }
      return;
    }

    setSendingTorrentId(torrent.id);
    const clientLabel = service === 'sonarr' ? 'Sonarr' : service === 'radarr' ? 'Radarr' : 'qBittorrent';
    const requestId = beginDownloadRequest({
      title,
      seriesTitle: isTv ? title : undefined,
      movieTitle: !isTv ? title : undefined,
      mediaType,
      tmdbId,
      imdbId,
      seasonNumber: mediaType === 'tv' && scopeMode !== 'all' ? selectedSeason : undefined,
      episodeNumber: mediaType === 'tv' && scopeMode === 'episode' ? selectedEpisode : undefined,
      posterPath,
      downloadClient: clientLabel,
      statusText: 'Demande prise en compte • préparation du téléchargement…',
      releaseTitle: torrent.name
    });

    showMediaDownloadToast('Préparation du téléchargement…', 'download');

    try {
      const result = await pushReleaseDirectly({
        service,
        url,
        apiKey,
        username,
        password,
        torrent,
        mediaType,
        mediaInfo: {
          title,
          tmdbId,
          tvdbId,
          imdbId,
          year,
          season: mediaType === 'tv' && scopeMode !== 'all' ? selectedSeason : undefined,
          episode: mediaType === 'tv' && scopeMode === 'episode' ? selectedEpisode : undefined
        }
      });

      if (result.success) {
        acceptDownloadRequest(
          requestId,
          `Téléchargement accepté • mise en file d'attente`,
          'queued'
        );
        const successMessage = 'Téléchargement lancé.';
        setActionMessage({ text: successMessage, type: 'success' });
        if (onSuccessToast) onSuccessToast(successMessage);
        else showMediaDownloadToast(successMessage, 'success');
      } else {
        failDownloadRequest(requestId, result.message);
        setActionMessage({ text: result.message, type: 'error' });
        showMediaDownloadToast(result.message, 'error');
      }
    } catch (error: any) {
      const message = error?.message || "Erreur lors de l'envoi de la release.";
      failDownloadRequest(requestId, message);
      setActionMessage({ text: message, type: 'error' });
      showMediaDownloadToast(message, 'error');
    } finally {
      setSendingTorrentId(null);
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

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-3 pt-10 pb-20 sm:p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-150"
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="download-dialog-title"
        tabIndex={-1}
        className="relative w-full max-w-md max-h-[88vh] overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900 shadow-2xl flex flex-col outline-none"
      >
        <div className="shrink-0 p-4 border-b border-zinc-800 flex items-center gap-3 bg-zinc-900/95">
          {posterPath ? (
            <img
              src={`https://image.tmdb.org/t/p/w185${posterPath}`}
              alt={title}
              className="w-11 h-16 object-cover rounded-xl border border-white/10 bg-zinc-950"
            />
          ) : (
            <div className="w-11 h-11 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
              <Download size={20} />
            </div>
          )}

          <div className="flex-1 min-w-0">
            <h3 id="download-dialog-title" className="font-extrabold text-base text-white truncate">{title}</h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              {mediaType === 'tv' ? 'Série' : 'Film'}{year ? ` • ${year}` : ''}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-11 h-11 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white flex items-center justify-center transition-colors"
            aria-label="Fermer la fenêtre de téléchargement"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5">
          {mediaType === 'tv' && (
            <section className="rounded-2xl border border-white/8 bg-zinc-950/60 p-3 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-black uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                  <Layers size={13} className="text-blue-400" />
                  Cible
                </span>
                <span className="text-[11px] font-bold text-zinc-300">
                  {scopeMode === 'all'
                    ? 'Toute la série'
                    : scopeMode === 'season'
                      ? `Saison ${selectedSeason}`
                      : `S${String(selectedSeason).padStart(2, '0')}E${String(selectedEpisode).padStart(2, '0')}`}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-1 p-1 bg-zinc-900 rounded-xl">
                {[
                  { id: 'all' as ScopeMode, label: 'Série', icon: Tv },
                  { id: 'season' as ScopeMode, label: 'Saison', icon: Layers },
                  { id: 'episode' as ScopeMode, label: 'Épisode', icon: PlaySquare }
                ].map(option => {
                  const Icon = option.icon;
                  const selected = scopeMode === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => handleScopeChange(option.id)}
                      className={`min-h-11 rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition-colors ${
                        selected ? 'bg-[#E5A93D] text-black' : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      <Icon size={12} />
                      {option.label}
                    </button>
                  );
                })}
              </div>

              {scopeMode !== 'all' && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setIsSeasonPickerOpen(true)}
                    className="min-h-11 px-3 rounded-xl bg-zinc-900 border border-zinc-700 text-xs font-bold text-white flex items-center gap-2"
                  >
                    {currentSeason.name || `Saison ${selectedSeason}`}
                    <ChevronDown size={13} className="text-zinc-400" />
                  </button>

                  {scopeMode === 'episode' && (
                    <button
                      type="button"
                      onClick={() => setIsEpisodePickerOpen(true)}
                      className="min-h-11 px-3 rounded-xl bg-zinc-900 border border-zinc-700 text-xs font-bold text-white flex items-center gap-2"
                    >
                      Épisode {selectedEpisode}
                      <ChevronDown size={13} className="text-zinc-400" />
                    </button>
                  )}
                </div>
              )}
            </section>
          )}

          <section className="rounded-2xl border border-white/8 bg-zinc-950/60 p-3.5 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h4 className="text-sm font-extrabold text-white">Téléchargement automatique</h4>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  SeenIt transmet la demande à {automationClientName}, puis suit réellement son état.
                </p>
              </div>
              <span className={`text-[10px] font-bold px-2 py-1 rounded-full border ${
                hasAutomationClient
                  ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20'
                  : 'text-amber-300 bg-amber-500/10 border-amber-500/20'
              }`}>
                {hasAutomationClient ? 'Prêt' : 'À configurer'}
              </span>
            </div>

            {hasAutomationClient ? (
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  disabled={isTriggeringAuto}
                  onClick={() => handleAutoSearchClient('1080p')}
                  className="p-3 rounded-2xl border border-blue-500/25 bg-blue-500/8 hover:bg-blue-500/15 text-left transition-colors disabled:opacity-50"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black text-blue-300">1080p</span>
                    {isTriggeringAuto ? <Loader2 size={14} className="animate-spin text-blue-300" /> : <ChevronRight size={14} className="text-blue-400" />}
                  </div>
                  <p className="text-xs text-zinc-400 mt-1">Préférence HD</p>
                </button>

                <button
                  type="button"
                  disabled={isTriggeringAuto}
                  onClick={() => handleAutoSearchClient('4k')}
                  className="p-3 rounded-2xl border border-amber-500/25 bg-amber-500/8 hover:bg-amber-500/15 text-left transition-colors disabled:opacity-50"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black text-amber-300">4K / 2160p</span>
                    {isTriggeringAuto ? <Loader2 size={14} className="animate-spin text-amber-300" /> : <ChevronRight size={14} className="text-amber-400" />}
                  </div>
                  <p className="text-xs text-zinc-400 mt-1">Préférence Ultra-HD</p>
                </button>
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-200 flex gap-2">
                <AlertCircle size={15} className="shrink-0 mt-0.5" />
                <span>
                  Configure {automationClientName} dans Téléchargements → Réglages pour activer le mode 1-clic.
                </span>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-white/8 bg-zinc-950/60 overflow-hidden">
            <button
              type="button"
              onClick={() => setManualOpen(value => !value)}
              className="w-full p-3.5 flex items-center justify-between text-left"
            >
              <div className="flex items-center gap-2.5">
                <Radio size={16} className="text-zinc-400" />
                <div>
                  <h4 className="text-xs font-extrabold text-white">Choisir une release manuellement</h4>
                  <p className="text-xs text-zinc-500 mt-0.5">Recherche C411 avancée</p>
                </div>
              </div>
              <ChevronDown size={15} className={`text-zinc-500 transition-transform ${manualOpen ? 'rotate-180' : ''}`} />
            </button>

            {manualOpen && (
              <div className="border-t border-zinc-800 p-3 space-y-3">
                <form
                  onSubmit={event => {
                    event.preventDefault();
                    void performSearch();
                  }}
                  className="flex gap-2"
                >
                  <div className="relative flex-1">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                    <input
                      value={searchQuery}
                      onChange={event => setSearchQuery(event.target.value)}
                      className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-zinc-900 border border-zinc-700 text-xs text-white outline-none focus:border-blue-500"
                      placeholder="Titre, S02, S02E05…"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isSearching || !searchQuery.trim()}
                    className="px-3 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold disabled:opacity-50"
                  >
                    {isSearching ? <Loader2 size={15} className="animate-spin" /> : 'Chercher'}
                  </button>
                </form>

                <div className="flex flex-wrap items-center gap-1.5">
                  {(['all', '2160p', '1080p', '720p'] as const).map(quality => (
                    <button
                      key={quality}
                      type="button"
                      onClick={() => setSelectedQuality(quality)}
                      className={`min-h-11 px-3 rounded-lg text-xs font-bold border ${
                        selectedQuality === quality
                          ? 'bg-blue-600 text-white border-blue-500'
                          : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                      }`}
                    >
                      {quality === 'all' ? 'Toutes' : quality === '2160p' ? '4K' : quality}
                    </button>
                  ))}

                  <span className="w-px h-4 bg-zinc-800 mx-0.5" />

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
                  <div className="py-8 flex items-center justify-center gap-2 text-xs text-zinc-400">
                    <Loader2 size={18} className="animate-spin text-blue-400" />
                    Recherche C411…
                  </div>
                ) : filteredTorrents.length > 0 ? (
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {filteredTorrents.map(torrent => (
                      <div key={torrent.id} className="p-3 rounded-xl bg-zinc-900 border border-zinc-800 space-y-2">
                        <p className="text-[11px] font-bold text-white break-words leading-snug">{torrent.name}</p>
                        <div className="flex flex-wrap gap-1.5 text-[9px] font-bold text-zinc-400">
                          {torrent.quality && <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-300">{torrent.quality}</span>}
                          {torrent.language && <span>{torrent.language}</span>}
                          <span>{formatTorrentSize(torrent.size)}</span>
                          <span className="text-emerald-400">↑ {torrent.seeders || 0}</span>
                          <span>↓ {torrent.leechers || 0}</span>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={sendingTorrentId === torrent.id}
                            onClick={() => void handleSendToClient(torrent)}
                            className="flex-1 min-h-11 rounded-lg bg-[#E5A93D] hover:bg-[#f0b84c] text-black text-xs font-black flex items-center justify-center gap-1.5 disabled:opacity-50"
                          >
                            {sendingTorrentId === torrent.id ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                            Envoyer
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleCopyMagnet(torrent)}
                            className="min-h-11 px-3 rounded-lg bg-zinc-800 text-zinc-300 text-xs font-bold flex items-center gap-1.5"
                          >
                            {copiedHash === torrent.infoHash ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                            Magnet
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : hasSearched ? (
                  <div className="py-7 text-center text-xs text-zinc-500">Aucune release trouvée pour cette recherche.</div>
                ) : null}
              </div>
            )}
          </section>

          {actionMessage && (
            <div className={`p-3 rounded-xl border text-[11px] flex items-start gap-2 ${
              actionMessage.type === 'error'
                ? 'bg-red-500/10 border-red-500/20 text-red-300'
                : actionMessage.type === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                  : 'bg-blue-500/10 border-blue-500/20 text-blue-300'
            }`}>
              {actionMessage.type === 'error' ? <AlertCircle size={14} /> : <Check size={14} />}
              <span>{actionMessage.text}</span>
            </div>
          )}

          {activeDownloads.length > 0 && (
            <section>
              <LiveDownloadBanner items={activeDownloads} />
            </section>
          )}
        </div>
      </div>

      {isSeasonPickerOpen && (
        <div
          className="fixed inset-0 z-[220] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
          onClick={() => setIsSeasonPickerOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="season-picker-title"
            className="w-full max-w-sm max-h-[70vh] overflow-y-auto rounded-2xl bg-zinc-900 border border-zinc-700 p-3 space-y-1.5"
            onClick={event => event.stopPropagation()}
          >
            <div className="flex items-center justify-between px-1 pb-2 mb-1 border-b border-zinc-800">
              <span id="season-picker-title" className="text-sm font-extrabold text-white">Choisir la saison</span>
              <button type="button" onClick={() => setIsSeasonPickerOpen(false)} className="w-11 h-11 text-zinc-400 flex items-center justify-center" aria-label="Fermer le choix de saison">
                <X size={17} />
              </button>
            </div>
            {availableSeasons.map(season => (
              <button
                key={season.season_number}
                type="button"
                onClick={() => {
                  handleScopeChange(scopeMode, season.season_number, selectedEpisode);
                  setIsSeasonPickerOpen(false);
                }}
                className={`w-full min-h-11 px-3 py-2.5 rounded-xl text-left flex items-center justify-between ${
                  selectedSeason === season.season_number
                    ? 'bg-[#E5A93D] text-black'
                    : 'bg-zinc-800/70 text-zinc-200'
                }`}
              >
                <span>
                  <span className="block text-xs font-bold">{season.name || `Saison ${season.season_number}`}</span>
                  <span className="block text-[10px] opacity-70">{season.episode_count || 0} épisodes</span>
                </span>
                {selectedSeason === season.season_number && <Check size={15} />}
              </button>
            ))}
          </div>
        </div>
      )}

      {isEpisodePickerOpen && (
        <div
          className="fixed inset-0 z-[220] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
          onClick={() => setIsEpisodePickerOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="episode-picker-title"
            className="w-full max-w-sm max-h-[70vh] overflow-y-auto rounded-2xl bg-zinc-900 border border-zinc-700 p-3"
            onClick={event => event.stopPropagation()}
          >
            <div className="flex items-center justify-between px-1 pb-2 mb-2 border-b border-zinc-800">
              <span id="episode-picker-title" className="text-sm font-extrabold text-white">Choisir l'épisode</span>
              <button type="button" onClick={() => setIsEpisodePickerOpen(false)} className="w-11 h-11 text-zinc-400 flex items-center justify-center" aria-label="Fermer le choix d'épisode">
                <X size={17} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {Array.from({ length: maxEpisodes }, (_, index) => index + 1).map(episode => (
                <button
                  key={episode}
                  type="button"
                  onClick={() => {
                    handleScopeChange('episode', selectedSeason, episode);
                    setIsEpisodePickerOpen(false);
                  }}
                  className={`min-h-11 px-3 py-2.5 rounded-xl text-xs font-bold flex items-center justify-between ${
                    selectedEpisode === episode
                      ? 'bg-[#E5A93D] text-black'
                      : 'bg-zinc-800/70 text-zinc-200'
                  }`}
                >
                  Épisode {episode}
                  {selectedEpisode === episode && <Check size={14} />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
