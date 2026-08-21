import { useState, useMemo, useEffect } from 'react';
import { useShows } from '../hooks/useShows';
import { type Show } from '../types';
import { CheckCircle2, Clock, RotateCcw, AlertCircle } from 'lucide-react';
import { tmdb } from '../features/shows/tmdb';
import { getFormattedProviderLogo } from '../utils/providerLogos';
import { useToastStore } from '../store/toastStore';
import { cn, scrollAllCarouselsToStart } from '../lib/utils';

interface HistoryItem {
  showId: string;
  tmdbId?: number;
  showTitle: string;
  showPoster?: string;
  showNetworks?: Show['networks'];
  mediaType?: 'tv' | 'movie';
  season: number;
  episode: number;
  episodeTitle?: string;
  watchedAt: number;
}

function normalizeTimestamp(val: any): number {
  if (!val) return Date.now();
  if (typeof val === 'number') {
    if (isNaN(val) || val <= 0) return Date.now();
    return val < 10000000000 ? val * 1000 : val;
  }
  const num = Number(val);
  if (!isNaN(num) && num > 0) {
    return num < 10000000000 ? num * 1000 : num;
  }
  const parsed = Date.parse(val);
  return isNaN(parsed) || parsed <= 0 ? Date.now() : parsed;
}

