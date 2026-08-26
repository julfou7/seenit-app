import React, { useState, useEffect, useMemo } from 'react';
import { 
  ArrowLeft, 
  Search, 
  Download, 
  Radio, 
  Copy, 
  Check, 
  Loader2, 
  AlertCircle, 
  Tv, 
  Film, 
  Server, 
  SlidersHorizontal,
  HardDrive,
  Clock,
  Zap,
  Sparkles,
  X
} from 'lucide-react';
import { C411Torrent, searchC411Torrents, formatTorrentSize } from '../services/c411';
import { useDownloadConfigStore } from '../store/downloadConfigStore';
import { useLiveDownloadStore } from '../store/liveDownloadStore';
import { LiveDownloadBanner } from '../components/LiveDownloadBanner';
import { pushReleaseDirectly } from '../services/sonarrRadarr';
import { useToastStore } from '../store/toastStore';
import { cn } from '../lib/utils';

interface FreeDownloadScreenProps {
  onBack: () => void;
  onShowClick?: (id: any, mediaType?: 'tv' | 'movie') => void;
}

export function FreeDownloadScreen({ onBack, onShowClick }: FreeDownloadScreenProps) {
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

  const showToast = useToastStore(s => s.showToast);
  const { downloads, startPolling, stopPolling } = useLiveDownloadStore();

  useEffect(() => {
    startPolling(1000);
    return () => {
      stopPolling();
    };
  }, [startPolling, stopPolling]);

  const [query, setQuery] = useState('');
  const [selectedMediaType, setSelectedMediaType] = useState<'all' | 'movie' | 'tv'>('all');
  const [selectedQuality, setSelectedQuality] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'seeders' | 'size' | 'date'>('seeders');
  const [torrents, setTorrents] = useState<C411Torrent[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const performSearch = async (queryText: string) => {
    if (!queryText.trim()) return;
    setLoading(true);
    try {
      const results = await searchC411Torrents({
        query: queryText.trim(),
        mediaType: selectedMediaType === 'all' ? undefined : selectedMediaType,
        apiKey: c411ApiKey
      });
      setTorrents(results);
      setHasSearched(true);
    } catch (e) {
      console.error(e);
      setTorrents([]);
      setHasSearched(true);
      showToast('Erreur lors de la recherche de torrents', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyMagnet = (torrent: C411Torrent) => {
    if (torrent.magnetUri) {
      navigator.clipboard.writeText(torrent.magnetUri);
      setCopiedHash(torrent.infoHash);
      setTimeout(() => setCopiedHash(null), 2000);
      showToast('Lien Magnet copié dans le presse-papier !', 'success');
    }
  };

  const handleSendToClient = async (torrent: C411Torrent) => {
    setDownloadingId(torrent.id);

    // Déterminer le client approprié
    let clientToUse: 'sonarr' | 'radarr' | 'qbittorrent' | null = null;
    let url = '';
    let apiKey = '';
    let username = '';
    let password = '';

    const isTv = selectedMediaType === 'tv' || /(s\d+|saison|season|e\d+)/i.test(torrent.name);
    
    if (isTv && sonarrUrl && sonarrApiKey) {
      clientToUse = 'sonarr';
      url = sonarrUrl;
      apiKey = sonarrApiKey;
    } else if (!isTv && radarrUrl && radarrApiKey) {
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
      if (torrent.magnetUri) {
        window.location.href = torrent.magnetUri;
        showToast('Ouverture du client BitTorrent local...', 'info');
      } else {
        showToast('Aucun client de téléchargement configuré.', 'error');
      }
      setDownloadingId(null);
      return;
    }

    // Ajout optimiste
    useLiveDownloadStore.getState().addOptimisticDownload({
      mediaType: isTv ? 'tv' : 'movie',
      title: torrent.name,
      releaseTitle: torrent.name,
      downloadClient: clientToUse === 'sonarr' ? 'Sonarr' : clientToUse === 'radarr' ? 'Radarr' : 'qBittorrent',
      statusText: `Envoi à ${clientToUse}...`
    });

    try {
      const result = await pushReleaseDirectly({
        service: clientToUse,
        url,
        apiKey,
        username,
        password,
        torrent,
        mediaType: isTv ? 'tv' : 'movie',
        mediaInfo: {
          title: torrent.name
        }
      });

      if (result.success) {
        showToast(result.message, 'success');
        useLiveDownloadStore.getState().startPolling(1000);
        useLiveDownloadStore.getState().fetchDownloads();
      } else {
        showToast(result.message, 'error');
      }
    } catch (err: any) {
      showToast(err?.message || "Erreur lors de l'envoi au client", 'error');
    } finally {
      setDownloadingId(null);
    }
  };

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

  const hasConfiguredClient = Boolean(sonarrUrl || radarrUrl || qbittorrentUrl);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-premium-ambient text-white overflow-hidden select-none">
      {/* Top Header */}
      <div className="shrink-0 px-4 pt-4 pb-3 border-b border-white/5 bg-zinc-950/70 backdrop-blur-xl flex items-center gap-3 z-10">
        <button
          type="button"
          onClick={onBack}
          className="w-9 h-9 rounded-xl bg-zinc-900 border border-white/10 flex items-center justify-center text-zinc-300 hover:text-white active:scale-95 transition-all cursor-pointer shrink-0"
          title="Retour aux téléchargements"
        >
          <ArrowLeft size={18} />
        </button>

        <div className="flex-1 min-w-0">
          <h1 className="text-base sm:text-lg font-black text-white truncate flex items-center gap-2">
            Recherche libre de torrents
          </h1>
          <p className="text-[11px] text-zinc-400 truncate">
            Recherchez et envoyez directement vos fichiers à vos clients
          </p>
        </div>
      </div>

      {/* Barre de recherche */}
      <div className="p-4 bg-zinc-950/40 border-b border-white/5 shrink-0 space-y-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            performSearch(query);
          }}
          className="flex gap-2"
        >
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Nom du film, série, saison (ex: Dune 2024, Severance S02)..."
              className="w-full pl-10 pr-9 py-2.5 bg-zinc-900/90 border border-zinc-700/80 focus:border-[#E5A93D] rounded-xl text-xs sm:text-sm text-white placeholder-zinc-500 focus:outline-none transition-colors"
              autoFocus
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
              >
                <X size={15} />
              </button>
            )}
          </div>
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="px-4 py-2.5 bg-[#E5A93D] hover:bg-[#F5C518] active:scale-95 text-black text-xs sm:text-sm font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0 shadow-md shadow-[#E5A93D]/20"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
            <span className="font-extrabold">Rechercher</span>
          </button>
        </form>

        {/* Filtres Type / Qualité / Tri */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          {/* Types */}
          <div className="flex items-center gap-1 bg-zinc-900/90 p-0.5 rounded-lg border border-white/5 text-[11px]">
            {[
              { id: 'all', label: 'Tous', icon: null },
              { id: 'movie', label: 'Films', icon: Film },
              { id: 'tv', label: 'Séries', icon: Tv },
            ].map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={`type_${tab.id}`}
                  type="button"
                  onClick={() => {
                    setSelectedMediaType(tab.id as any);
                    if (query.trim()) performSearch(query);
                  }}
                  className={cn(
                    "px-2.5 py-1 rounded-md font-bold transition-all flex items-center gap-1 cursor-pointer",
                    selectedMediaType === tab.id
                      ? "bg-zinc-800 text-[#E5A93D] shadow-sm"
                      : "text-zinc-400 hover:text-zinc-200"
                  )}
                >
                  {Icon && <Icon size={12} />}
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Qualités & Tris */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-zinc-500 font-bold uppercase">Qualité :</span>
              {['all', '2160p', '1080p', '720p'].map(q => (
                <button
                  key={`q_${q}`}
                  type="button"
                  onClick={() => setSelectedQuality(q)}
                  className={cn(
                    "px-2 py-0.5 rounded-md text-[10px] font-bold border transition-colors cursor-pointer",
                    selectedQuality === q
                      ? "bg-blue-600 text-white border-blue-500"
                      : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:bg-zinc-800"
                  )}
                >
                  {q === 'all' ? 'Toutes' : q === '2160p' ? '4K' : q}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1">
              <span className="text-[10px] text-zinc-500 font-bold uppercase">Tri :</span>
              {[
                { id: 'seeders', label: 'Seeders' },
                { id: 'size', label: 'Taille' },
              ].map(s => (
                <button
                  key={`sort_${s.id}`}
                  type="button"
                  onClick={() => setSortBy(s.id as any)}
                  className={cn(
                    "px-2 py-0.5 rounded-md text-[10px] font-bold border transition-colors cursor-pointer",
                    sortBy === s.id
                      ? "bg-blue-600 text-white border-blue-500"
                      : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:bg-zinc-800"
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Liste des résultats */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5 pb-24">
        {/* Bandeau de téléchargement actif si un téléchargement est en cours */}
        {downloads.length > 0 && (
          <div className="mb-3">
            <LiveDownloadBanner items={downloads} />
          </div>
        )}

        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center gap-3 text-zinc-400">
            <Loader2 size={32} className="animate-spin text-[#E5A93D]" />
            <p className="text-xs font-bold text-zinc-300">Recherche sur le tracker C411...</p>
          </div>
        ) : filteredTorrents.length > 0 ? (
          filteredTorrents.map((t) => {
            const isSending = downloadingId === t.id;
            const isCopied = copiedHash === t.infoHash;

            return (
              <div
                key={`torrent_${t.id}`}
                className="bg-zinc-900/80 hover:bg-zinc-900 border border-white/10 hover:border-white/20 rounded-2xl p-3.5 transition-all flex flex-col gap-3 shadow-md backdrop-blur-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h4 className="text-xs sm:text-sm font-bold text-white leading-snug break-words">
                      {t.name}
                    </h4>

                    <div className="flex items-center gap-2 mt-2 flex-wrap text-xs">
                      {t.quality && (
                        <span className="px-2 py-0.5 rounded-md bg-blue-500/15 border border-blue-500/30 text-blue-400 font-extrabold text-[10px]">
                          {t.quality}
                        </span>
                      )}
                      {t.language && (
                        <span className="px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-300 text-[10px] font-bold border border-white/5">
                          {t.language}
                        </span>
                      )}
                      <span className="text-[11px] font-semibold text-zinc-300 flex items-center gap-1">
                        <HardDrive size={12} className="text-zinc-500" />
                        {formatTorrentSize(t.size)}
                      </span>
                      <span className="text-[11px] font-black text-emerald-400 flex items-center gap-1 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20">
                        <Radio size={12} />
                        {t.seeders} seed{t.seeders > 1 ? 's' : ''}
                      </span>
                      {t.isFreeleech && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[9px] font-black uppercase">
                          FreeLeech
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-between pt-2 border-t border-white/5 gap-2">
                  <button
                    type="button"
                    onClick={() => handleCopyMagnet(t)}
                    className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:scale-95 text-zinc-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
                    title="Copier le lien Magnet"
                  >
                    {isCopied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                    <span>{isCopied ? 'Copié !' : 'Magnet'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSendToClient(t)}
                    disabled={isSending}
                    className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-95 text-white text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50 shadow-sm"
                  >
                    {isSending ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        <span>Envoi...</span>
                      </>
                    ) : (
                      <>
                        <Server size={14} />
                        <span>{hasConfiguredClient ? 'Envoyer au serveur' : 'Télécharger'}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })
        ) : hasSearched ? (
          <div className="py-16 px-4 flex flex-col items-center justify-center gap-3 text-center text-zinc-400">
            <div className="w-14 h-14 rounded-3xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-500 shadow-lg">
              <AlertCircle size={26} className="text-amber-400/80" />
            </div>
            <h3 className="text-sm font-bold text-zinc-200">Aucun résultat trouvé</h3>
            <p className="text-xs text-zinc-400 max-w-xs leading-relaxed">
              Essayez de simplifier votre recherche (retirez l'année ou les caractères spéciaux) ou changez les filtres de qualité.
            </p>
          </div>
        ) : (
          <div className="py-20 flex flex-col items-center justify-center text-center p-6 text-zinc-500">
            <div className="w-16 h-16 rounded-3xl bg-zinc-900 border border-white/5 flex items-center justify-center text-zinc-600 mb-4 shadow-xl">
              <Search size={28} />
            </div>
            <h3 className="text-sm font-bold text-zinc-300 mb-1">Recherche libre</h3>
            <p className="text-xs text-zinc-500 max-w-xs leading-relaxed">
              Tapez le nom d'un contenu dans la barre de recherche ci-dessus pour parcourir les releases et les envoyer en 1 clic à vos serveurs.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
