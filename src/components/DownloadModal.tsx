import React, { useState, useEffect, useMemo } from 'react';
import { 
  Download, 
  X, 
  Search, 
  HardDrive, 
  Radio, 
  ExternalLink, 
  Check, 
  Copy, 
  Loader2, 
  AlertCircle, 
  Sliders, 
  Sparkles,
  Server,
  Film,
  Tv,
  Layers,
  PlaySquare,
  Zap,
  RefreshCw,
  ChevronDown
} from 'lucide-react';
import { C411Torrent, searchC411Torrents, formatTorrentSize } from '../services/c411';
import { useDownloadConfigStore } from '../store/downloadConfigStore';
import { 
  searchAndDownloadInSonarr, 
  searchAndDownloadInRadarr, 
  pushReleaseDirectly,
  testServiceConnection
} from '../services/sonarrRadarr';
import { tmdb } from '../features/shows/tmdb';

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
  imdbId?: string;
  initialSeason?: number;
  initialEpisode?: number;
  totalSeasons?: number;
  seasonsData?: SeasonInfo[];
  onSuccessToast?: (msg: string) => void;
}

export function DownloadModal({
  isOpen,
  onClose,
  title,
  originalTitle,
  year,
  mediaType,
  tmdbId,
  imdbId,
  initialSeason,
  initialEpisode,
  totalSeasons = 1,
  seasonsData,
  onSuccessToast
}: DownloadModalProps) {
  const {
    c411ApiKey,
    sonarrUrl,
    sonarrApiKey,
    radarrUrl,
    radarrApiKey,
    qbittorrentUrl,
    qbittorrentUsername,
    qbittorrentPassword,
  } = useDownloadConfigStore();

  // Mode de portée (Scope) : 'all' (Série entière / Film), 'season' (Saison X), 'episode' (S01E01)
  const [scopeMode, setScopeMode] = useState<'all' | 'season' | 'episode'>(
    initialEpisode && initialSeason ? 'episode' : initialSeason ? 'season' : 'all'
  );
  const [selectedSeason, setSelectedSeason] = useState<number>(initialSeason || 1);
  const [selectedEpisode, setSelectedEpisode] = useState<number>(initialEpisode || 1);

  // Saisons et Épisodes réels
  const [availableSeasons, setAvailableSeasons] = useState<SeasonInfo[]>([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [torrents, setTorrents] = useState<C411Torrent[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  
  // États d'action Sonarr / Radarr
  const [isTriggeringAuto, setIsTriggeringAuto] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [actionMessage, setActionMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Filtres
  const [selectedQuality, setSelectedQuality] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'seeders' | 'size' | 'date'>('seeders');

  // Charger les saisons réelles depuis les props ou TMDB
  useEffect(() => {
    if (!isOpen || mediaType !== 'tv') return;

    if (seasonsData && seasonsData.length > 0) {
      const filtered = seasonsData.filter(s => s.season_number > 0);
      setAvailableSeasons(filtered);
      return;
    }

    if (tmdbId) {
      tmdb.getShowDetails(Number(tmdbId)).then((res) => {
        if (res.ok && res.value && Array.isArray(res.value.seasons)) {
          const valid = res.value.seasons
            .filter((s: any) => s.season_number > 0)
            .map((s: any) => ({
              season_number: s.season_number,
              episode_count: s.episode_count || 10,
              name: s.name || `Saison ${s.season_number}`
            }));
          if (valid.length > 0) {
            setAvailableSeasons(valid);
            return;
          }
        }
        // Fallback simple
        const fallbackCount = Math.max(totalSeasons, 1);
        setAvailableSeasons(
          Array.from({ length: fallbackCount }, (_, i) => ({
            season_number: i + 1,
            episode_count: 24,
            name: `Saison ${i + 1}`
          }))
        );
      }).catch(() => {
        const fallbackCount = Math.max(totalSeasons, 1);
        setAvailableSeasons(
          Array.from({ length: fallbackCount }, (_, i) => ({
            season_number: i + 1,
            episode_count: 24,
            name: `Saison ${i + 1}`
          }))
        );
      });
    } else {
      const fallbackCount = Math.max(totalSeasons, 1);
      setAvailableSeasons(
        Array.from({ length: fallbackCount }, (_, i) => ({
          season_number: i + 1,
          episode_count: 24,
          name: `Saison ${i + 1}`
        }))
      );
    }
  }, [isOpen, mediaType, tmdbId, seasonsData, totalSeasons]);

  // Récupérer le nombre exact d'épisodes pour la saison sélectionnée
  const currentSeasonData = useMemo(() => {
    return availableSeasons.find(s => s.season_number === selectedSeason) || availableSeasons[0] || {
      season_number: selectedSeason,
      episode_count: 24,
      name: `Saison ${selectedSeason}`
    };
  }, [availableSeasons, selectedSeason]);

  const maxEpisodesForCurrentSeason = Math.max(currentSeasonData.episode_count || 1, 1);

  // Génère la requête de recherche idéale selon la portée
  const generateQuery = (mode: 'all' | 'season' | 'episode', sNum: number, eNum: number) => {
    const baseTitle = (title || '').trim();
    if (mediaType === 'movie') {
      return year ? `${baseTitle} ${year}` : baseTitle;
    }

    if (mode === 'episode') {
      const sStr = String(sNum).padStart(2, '0');
      const eStr = String(eNum).padStart(2, '0');
      return `${baseTitle} S${sStr}E${eStr}`;
    }

    if (mode === 'season') {
      const sStr = String(sNum).padStart(2, '0');
      return `${baseTitle} S${sStr}`;
    }

    return baseTitle;
  };

  useEffect(() => {
    if (isOpen) {
      const initialMode = initialEpisode && initialSeason ? 'episode' : initialSeason ? 'season' : 'all';
      setScopeMode(initialMode);
      const sVal = initialSeason || 1;
      const eVal = initialEpisode || 1;
      setSelectedSeason(sVal);
      setSelectedEpisode(eVal);

      const q = generateQuery(initialMode, sVal, eVal);
      setSearchQuery(q);
      performSearch(q);
    } else {
      setTorrents([]);
      setHasSearched(false);
      setActionMessage(null);
      setIsTriggeringAuto(false);
    }
  }, [isOpen, title, initialSeason, initialEpisode]);

  const handleScopeChange = (newMode: 'all' | 'season' | 'episode', sNum = selectedSeason, eNum = selectedEpisode) => {
    setScopeMode(newMode);
    setSelectedSeason(sNum);

    // Ajuster l'épisode si la saison change et qu'elle contient moins d'épisodes
    const targetSeasonObj = availableSeasons.find(s => s.season_number === sNum);
    const maxEp = targetSeasonObj ? Math.max(targetSeasonObj.episode_count, 1) : 24;
    const adjustedEpisode = Math.min(eNum, maxEp);
    setSelectedEpisode(adjustedEpisode);

    const newQ = generateQuery(newMode, sNum, adjustedEpisode);
    setSearchQuery(newQ);
    performSearch(newQ);
  };

  const handleSeasonSelect = (newSeasonNum: number) => {
    handleScopeChange(scopeMode, newSeasonNum, selectedEpisode);
  };

  const handleEpisodeSelect = (newEpisodeNum: number) => {
    handleScopeChange('episode', selectedSeason, newEpisodeNum);
  };

  const performSearch = async (queryText: string) => {
    if (!queryText.trim()) return;
    setLoading(true);
    setActionMessage(null);
    try {
      const results = await searchC411Torrents({
        query: queryText.trim(),
        mediaType,
        year: mediaType === 'movie' ? year : undefined,
        apiKey: c411ApiKey
      });
      setTorrents(results);
      setHasSearched(true);
    } catch (e) {
      console.error(e);
      setTorrents([]);
      setHasSearched(true);
    } finally {
      setLoading(false);
    }
  };

  // 1. Déclenchement automatique intelligent via Sonarr / Radarr
  const handleAutoSearchClient = async () => {
    setIsTriggeringAuto(true);
    setActionMessage(null);

    try {
      if (mediaType === 'tv' && sonarrUrl && sonarrApiKey) {
        const res = await searchAndDownloadInSonarr({
          url: sonarrUrl,
          apiKey: sonarrApiKey,
          title,
          tmdbId,
          imdbId,
          season: scopeMode === 'all' ? undefined : selectedSeason,
          episode: scopeMode === 'episode' ? selectedEpisode : undefined
        });

        if (res.success) {
          setActionMessage({ text: res.message, type: 'success' });
          if (onSuccessToast) onSuccessToast(res.message);
        } else {
          setActionMessage({ text: res.message, type: 'error' });
        }
      } else if (mediaType === 'movie' && radarrUrl && radarrApiKey) {
        const res = await searchAndDownloadInRadarr({
          url: radarrUrl,
          apiKey: radarrApiKey,
          title,
          tmdbId,
          year
        });

        if (res.success) {
          setActionMessage({ text: res.message, type: 'success' });
          if (onSuccessToast) onSuccessToast(res.message);
        } else {
          setActionMessage({ text: res.message, type: 'error' });
        }
      }
    } catch (err: any) {
      setActionMessage({
        text: `Erreur client : ${err?.message || 'Serveur injoignable'}`,
        type: 'error'
      });
    } finally {
      setIsTriggeringAuto(false);
    }
  };

  // 2. Copier le lien Magnet
  const handleCopyMagnet = (torrent: C411Torrent) => {
    if (torrent.magnetUri) {
      navigator.clipboard.writeText(torrent.magnetUri);
      setCopiedHash(torrent.infoHash);
      setTimeout(() => setCopiedHash(null), 2000);
      if (onSuccessToast) onSuccessToast('Lien Magnet copié dans le presse-papier !');
    }
  };

  // 3. Envoyer une release spécifique à Sonarr / Radarr / qBittorrent
  const handleSendToClient = async (torrent: C411Torrent) => {
    setDownloadingId(torrent.id);
    setActionMessage(null);

    let clientToUse: 'sonarr' | 'radarr' | 'qbittorrent' | null = null;
    let url = '';
    let apiKey = '';
    let username = '';
    let password = '';

    if (mediaType === 'tv' && sonarrUrl && sonarrApiKey) {
      clientToUse = 'sonarr';
      url = sonarrUrl;
      apiKey = sonarrApiKey;
    } else if (mediaType === 'movie' && radarrUrl && radarrApiKey) {
      clientToUse = 'radarr';
      url = radarrUrl;
      apiKey = radarrApiKey;
    } else if (qbittorrentUrl) {
      clientToUse = 'qbittorrent';
      url = qbittorrentUrl;
      username = qbittorrentUsername;
      password = qbittorrentPassword;
    }

    if (!clientToUse) {
      // Aucun client distant configuré -> ouvrir le lien magnet directement
      if (torrent.magnetUri) {
        window.location.href = torrent.magnetUri;
        if (onSuccessToast) onSuccessToast('Ouverture du client BitTorrent local...');
      }
      setDownloadingId(null);
      return;
    }

    const result = await pushReleaseDirectly({
      service: clientToUse,
      url,
      apiKey,
      username,
      password,
      torrent,
      mediaType,
      mediaInfo: {
        title,
        tmdbId,
        imdbId,
        year,
        season: selectedSeason,
        episode: selectedEpisode
      }
    });

    setDownloadingId(null);
    if (result.success) {
      setActionMessage({ text: result.message, type: 'success' });
      if (onSuccessToast) onSuccessToast(result.message);
    } else {
      setActionMessage({ text: result.message, type: 'error' });
    }
  };

  // Filtrage et Tri
  const filteredTorrents = useMemo(() => {
    let list = [...torrents];

    if (selectedQuality !== 'all') {
      list = list.filter(t => {
        const q = (t.quality || '').toLowerCase();
        const n = t.name.toLowerCase();
        if (selectedQuality === '2160p' || selectedQuality === '4k') {
          return q.includes('2160') || q.includes('4k') || n.includes('2160p') || n.includes('4k') || n.includes('uhd');
        }
        if (selectedQuality === '1080p') {
          return q.includes('1080') || n.includes('1080p') || n.includes('1080i');
        }
        if (selectedQuality === '720p') {
          return q.includes('720') || n.includes('720p');
        }
        return true;
      });
    }

    list.sort((a, b) => {
      if (sortBy === 'seeders') return (b.seeders || 0) - (a.seeders || 0);
      if (sortBy === 'size') return (b.size || 0) - (a.size || 0);
      if (sortBy === 'date') return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
      return 0;
    });

    return list;
  }, [torrents, selectedQuality, sortBy]);

  const hasConfiguredClient = Boolean(
    (mediaType === 'tv' && sonarrUrl && sonarrApiKey) ||
    (mediaType === 'movie' && radarrUrl && radarrApiKey) ||
    qbittorrentUrl
  );

  const clientName = mediaType === 'tv' && sonarrUrl ? 'Sonarr' : mediaType === 'movie' && radarrUrl ? 'Radarr' : 'qBittorrent';

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="p-3.5 sm:p-5 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/90 shrink-0">
          <div className="flex items-center gap-3 min-w-0 flex-1 mr-2">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
              <Download size={18} className="sm:w-5 sm:h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-bold text-sm sm:text-base text-white truncate">
                Téléchargement
              </h3>
              <p className="text-xs text-zinc-400 truncate">
                {title} {year ? `(${year})` : ''}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-zinc-800/80 hover:bg-zinc-700 active:scale-95 text-zinc-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scope Selector for Series (Série entière vs Saison vs Épisode) */}
        {mediaType === 'tv' && (
          <div className="p-3 bg-zinc-950/80 border-b border-zinc-800 space-y-2.5 shrink-0">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-bold uppercase text-zinc-400 tracking-wider flex items-center gap-1.5">
                <Layers size={13} className="text-blue-400" />
                Portée :
              </span>
              <span className="text-zinc-400 font-semibold truncate max-w-[200px]">
                {scopeMode === 'all' ? 'Toute la série' : scopeMode === 'season' ? `Saison ${selectedSeason}` : `S${String(selectedSeason).padStart(2, '0')}E${String(selectedEpisode).padStart(2, '0')}`}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-1.5 bg-zinc-900/90 p-1 rounded-xl border border-white/5">
              <button
                type="button"
                onClick={() => handleScopeChange('all')}
                className={`py-1.5 px-1 rounded-lg text-[11px] sm:text-xs font-bold transition-all flex items-center justify-center gap-1 sm:gap-1.5 cursor-pointer ${
                  scopeMode === 'all' ? 'bg-blue-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Tv size={12} className="shrink-0" />
                <span className="truncate">Série</span>
              </button>

              <button
                type="button"
                onClick={() => handleScopeChange('season')}
                className={`py-1.5 px-1 rounded-lg text-[11px] sm:text-xs font-bold transition-all flex items-center justify-center gap-1 sm:gap-1.5 cursor-pointer ${
                  scopeMode === 'season' ? 'bg-blue-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Layers size={12} className="shrink-0" />
                <span className="truncate">Saison</span>
              </button>

              <button
                type="button"
                onClick={() => handleScopeChange('episode')}
                className={`py-1.5 px-1 rounded-lg text-[11px] sm:text-xs font-bold transition-all flex items-center justify-center gap-1 sm:gap-1.5 cursor-pointer ${
                  scopeMode === 'episode' ? 'bg-blue-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
                }`}
              >
                <PlaySquare size={12} className="shrink-0" />
                <span className="truncate">Épisode</span>
              </button>
            </div>

            {/* Sélecteurs intelligents et réels de Saison et d'Épisode */}
            {scopeMode !== 'all' && (
              <div className="flex flex-wrap items-center gap-2.5 pt-1 animate-in fade-in duration-150">
                {/* Sélecteur de Saison */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-bold text-zinc-400">Saison :</span>
                  <div className="relative inline-flex items-center">
                    <select
                      value={selectedSeason}
                      onChange={(e) => handleSeasonSelect(Number(e.target.value))}
                      className="appearance-none bg-zinc-800 text-white border border-zinc-700 rounded-lg pl-2.5 pr-7 py-1 text-xs font-bold focus:outline-none focus:border-blue-500 cursor-pointer shadow-sm"
                    >
                      {availableSeasons.length > 0 ? (
                        availableSeasons.map((s) => (
                          <option key={`s_opt_${s.season_number}`} value={s.season_number} className="bg-zinc-900 text-white">
                            {s.name || `Saison ${s.season_number}`} {s.episode_count ? `(${s.episode_count} ép.)` : ''}
                          </option>
                        ))
                      ) : (
                        Array.from({ length: Math.max(totalSeasons, 1) }, (_, i) => i + 1).map((s) => (
                          <option key={`s_opt_fb_${s}`} value={s} className="bg-zinc-900 text-white">
                            Saison {s}
                          </option>
                        ))
                      )}
                    </select>
                    <ChevronDown size={13} className="absolute right-2 text-zinc-400 pointer-events-none" />
                  </div>
                </div>

                {/* Sélecteur d'Épisode (strictement filtré sur le nombre réel d'épisodes) */}
                {scopeMode === 'episode' && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-bold text-zinc-400">Épisode :</span>
                    <div className="relative inline-flex items-center">
                      <select
                        value={selectedEpisode}
                        onChange={(e) => handleEpisodeSelect(Number(e.target.value))}
                        className="appearance-none bg-zinc-800 text-white border border-zinc-700 rounded-lg pl-2.5 pr-7 py-1 text-xs font-bold focus:outline-none focus:border-blue-500 cursor-pointer shadow-sm"
                      >
                        {Array.from({ length: maxEpisodesForCurrentSeason }, (_, i) => i + 1).map((ep) => (
                          <option key={`ep_opt_${ep}`} value={ep} className="bg-zinc-900 text-white">
                            Épisode {ep}
                          </option>
                        ))}
                      </select>
                      <ChevronDown size={13} className="absolute right-2 text-zinc-400 pointer-events-none" />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Hero Card : Déclenchement Automatique Sonarr / Radarr (si configuré) */}
        {hasConfiguredClient && (sonarrUrl || radarrUrl) && (
          <div className="p-3 bg-gradient-to-r from-blue-950/40 via-zinc-900/80 to-blue-950/30 border-b border-blue-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
                <Zap size={14} />
              </div>
              <div className="min-w-0 flex-1">
                <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                  Gestion Automatique {clientName}
                </h4>
                <p className="text-[10px] text-zinc-400 truncate">
                  {mediaType === 'tv' 
                    ? scopeMode === 'all' ? `Ajouter et télécharger la série dans Sonarr` : scopeMode === 'season' ? `Télécharger la Saison ${selectedSeason} dans Sonarr` : `Télécharger S${String(selectedSeason).padStart(2, '0')}E${String(selectedEpisode).padStart(2, '0')} dans Sonarr`
                    : `Ajouter et télécharger le film dans Radarr`}
                </p>
              </div>
            </div>

            <button
              onClick={handleAutoSearchClient}
              disabled={isTriggeringAuto}
              className="w-full sm:w-auto px-3.5 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 active:scale-95 text-white text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm disabled:opacity-50 shrink-0"
            >
              {isTriggeringAuto ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  <span>Traitement...</span>
                </>
              ) : (
                <>
                  <Zap size={13} className="text-amber-300" />
                  <span>Lancer dans {clientName}</span>
                </>
              )}
            </button>
          </div>
        )}

        {/* Action Message Alert */}
        {actionMessage && (
          <div className={`px-3.5 py-2 text-xs flex items-center gap-2 shrink-0 ${
            actionMessage.type === 'success' 
              ? 'bg-emerald-950/90 text-emerald-300 border-b border-emerald-800' 
              : 'bg-red-950/90 text-red-300 border-b border-red-800'
          }`}>
            {actionMessage.type === 'success' ? <Check size={14} className="shrink-0 text-emerald-400" /> : <AlertCircle size={14} className="shrink-0 text-red-400" />}
            <span className="leading-snug text-[11px]">{actionMessage.text}</span>
          </div>
        )}

        {/* Search Bar & Results Header */}
        <div className="p-2.5 sm:p-3 bg-zinc-950/60 border-b border-zinc-800/80 shrink-0">
          <form 
            onSubmit={(e) => {
              e.preventDefault();
              performSearch(searchQuery);
            }}
            className="flex gap-2"
          >
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Recherche de torrent..."
                className="w-full pl-9 pr-3 py-1.5 sm:py-2 bg-zinc-900 border border-zinc-700/80 rounded-xl text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500 transition-colors"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="px-3.5 py-1.5 sm:py-2 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0"
            >
              {loading ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
              <span className="hidden sm:inline">Rechercher</span>
            </button>
          </form>
        </div>

        {/* Filters & Sorting */}
        <div className="px-3 py-1.5 bg-zinc-900 flex items-center justify-between border-b border-zinc-800/60 text-xs shrink-0 gap-2 overflow-x-auto">
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-zinc-400 font-medium text-[10px] sm:text-[11px] whitespace-nowrap">Qualité :</span>
            <select
              value={selectedQuality}
              onChange={(e) => setSelectedQuality(e.target.value)}
              className="bg-zinc-800 text-zinc-200 border border-zinc-700/60 rounded-lg px-2 py-0.5 text-[10px] sm:text-[11px] focus:outline-none cursor-pointer"
            >
              <option value="all">Toutes</option>
              <option value="2160p">4K / 2160p</option>
              <option value="1080p">1080p</option>
              <option value="720p">720p</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-zinc-400 font-medium text-[10px] sm:text-[11px] whitespace-nowrap">Tri :</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="bg-zinc-800 text-zinc-200 border border-zinc-700/60 rounded-lg px-2 py-0.5 text-[10px] sm:text-[11px] focus:outline-none cursor-pointer"
            >
              <option value="seeders">Seeders</option>
              <option value="size">Taille</option>
              <option value="date">Date</option>
            </select>
          </div>
        </div>

        {/* Results List */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-2.5">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-3 text-zinc-400">
              <Loader2 size={28} className="animate-spin text-blue-400" />
              <p className="text-xs font-medium">Recherche des releases sur C411...</p>
            </div>
          ) : filteredTorrents.length > 0 ? (
            filteredTorrents.map((t) => {
              const isSending = downloadingId === t.id;
              const isCopied = copiedHash === t.infoHash;

              return (
                <div
                  key={`torrent_${t.id}`}
                  className="bg-zinc-950/60 hover:bg-zinc-950 border border-zinc-800/80 hover:border-zinc-700 rounded-xl p-3 sm:p-3.5 transition-all flex flex-col gap-2.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h4 className="text-xs font-bold text-zinc-100 leading-snug break-words">
                        {t.name}
                      </h4>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        {t.quality && (
                          <span className="px-1.5 py-0.5 rounded bg-blue-500/10 border border-blue-500/20 text-blue-400 font-bold text-[10px]">
                            {t.quality}
                          </span>
                        )}
                        {t.language && (
                          <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[10px] font-medium border border-white/5">
                            {t.language}
                          </span>
                        )}
                        <span className="text-[11px] font-semibold text-zinc-300">
                          {formatTorrentSize(t.size)}
                        </span>
                        <span className="text-[11px] font-bold text-emerald-400 flex items-center gap-1">
                          <Radio size={12} />
                          {t.seeders} seed{t.seeders > 1 ? 's' : ''}
                        </span>
                        {t.isFreeleech && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[9px] font-black uppercase">
                            FreeLeech
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions Buttons */}
                  <div className="flex items-center justify-between pt-1 border-t border-zinc-800/40 gap-2">
                    <button
                      onClick={() => handleCopyMagnet(t)}
                      className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white text-[11px] font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                      title="Copier le lien Magnet"
                    >
                      {isCopied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                      {isCopied ? 'Magnet copié !' : 'Magnet'}
                    </button>

                    <div className="flex items-center gap-2">
                      {hasConfiguredClient ? (
                        <button
                          onClick={() => handleSendToClient(t)}
                          disabled={isSending}
                          className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 active:scale-95 text-white text-[11px] font-bold flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50 shadow-sm"
                        >
                          {isSending ? <Loader2 size={13} className="animate-spin" /> : <Server size={13} />}
                          Envoyer à {clientName}
                        </button>
                      ) : (
                        <button
                          onClick={() => handleSendToClient(t)}
                          className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 active:scale-95 text-white text-[11px] font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
                        >
                          <Download size={13} />
                          Télécharger
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          ) : hasSearched ? (
            <div className="py-10 px-4 flex flex-col items-center justify-center gap-3 text-center text-zinc-400">
              <div className="w-12 h-12 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400">
                <AlertCircle size={24} className="text-amber-400/80" />
              </div>
              <div>
                <p className="text-xs font-bold text-zinc-200">
                  Aucun résultat pour « {searchQuery} »
                </p>
                <p className="text-[11px] text-zinc-400 max-w-sm mt-1 leading-relaxed">
                  {scopeMode !== 'all' 
                    ? `Cette saison ou cet épisode n'est peut-être pas encore disponible ou diffusé. Essayez de chercher la série complète ou une autre saison :` 
                    : `Essayez de modifier le nom ou de retirer les caractères spéciaux dans la barre de recherche.`}
                </p>
              </div>

              {/* Bouton rapide de recherche globale */}
              {mediaType === 'tv' && scopeMode !== 'all' && (
                <div className="flex flex-col items-center gap-2 mt-1 w-full max-w-xs">
                  <button
                    type="button"
                    onClick={() => handleScopeChange('all')}
                    className="w-full py-2.5 px-4 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 text-blue-300 font-bold text-xs flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer"
                  >
                    <Search size={13} />
                    <span>Rechercher toute la série « {title} »</span>
                  </button>

                  {/* Saisons disponibles */}
                  {totalSeasons > 1 && (
                    <div className="flex items-center gap-1.5 flex-wrap justify-center pt-1">
                      <span className="text-[10px] text-zinc-500 font-medium mr-1">Tester :</span>
                      {Array.from({ length: Math.min(totalSeasons, 10) }, (_, i) => i + 1).map((sNum) => (
                        <button
                          key={`s_pill_${sNum}`}
                          type="button"
                          onClick={() => handleScopeChange('season', sNum)}
                          className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-colors cursor-pointer ${
                            selectedSeason === sNum 
                              ? 'bg-blue-600 text-white border-blue-500' 
                              : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border-zinc-700/60'
                          }`}
                        >
                          Saison {sNum}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Footer info */}
        <div className="p-3 bg-zinc-950 border-t border-zinc-800 text-[10px] text-zinc-500 flex items-center justify-between">
          <span>Tracker C411 actif</span>
          <span className="text-zinc-400">
            {hasConfiguredClient ? `${clientName} connecté` : 'Configuration possible dans Paramètres'}
          </span>
        </div>

      </div>
    </div>
  );
}
