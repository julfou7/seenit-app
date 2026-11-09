import { DialogLayer } from './ui/DialogLayer';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Loader2,
  Search,
  X
} from 'lucide-react';
import { DownloadMark } from './SeenItLogo';
import { type C411Torrent, formatTorrentSize, searchC411Torrents } from '../services/c411';
import { useDownloadConfigStore } from '../store/downloadConfigStore';
import { useLiveDownloadStore } from '../store/liveDownloadStore';
import { useToastStore } from '../store/toastStore';
import './download-dialog.css';
import { sendReleaseToClient } from '../features/downloads/releaseSend';
import { tmdb } from '../features/shows/tmdb';
import { launchArrDownload } from '../features/downloads/downloadLaunch';
import { hasActiveDownloadInScope } from '../features/downloads/downloadSearchGuard';
import { isDownloadFeatureEnabled } from '../features/downloads/downloadFeatureVisibility';
import { matchesLightFilter, type LightFilter } from '../features/downloads/releaseQuality';
import { ReleaseLightFilter } from './ReleaseLightFilter';
import { useMediaPresence } from '../hooks/useMediaPresence';
import { episodePresenceKey } from '../features/downloads/episodePresenceKey';


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
  const presence = useMediaPresence({ tmdbId, tvdbId, imdbId, title, year, mediaType, enabled: isOpen });
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
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [torrents, setTorrents] = useState<C411Torrent[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedQuality, setSelectedQuality] = useState<'all' | '2160p' | '1080p' | '720p'>('all');
  const [lightFilter, setLightFilter] = useState<LightFilter>('all');
  const [sortBy, setSortBy] = useState<'seeders' | 'size' | 'date'>('seeders');
  const [sendingTorrentId, setSendingTorrentId] = useState<number | null>(null);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const autoInFlightRef = useRef(false);

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
    setReplaceExisting(false);
    setTorrents([]);
    setHasSearched(false);
    setIsTriggeringAuto(false);
  }, [isOpen, title, year, initialSeason, initialEpisode]);


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
          .filter((season: { season_number: number }) => season.season_number > 0)
          .map((season: { season_number: number; episode_count?: number; name?: string }) => ({
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
  const alreadyAvailable = mediaType === 'movie'
    ? Boolean(presence.radarrHasFile || presence.plexInfo?.available)
    : scopeMode === 'episode' ? Boolean(presence.episodesHasFile[episodePresenceKey(selectedSeason, selectedEpisode)])
      : scopeMode === 'season' ? Boolean(presence.seasonsHasFile[selectedSeason]) : false;

  const scopeBusy = hasActiveDownloadInScope(downloads, {
    mediaType, tmdbId: Number(tmdbId), seasonNumber: isTv && scopeMode !== 'all' ? selectedSeason : undefined,
    episodeNumber: isTv && scopeMode === 'episode' ? selectedEpisode : undefined
  });

  const hasAutomationClient = mediaType === 'tv'
    ? Boolean(config.sonarrUrl && config.sonarrApiKey)
    : Boolean(config.radarrUrl && config.radarrApiKey);

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
    setReplaceExisting(false);
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
    const isTv = mediaType === 'tv';
    if (autoInFlightRef.current || !isDownloadFeatureEnabled(useDownloadConfigStore.getState())) return;
    if (presence.loading || (alreadyAvailable && !replaceExisting)) {
      setActionMessage({ text: presence.loading ? 'Vérification de la disponibilité en cours.' : 'Déjà disponible. Choisis explicitement une autre release pour remplacer le fichier.', type: 'info' });
      return;
    }
    if (hasActiveDownloadInScope(useLiveDownloadStore.getState().downloads, {
      mediaType, tmdbId: Number(tmdbId), seasonNumber: isTv && scopeMode !== 'all' ? selectedSeason : undefined,
      episodeNumber: isTv && scopeMode === 'episode' ? selectedEpisode : undefined
    })) {
      setActionMessage({ text: 'Une demande est déjà en cours pour ce média.', type: 'info' });
      return;
    }

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
    autoInFlightRef.current = true;
    setActionMessage(null);

    try {
      await launchArrDownload({
        config,
        mediaType,
        title,
        year,
        tmdbId,
        tvdbId,
        imdbId,
        posterPath,
        season: isTv && scopeMode !== 'all' ? selectedSeason : undefined,
        episode: isTv && scopeMode === 'episode' ? selectedEpisode : undefined,
        qualityPreference,
        replaceExisting,
        notify: showMediaDownloadToast,
        onStarted: onClose
      });
    } finally {
      autoInFlightRef.current = false;
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
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'C411 est momentanément indisponible.';
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
    setSendingTorrentId(torrent.id);
    try {
      // #879 — même envoi que la page « Version précise » (corps déplacé dans releaseSend).
      const result = await sendReleaseToClient({
        config, torrent, mediaType, title, tmdbId, tvdbId, imdbId, year, posterPath,
        season: mediaType === 'tv' && scopeMode !== 'all' ? selectedSeason : undefined,
        episode: mediaType === 'tv' && scopeMode === 'episode' ? selectedEpisode : undefined,
        notify: showMediaDownloadToast
      });
      if (result.magnetOnly) return;
      setActionMessage({ text: result.message, type: result.success ? 'success' : 'error' });
      if (result.success) {
        if (onSuccessToast) onSuccessToast(result.message);
        else showMediaDownloadToast(result.message, 'success');
      }
    } finally {
      setSendingTorrentId(null);
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

  if (!isOpen) return null;

  return (
    <DialogLayer onDismiss={onClose} label="Télécharger" historyMode="local" role="dialog"
      className="download-dialog-overlay"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} aria-labelledby="download-dialog-title" tabIndex={-1} className="download-dialog">
        <header className="download-dialog__header">
          {posterPath && <img src={posterPath.startsWith('http') ? posterPath : `https://image.tmdb.org/t/p/w185${posterPath}`} alt="" className="download-dialog__poster" />}
          <div className="download-dialog__identity">
            <p className="download-dialog__eyebrow">Télécharger</p>
            <h3 id="download-dialog-title">{title}</h3>
            <p className="download-dialog__muted">{isTv ? 'Série' : 'Film'}{year ? ` · ${year}` : ''}</p>
          </div>
          <button type="button" onClick={onClose} className="download-dialog__close" aria-label="Fermer la fenêtre de téléchargement"><X size={20} /></button>
        </header>
        <div className="download-dialog__content">
          {isTv && <section className="download-dialog__scope" aria-label="Contenu à télécharger">
            <div className="download-dialog__tabs">
              {([{ id: 'all', label: 'Série' }, { id: 'season', label: 'Saison' }, { id: 'episode', label: 'Épisode' }] as const).map(option =>
                <button key={option.id} type="button" aria-pressed={scopeMode === option.id} onClick={() => handleScopeChange(option.id)}>{option.label}</button>)}
            </div>
            {scopeMode !== 'all' && <div className="download-dialog__pickers">
              <button type="button" onClick={() => setIsSeasonPickerOpen(true)}>Saison {selectedSeason}<ChevronDown size={15} /></button>
              {scopeMode === 'episode' && <button type="button" onClick={() => setIsEpisodePickerOpen(true)}>Épisode {selectedEpisode}<ChevronDown size={15} /></button>}
            </div>}
          </section>}
          <section className="download-dialog__quality" aria-label="Choisir la qualité">
            <h4>Choisir la qualité</h4>
            {alreadyAvailable && <label className="download-dialog__replace"><input type="checkbox" checked={replaceExisting} onChange={event => setReplaceExisting(event.target.checked)} />Remplacer le fichier déjà disponible</label>}
            {presence.loading && <p role="status" className="download-dialog__muted">Vérification de la disponibilité…</p>}
            {scopeBusy && <p role="status" className="download-dialog__muted">Un téléchargement est déjà en cours pour ce contenu.</p>}
            {hasAutomationClient ? <div className="download-dialog__choices">
              {([{ id: '1080p', label: '1080p', hint: 'Full HD' }, { id: '4k', label: '4K', hint: 'Ultra HD · 2160p' }] as const).map(quality =>
                <button key={quality.id} type="button" aria-label={`Télécharger en ${quality.label}`} disabled={isTriggeringAuto || scopeBusy || presence.loading || (alreadyAvailable && !replaceExisting)} onClick={() => handleAutoSearchClient(quality.id)}>
                  <span className="download-dialog__quality-icon">{isTriggeringAuto ? <Loader2 size={19} className="animate-spin" /> : <DownloadMark size={21} />}</span>
                  <span><strong>{quality.label}</strong><small>{quality.hint}</small></span><ChevronRight size={18} />
                </button>)}
            </div> : <p className="download-dialog__muted">Configure les téléchargements dans les réglages pour choisir une qualité.</p>}
          </section>
          <section className="download-dialog__manual">
            <button type="button" onClick={() => setManualOpen(value => !value)} aria-expanded={manualOpen} className="download-dialog__manual-toggle">
              <Search size={18} /><span>Choisir une autre version</span><ChevronDown size={16} className={manualOpen ? 'rotate-180' : ''} />
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
                  <ReleaseLightFilter value={lightFilter} onChange={setLightFilter} />
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
                            className="flex-1 min-h-11 rounded-lg bg-[#7DD3FC] hover:bg-[#a5e2fd] text-black text-xs font-black flex items-center justify-center gap-1.5 disabled:opacity-50"
                          >
                            {sendingTorrentId === torrent.id ? <Loader2 size={13} className="animate-spin" /> : <DownloadMark size={15} />}
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

        </div>
      </div>

      {isSeasonPickerOpen && (
        <DialogLayer onDismiss={() => setIsSeasonPickerOpen(false)} label="Sélectionner une saison" historyMode="local" role="dialog"
          className="fixed inset-0 z-[220] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
          onClick={() => setIsSeasonPickerOpen(false)}
        >
          <div


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
                    ? 'bg-[#7DD3FC] text-black'
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
        </DialogLayer>
      )}

      {isEpisodePickerOpen && (
        <DialogLayer onDismiss={() => setIsEpisodePickerOpen(false)} label="Sélectionner un épisode" historyMode="local" role="dialog"
          className="fixed inset-0 z-[220] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
          onClick={() => setIsEpisodePickerOpen(false)}
        >
          <div


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
                      ? 'bg-[#7DD3FC] text-black'
                      : 'bg-zinc-800/70 text-zinc-200'
                  }`}
                >
                  Épisode {episode}
                  {selectedEpisode === episode && <Check size={14} />}
                </button>
              ))}
            </div>
          </div>
        </DialogLayer>
      )}
    </DialogLayer>
  );
}