function HistoryRowItem({
  item,
  idx,
  epTitle,
  onShowClick,
  onEpisodeClick,
  setUnseenModalItem
}: {
  key?: string;
  item: HistoryItem;
  idx: number;
  epTitle?: string;
  onShowClick?: (id: string, mediaType?: 'tv' | 'movie') => void;
  onEpisodeClick?: (showId: string, season: number, episode: number) => void;
  setUnseenModalItem: (item: HistoryItem) => void;
}) {
  const [providerLogo, setProviderLogo] = useState<string | null>(null);
  const [providerName, setProviderName] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    if (item.tmdbId) {
      tmdb.getWatchProviders(item.tmdbId, item.mediaType === 'movie' ? 'movie' : 'tv').then(res => {
        if (isMounted && res.ok && res.value?.results) {
          const fr = res.value.results.FR || res.value.results.US || res.value.results.BE || res.value.results.CH || res.value.results.CA || Object.values(res.value.results)[0];
          const topProv = fr?.flatrate?.[0] || fr?.free?.[0] || fr?.ads?.[0] || fr?.buy?.[0] || fr?.rent?.[0];
          if (topProv?.logo_path) {
            setProviderLogo(topProv.logo_path);
            if (topProv.provider_name) setProviderName(topProv.provider_name);
          }
        }
      }).catch(() => {});
    }
    return () => { isMounted = false; };
  }, [item.tmdbId, item.mediaType]);

  const networkLogo = getFormattedProviderLogo(
    providerLogo || (item.showNetworks && item.showNetworks.length > 0 ? item.showNetworks[0].logo_path : null),
    providerName || (item.showNetworks && item.showNetworks.length > 0 ? item.showNetworks[0].name : null)
  );

  const handleRowClick = () => {
    if (item.mediaType === 'movie') {
      if (onShowClick) onShowClick(item.showId, 'movie');
    } else {
      if (onEpisodeClick) {
        onEpisodeClick(item.showId, item.season, item.episode);
      } else if (onShowClick) {
        onShowClick(item.showId, item.mediaType);
      }
    }
  };

  return (
    <div 
      key={`${item.showId}-${item.season}x${item.episode}-${idx}`} 
      onClick={handleRowClick}
      className="w-full flex items-stretch justify-between gap-3 bg-zinc-900/60 hover:bg-zinc-900/80 rounded-2xl overflow-hidden relative isolate transition-all active:scale-[0.98] cursor-pointer mb-3 group shadow-xl"
    >
      {/* OVERLAY PREMIUM : Bordure interne parfaite + Effet lumière */}
      <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/10 group-hover:ring-white/20 shadow-[inset_0_1px_1px_rgba(255,255,255,0.12)] transition-all z-20" />
      <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br from-white/[0.04] to-transparent opacity-0 group-hover:opacity-100 transition-opacity z-10" />

      {networkLogo && (
        <div className="absolute top-0 right-0 z-30 bg-white/95 backdrop-blur-md w-7 h-7 rounded-bl-xl p-1 flex items-center justify-center shrink-0 shadow-sm pointer-events-none">
          <img src={networkLogo} alt="" className="w-5 h-5 object-contain rounded-[3px]" />
        </div>
      )}

      <div 
        onClick={(e) => { e.stopPropagation(); handleRowClick(); }}
        className="w-[60px] sm:w-[70px] shrink-0 bg-zinc-950 rounded-l-2xl overflow-hidden flex items-center justify-center relative z-20 cursor-pointer"
      >
        {Boolean(item.showPoster) && (
          <img loading="lazy" decoding="async" 
            src={item.showPoster!.startsWith('http') ? item.showPoster! : `https://image.tmdb.org/t/p/w200${item.showPoster}`} 
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" 
            alt="" 
          />
        )}
      </div>
      <div className="flex-1 min-w-0 py-3 px-0.5 flex flex-col justify-center relative z-20">
        <div className={cn("flex items-center gap-2 min-w-0", networkLogo ? "pr-12" : "pr-1")}>
          <h4 
            onClick={(e) => { e.stopPropagation(); handleRowClick(); }}
            className="text-[#E5A93D] font-extrabold text-xs sm:text-[13px] uppercase tracking-wider line-clamp-2 cursor-pointer hover:underline text-left leading-tight"
          >
            {item.showTitle}
          </h4>
        </div>
        {item.mediaType === 'movie' ? (
          <p className="text-white font-bold text-sm my-0.5 line-clamp-1">
            Film vu
          </p>
        ) : (
          <p className="text-white font-bold text-sm my-0.5 line-clamp-1 leading-snug">
            S{(item.season ?? 1).toString().padStart(2, '0')} | E{(item.episode ?? 1).toString().padStart(2, '0')}
            {epTitle ? ` • ${epTitle}` : ''}
          </p>
        )}
        <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
          <div className="flex items-center gap-1 text-emerald-400 text-xs font-semibold truncate">
            <Clock className="shrink-0" size={12} />
            <span className="truncate">Vu le {new Date(item.watchedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        </div>
      </div>
      <div className={cn("pr-3.5 flex items-center justify-center shrink-0 relative z-20", networkLogo && "pt-3.5")}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setUnseenModalItem(item);
          }}
          className="w-9 h-9 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 hover:bg-red-500/20 hover:border-red-500/40 hover:text-red-400 flex items-center justify-center transition-all cursor-pointer group/btn"
          title="Marquer comme non vu"
        >
          <CheckCircle2 size={18} className="group-hover/btn:hidden" />
          <RotateCcw size={18} className="hidden group-hover/btn:block" />
        </button>
      </div>
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
  const { showToast } = useToastStore();
  const [fetchedEpisodeTitles, setFetchedEpisodeTitles] = useState<Record<string, string>>({});
  const [unseenModalItem, setUnseenModalItem] = useState<HistoryItem | null>(null);

  const historyItems = useMemo(() => {
    if (!shows) return [];
    
    const items: HistoryItem[] = [];
    
    for (const show of shows) {
      if (!show.id) continue;

      const isMovie = show.mediaType === 'movie' || 
                      (show.seenEpisodes && show.seenEpisodes.includes('movie')) ||
                      (show.episodeRecords && 'movie' in show.episodeRecords);

      if (isMovie) {
        // Un film est considéré vu s'il possède la clé 'movie' dans seenEpisodes OU un horodatage dans episodeRecords['movie']
        const hasSeenFlag = Array.isArray(show.seenEpisodes) && show.seenEpisodes.includes('movie');
        const hasRecord = !!(show.episodeRecords && show.episodeRecords['movie']?.watchedAt);
        const isCompleted = show.status === 'completed';
        
        const isSeen = hasSeenFlag || hasRecord || (isCompleted && (!show.seenEpisodes || show.seenEpisodes.length === 0 || hasSeenFlag));
        if (isSeen) {
          const rawWatchedAt = (show.episodeRecords && show.episodeRecords['movie']?.watchedAt) ||
                            show.lastWatchedAt ||
                            show.updatedAt ||
                            show.createdAt;
          const watchedAt = normalizeTimestamp(rawWatchedAt);
          items.push({
            showId: show.id,
            tmdbId: show.tmdbId,
            showTitle: show.title,
            showPoster: show.posterPath || undefined,
            showNetworks: show.networks,
            mediaType: 'movie',
            season: 1,
            episode: 1,
            episodeTitle: 'Film',
            watchedAt
          });
        }
        continue;
      }

      const processedEpKeys = new Set<string>();

      if (show.episodeRecords) {
        for (const [epKey, record] of (Object.entries(show.episodeRecords) as Array<[string, { watchedAt?: number; episodeTitle?: string; name?: string; title?: string }]>) ) {
          if (!record.watchedAt) continue;

          const [s, e] = epKey.split('x').map(Number);
          if (isNaN(s) || isNaN(e)) continue;
          
          processedEpKeys.add(epKey);
          let episodeTitle = record.episodeTitle || record.name || record.title;
          if (!episodeTitle) {
            if (show.nextEpisodeToWatch && show.nextEpisodeToWatch.season_number === s && show.nextEpisodeToWatch.episode_number === e) {
              episodeTitle = show.nextEpisodeToWatch.name;
            } else if (show.nextEpisodeToAir && show.nextEpisodeToAir.season_number === s && show.nextEpisodeToAir.episode_number === e) {
              episodeTitle = show.nextEpisodeToAir.name;
            }
          }

          items.push({
            showId: show.id,
            tmdbId: show.tmdbId,
            showTitle: show.title,
            showPoster: show.posterPath || undefined,
            showNetworks: show.networks,
            mediaType: show.mediaType,
            season: s,
            episode: e,
            episodeTitle,
            watchedAt: normalizeTimestamp(record.watchedAt)
          });
        }
      }

      // Handle seenEpisodes that might not have full episodeRecords
      if (show.seenEpisodes && show.seenEpisodes.length > 0) {
        for (const epKey of show.seenEpisodes) {
          if (epKey === 'movie' || processedEpKeys.has(epKey)) continue;
          const [s, e] = epKey.split('x').map(Number);
          if (isNaN(s) || isNaN(e)) continue;
          items.push({
            showId: show.id,
            tmdbId: show.tmdbId,
            showTitle: show.title,
            showPoster: show.posterPath || undefined,
            showNetworks: show.networks,
            mediaType: show.mediaType,
            season: s,
            episode: e,
            episodeTitle: undefined,
            watchedAt: normalizeTimestamp(show.lastWatchedAt || show.updatedAt || show.createdAt)
          });
        }
      }
    }
    
    // Tri décroissant par date de visionnage. 
    // En cas d'égalité (ex: Import CSV), tri de secours par Saison puis Épisode décroissant.
    return items.sort((a, b) => {
      if (b.watchedAt !== a.watchedAt) {
        return b.watchedAt - a.watchedAt;
      }
      if (b.season !== a.season) {
        return b.season - a.season;
      }
      return b.episode - a.episode;
    });
  }, [shows]);

  const displayedItems = useMemo(() => {
    return historyItems.slice(0, page * itemsPerPage);
  }, [historyItems, page, itemsPerPage]);

  useEffect(() => {
    let isMounted = true;

    displayedItems.forEach(async (item) => {
      if (item.mediaType === 'movie') return;
      const key = `${item.tmdbId || item.showId}-${item.season}x${item.episode}`;
      if (item.episodeTitle || fetchedEpisodeTitles[key] || !item.tmdbId) return;

      const res = await tmdb.getEpisodeDetails(item.tmdbId, item.season, item.episode);
      if (isMounted && res.ok && res.value?.name) {
        setFetchedEpisodeTitles(prev => ({
          ...prev,
          [key]: res.value.name
        }));
      }
    });

    return () => {
      isMounted = false;
    };
  }, [displayedItems, fetchedEpisodeTitles]);

  const handleConfirmUnseen = async (item: HistoryItem) => {
    setUnseenModalItem(null);
    const targetShow = shows?.find(s => s.id === item.showId);
    if (!targetShow || !targetShow.id) return;

    const isMovie = item.mediaType === 'movie' || targetShow.mediaType === 'movie';
    const epKey = isMovie ? 'movie' : `${item.season}x${item.episode}`;
    const newSeenEpisodes = (targetShow.seenEpisodes || []).filter(k => k !== epKey && (isMovie ? k !== 'movie' : true));
    const newRecords = { ...(targetShow.episodeRecords || {}) };
    delete newRecords[epKey];
    if (isMovie) {
      delete newRecords['movie'];
    }

    let newLastWatchedAt: number | null = null;
    const remainingTimes = Object.values(newRecords)
      .map((r: any) => r?.watchedAt)
      .filter(Boolean);
    if (remainingTimes.length > 0) {
      newLastWatchedAt = Math.max(...(remainingTimes as number[]));
    }

    // Save previous state for undo capability
    const prevSeenEpisodes = targetShow.seenEpisodes || [];
    const prevEpisodeRecords = targetShow.episodeRecords || {};
    const prevStatus = targetShow.status;
    const prevLastWatchedAt = targetShow.lastWatchedAt || null;
    const prevNextEpisodeToWatch = targetShow.nextEpisodeToWatch || null;
    const prevIsArchived = targetShow.isArchived || false;

    let newNextEp = targetShow.nextEpisodeToWatch;
    let newStatus = targetShow.status;

    if (isMovie) {
      if (targetShow.status === 'completed') {
        newStatus = 'plan_to_watch';
      }
    } else {
      let epDetails: any = null;
      if (targetShow.seasonsCache && Array.isArray(targetShow.seasonsCache)) {
        const s = targetShow.seasonsCache.find((sc: any) => sc.season_number === item.season);
        if (s && Array.isArray(s.episodes)) {
          epDetails = s.episodes.find((e: any) => e.episode_number === item.episode);
        }
      }

      if (!epDetails && targetShow.tmdbId) {
        try {
          const res = await tmdb.getSeasonDetails(targetShow.tmdbId, item.season);
          if (res.ok && res.value?.episodes) {
            epDetails = res.value.episodes.find((e: any) => e.episode_number === item.episode);
          }
        } catch (e) {
          console.error('Error fetching ep in HistoryFeed:', e);
        }
      }

      newNextEp = {
        season_number: item.season,
        episode_number: item.episode,
        air_date: epDetails?.air_date || null,
        name: epDetails?.name || item.episodeTitle || null,
        still_path: epDetails?.still_path || null
      };
    }

    await updateShow(targetShow.id, {
      seenEpisodes: newSeenEpisodes,
      episodeRecords: newRecords,
      status: newStatus,
      lastWatchedAt: newLastWatchedAt,
      nextEpisodeToWatch: newNextEp,
      updatedAt: Date.now(),
      isSynced: false
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
        if (targetShow?.id) {
          await updateShow(targetShow.id, {
            seenEpisodes: prevSeenEpisodes,
            episodeRecords: prevEpisodeRecords,
            status: prevStatus,
            lastWatchedAt: prevLastWatchedAt,
            nextEpisodeToWatch: prevNextEpisodeToWatch,
            isArchived: prevIsArchived,
            updatedAt: Date.now(),
            isSynced: false
          });
          scrollAllCarouselsToStart();
        }
      }
    );
  };

  if (loading) {
    return <div className="py-20 flex justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" /></div>;
  }

  const hasMore = displayedItems.length < historyItems.length;

  return (
    <div className="space-y-3 pb-8">
      {historyItems.length === 0 && (
        <div className="py-20 text-center text-zinc-500 text-sm">
          Aucun historique de visionnage.
        </div>
      )}

      {displayedItems.map((item, idx) => {
        const itemKey = `${item.tmdbId || item.showId}-${item.season}x${item.episode}`;
        const epTitle = item.episodeTitle || fetchedEpisodeTitles[itemKey];

        return (
          <HistoryRowItem
            key={`${item.showId}-${item.season}x${item.episode}-${idx}`}
            item={item}
            idx={idx}
            epTitle={epTitle}
            onShowClick={onShowClick}
            onEpisodeClick={onEpisodeClick}
            setUnseenModalItem={setUnseenModalItem}
          />
        );
      })}

      {hasMore && (
        <button 
          onClick={() => setPage(p => p + 1)}
          className="w-full py-3 mt-4 bg-zinc-900 border border-white/5 rounded-xl text-xs font-bold text-zinc-400 hover:text-white transition-colors"
        >
          Charger plus
        </button>
      )}

      {/* Popup / Modal de confirmation de Retrait d'historique */}
      {unseenModalItem && (
        <div className="fixed inset-0 z-[110] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-zinc-900 border border-white/10 rounded-2xl p-5 max-w-sm w-full space-y-4 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 text-amber-400">
              <div className="w-10 h-10 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                <AlertCircle size={20} />
              </div>
              <h3 className="text-base font-bold text-white">Marquer comme non vu ?</h3>
            </div>
            
            <p className="text-zinc-300 text-xs sm:text-sm leading-relaxed">
              Voulez-vous vraiment retirer <strong className="text-white">{unseenModalItem.showTitle}</strong> {unseenModalItem.mediaType === 'movie' ? 'de vos films vus' : `(S${String(unseenModalItem.season).padStart(2, '0')}E${String(unseenModalItem.episode).padStart(2, '0')})`} de votre historique ?
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setUnseenModalItem(null)}
                className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold transition-colors cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => handleConfirmUnseen(unseenModalItem)}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition-colors shadow-lg shadow-red-600/30 cursor-pointer"
              >
                Oui, marquer non vu
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

