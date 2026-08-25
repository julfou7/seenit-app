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
  Tv
} from 'lucide-react';
import { C411Torrent, searchC411Torrents, formatTorrentSize, triggerRemoteDownload } from '../services/c411';
import { useDownloadConfigStore } from '../store/downloadConfigStore';

interface DownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  originalTitle?: string;
  year?: string | number;
  mediaType: 'movie' | 'tv';
  tmdbId?: number | string;
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
    autoSendToDownloader
  } = useDownloadConfigStore();

  const [searchQuery, setSearchQuery] = useState(title);
  const [torrents, setTorrents] = useState<C411Torrent[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [actionMessage, setActionMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Filtres
  const [selectedQuality, setSelectedQuality] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'seeders' | 'size' | 'date'>('seeders');

  useEffect(() => {
    if (isOpen) {
      setSearchQuery(title);
      performSearch(title);
    } else {
      setTorrents([]);
      setHasSearched(false);
      setActionMessage(null);
    }
  }, [isOpen, title]);

  const performSearch = async (queryText: string) => {
    if (!queryText.trim()) return;
    setLoading(true);
    setActionMessage(null);
    try {
      const results = await searchC411Torrents({
        query: queryText.trim(),
        mediaType,
        year,
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

  const handleCopyMagnet = (torrent: C411Torrent) => {
    if (torrent.magnetUri) {
      navigator.clipboard.writeText(torrent.magnetUri);
      setCopiedHash(torrent.infoHash);
      setTimeout(() => setCopiedHash(null), 2000);
      if (onSuccessToast) onSuccessToast('Lien Magnet copié dans le presse-papier !');
    }
  };

  const handleSendToClient = async (torrent: C411Torrent, targetClient?: 'sonarr' | 'radarr' | 'qbittorrent') => {
    setDownloadingId(torrent.id);
    setActionMessage(null);

    // Déterminer la cible
    let clientToUse: 'sonarr' | 'radarr' | 'qbittorrent' | null = targetClient || null;
    if (!clientToUse) {
      if (mediaType === 'tv' && sonarrUrl && sonarrApiKey) {
        clientToUse = 'sonarr';
      } else if (mediaType === 'movie' && radarrUrl && radarrApiKey) {
        clientToUse = 'radarr';
      } else if (qbittorrentUrl) {
        clientToUse = 'qbittorrent';
      }
    }

    if (!clientToUse) {
      // Aucun client distant configuré -> On copie le lien magnet et on ouvre le magnet
      if (torrent.magnetUri) {
        window.location.href = torrent.magnetUri;
        if (onSuccessToast) onSuccessToast('Ouverture du client BitTorrent local...');
      }
      setDownloadingId(null);
      return;
    }

    let url = '';
    let apiKey = '';
    let username = '';
    let password = '';

    if (clientToUse === 'sonarr') {
      url = sonarrUrl;
      apiKey = sonarrApiKey;
    } else if (clientToUse === 'radarr') {
      url = radarrUrl;
      apiKey = radarrApiKey;
    } else if (clientToUse === 'qbittorrent') {
      url = qbittorrentUrl;
      username = qbittorrentUsername;
      password = qbittorrentPassword;
    }

    const result = await triggerRemoteDownload({
      service: clientToUse,
      url,
      apiKey,
      username,
      password,
      torrent,
      mediaType,
      tmdbId,
      title,
      year
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
        
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/90">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Download size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base text-white line-clamp-1">
                  Télécharger sur C411
                </h3>
                <span className="text-[10px] uppercase font-black px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
                  Tracker Privé
                </span>
              </div>
              <p className="text-xs text-zinc-400 line-clamp-1">
                {title} {year ? `(${year})` : ''}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Search Bar & Quick Suggestions */}
        <div className="p-4 bg-zinc-950/60 border-b border-zinc-800/80 space-y-3">
          <form 
            onSubmit={(e) => {
              e.preventDefault();
              performSearch(searchQuery);
            }}
            className="flex gap-2"
          >
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Nom du film ou de la série..."
                className="w-full pl-10 pr-4 py-2 bg-zinc-900 border border-zinc-700/80 rounded-xl text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500 transition-colors"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
              Rechercher
            </button>
          </form>

          {/* Suggestions rapides */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-bold uppercase text-zinc-500 mr-1">Suggestions :</span>
            <button
              onClick={() => { setSearchQuery(title); performSearch(title); }}
              className="px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-300 hover:text-white text-[11px] font-medium border border-white/5 transition-colors"
            >
              {title}
            </button>
            {originalTitle && originalTitle !== title && (
              <button
                onClick={() => { setSearchQuery(originalTitle); performSearch(originalTitle); }}
                className="px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-300 hover:text-white text-[11px] font-medium border border-white/5 transition-colors"
              >
                {originalTitle} (VO)
              </button>
            )}
            {year && (
              <button
                onClick={() => { const q = `${title} ${year}`; setSearchQuery(q); performSearch(q); }}
                className="px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-300 hover:text-white text-[11px] font-medium border border-white/5 transition-colors"
              >
                {title} {year}
              </button>
            )}
          </div>
        </div>

        {/* Filters & Sorting */}
        <div className="px-4 py-2.5 bg-zinc-900 flex items-center justify-between border-b border-zinc-800/60 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-zinc-400 font-medium text-[11px]">Qualité :</span>
            <select
              value={selectedQuality}
              onChange={(e) => setSelectedQuality(e.target.value)}
              className="bg-zinc-800 text-zinc-200 border border-zinc-700/60 rounded-lg px-2 py-1 text-[11px] focus:outline-none"
            >
              <option value="all">Toutes</option>
              <option value="2160p">4K / 2160p</option>
              <option value="1080p">1080p</option>
              <option value="720p">720p</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-zinc-400 font-medium text-[11px]">Trier par :</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="bg-zinc-800 text-zinc-200 border border-zinc-700/60 rounded-lg px-2 py-1 text-[11px] focus:outline-none"
            >
              <option value="seeders">Seeders (Vitesse)</option>
              <option value="size">Taille</option>
              <option value="date">Date d'ajout</option>
            </select>
          </div>
        </div>

        {/* Action Message Alert */}
        {actionMessage && (
          <div className={`px-4 py-2 text-xs flex items-center gap-2 ${
            actionMessage.type === 'success' ? 'bg-emerald-950/80 text-emerald-300 border-b border-emerald-800' : 'bg-red-950/80 text-red-300 border-b border-red-800'
          }`}>
            {actionMessage.type === 'success' ? <Check size={14} /> : <AlertCircle size={14} />}
            <span>{actionMessage.text}</span>
          </div>
        )}

        {/* Results List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-3 text-zinc-400">
              <Loader2 size={28} className="animate-spin text-blue-400" />
              <p className="text-xs font-medium">Recherche sur le tracker C411...</p>
            </div>
          ) : filteredTorrents.length > 0 ? (
            filteredTorrents.map((t) => {
              const isSending = downloadingId === t.id;
              const isCopied = copiedHash === t.infoHash;

              return (
                <div
                  key={`torrent_${t.id}`}
                  className="bg-zinc-950/60 hover:bg-zinc-950 border border-zinc-800/80 hover:border-zinc-700 rounded-xl p-3.5 transition-all flex flex-col gap-2.5"
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
                          Envoyer au client ({mediaType === 'tv' && sonarrUrl ? 'Sonarr' : mediaType === 'movie' && radarrUrl ? 'Radarr' : 'qBittorrent'})
                        </button>
                      ) : (
                        <button
                          onClick={() => handleSendToClient(t)}
                          className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 active:scale-95 text-white text-[11px] font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
                        >
                          <Download size={13} />
                          Lancer le téléchargement
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          ) : hasSearched ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-center text-zinc-400">
              <AlertCircle size={28} className="text-zinc-500" />
              <p className="text-xs font-bold text-zinc-300">Aucun résultat trouvé sur C411</p>
              <p className="text-[11px] text-zinc-500 max-w-sm">
                Essayez d'ajuster le titre dans la barre de recherche ci-dessus (sans caractères spéciaux ou en anglais).
              </p>
            </div>
          ) : null}
        </div>

        {/* Footer info */}
        <div className="p-3 bg-zinc-950 border-t border-zinc-800 text-[10px] text-zinc-500 flex items-center justify-between">
          <span>Connexion sécurisée via l'API C411</span>
          <span className="text-zinc-400">
            {hasConfiguredClient ? 'Client distant actif' : 'Configuration possible dans Paramètres'}
          </span>
        </div>

      </div>
    </div>
  );
}
