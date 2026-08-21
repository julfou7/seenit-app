import React, { useEffect, useState } from 'react';
import { collection, query, orderBy, getDocs, getDoc, doc, deleteDoc, setDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { X, Ban, CheckCircle, Sparkles, Calendar, Tv, Eye, Layers, Flag, Play, Clapperboard } from 'lucide-react';
import { useShowsStore } from '../store/showsStore';
import { tmdb } from '../features/shows/tmdb';
import { TrailerModal } from './TrailerModal';

export interface ShowNews {
  id: string;
  type: 'CANCELED' | 'RENEWED' | 'NEW_SEASON' | 'DATE_ANNOUNCED' | 'ENDED' | 'FINAL_SEASON';
  showId: string;
  showTitle: string;
  message: string;
  description?: string;
  createdAt: number;
}

export interface ShowNewsFeedProps {
  onNavigateToShow?: (showId: string) => void;
  onShowClick?: (showId: string) => void;
}

export function ShowNewsFeed({ onNavigateToShow, onShowClick }: ShowNewsFeedProps) {
  const [currentUser, setCurrentUser] = useState(auth.currentUser);
  const [news, setNews] = useState<ShowNews[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const [readNewsIds, setReadNewsIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('read_news_ids') || localStorage.getItem('dismissed_news');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [selectedNews, setSelectedNews] = useState<ShowNews | null>(null);
  const [newsTrailerVideos, setNewsTrailerVideos] = useState<any[] | null>(null);
  const [trailerModalOpen, setTrailerModalOpen] = useState<boolean>(false);

  // Sync auth state
  useEffect(() => {
    const unsub = auth.onAuthStateChanged((u) => setCurrentUser(u));
    return () => unsub();
  }, []);

  // Sync dismissed news preferences from Firestore so items never reappear across devices
  useEffect(() => {
    if (!currentUser) return;
    const prefRef = doc(db, 'users', currentUser.uid, 'settings', 'news_preferences');
    getDoc(prefRef).then((snap) => {
      if (snap.exists()) {
        const firestoreReadIds = snap.data()?.readNewsIds;
        if (Array.isArray(firestoreReadIds)) {
          setReadNewsIds((prev) => {
            const merged = Array.from(new Set([...prev, ...firestoreReadIds]));
            try {
              localStorage.setItem('read_news_ids', JSON.stringify(merged));
              localStorage.setItem('dismissed_news', JSON.stringify(merged));
            } catch {}
            return merged;
          });
        }
      }
    }).catch((err) => {
      console.warn('News preferences fetch error:', err);
    });
  }, [currentUser]);

  useEffect(() => {
    if (selectedNews) {
      setNewsTrailerVideos(null);
      const showDetails = getShowDetails(selectedNews);
      if (showDetails?.tmdbId) {
        let seasonMatch = (selectedNews.message + ' ' + (selectedNews.description || '')).match(/saison\s*(\d+)/i);
        let seasonNum = seasonMatch ? parseInt(seasonMatch[1], 10) : null;
        
        const fetchTrailer = async () => {
          if (seasonNum) {
            const sRes = await tmdb.getSeasonDetails(showDetails.tmdbId, seasonNum);
            if (sRes.ok) {
              const ytVideos = sRes.value.videos?.results?.filter((v: any) => v.site === 'YouTube') || [];
              if (ytVideos.length > 0) {
                setNewsTrailerVideos(ytVideos);
                return;
              }
            }
          }
          const res = await tmdb.getShowDetails(showDetails.tmdbId);
          if (res.ok) {
            const ytVideos = res.value.videos?.results?.filter((v: any) => v.site === 'YouTube') || [];
            if (ytVideos.length > 0) {
              setNewsTrailerVideos(ytVideos);
            }
          }
        };
        fetchTrailer();
      }
    } else {
      setNewsTrailerVideos(null);
      setTrailerModalOpen(false);
    }
  }, [selectedNews]);

  const shows = useShowsStore((state) => state.shows);

  const getShowDetails = (newsItem: ShowNews) => {
    // 1. Find matched show
    let show = shows.find(s => s.id === newsItem.showId || s.tmdbId.toString() === newsItem.showId);
    
    // 2. Fallbacks for demo news
    if (!show) {
      if (newsItem.id === 'demo1') {
        return {
          tmdbId: 1899,
          title: '1899',
          posterPath: '/g8v1z99vQnK7f0E4g20y6h7e0E4.jpg',
          statusText: 'Non suivie',
          status: null,
          seenCount: 0,
          total: 8,
          progressPercent: 0,
          totalSeasons: 1,
          networks: [{ name: 'Netflix', logo_path: '/wwemzKWzjKYJFfCeiREv9g7fhwh.png' }]
        };
      }
      if (newsItem.id === 'demo2') {
        return {
          tmdbId: 130971,
          title: 'The Night Agent',
          posterPath: '/9zA80D26p66AonS28K9Z8YgWf5T.jpg',
          statusText: 'En cours',
          status: 'watching',
          seenCount: 8,
          total: 10,
          progressPercent: 80,
          totalSeasons: 3,
          networks: [{ name: 'Netflix', logo_path: '/wwemzKWzjKYJFfCeiREv9g7fhwh.png' }]
        };
      }
      if (newsItem.id === 'demo3') {
        return {
          tmdbId: 91363,
          title: 'Mobland',
          posterPath: '/o6p7vshN5N0a09bTj3A0T6p9BAt.jpg',
          statusText: 'Non suivie',
          status: null,
          seenCount: 0,
          total: 0,
          progressPercent: 0,
          totalSeasons: 2,
          networks: []
        };
      }
      if (newsItem.id === 'demo4') {
        return {
          tmdbId: 58514,
          title: 'Falco',
          posterPath: '/qoflFInrKqC3XG96w3u6uW9E6p6.jpg',
          statusText: 'Terminée',
          status: 'completed',
          seenCount: 30,
          total: 30,
          progressPercent: 100,
          totalSeasons: 4,
          networks: [{ name: 'TF1', logo_path: null }]
        };
      }
      if (newsItem.id === 'demo5') {
        return {
          tmdbId: 66732,
          title: 'Stranger Things',
          posterPath: '/49WJfeN0mhmg696XgGQv83g6v6V.jpg',
          statusText: 'En cours',
          status: 'watching',
          seenCount: 34,
          total: 42,
          progressPercent: 80,
          totalSeasons: 5,
          networks: [{ name: 'Netflix', logo_path: '/wwemzKWzjKYJFfCeiREv9g7fhwh.png' }]
        };
      }
      return null;
    }

    // 3. For actual local shows
    const total = show.totalEpisodes || show.totalAiredEpisodes || 0;
    const seenCount = show.seenEpisodes?.length || 0;
    const progressPercent = total > 0 ? Math.round((seenCount / total) * 100) : 0;
    const totalSeasons = (show as any).numberOfSeasons 
      || (show as any).seasonsCount 
      || (show as any).totalSeasons 
      || (show.nextEpisodeToAir?.season_number) 
      || undefined;

    let statusText = 'Suivie';
    let trackingStatus: string = show.status;

    if (show.isArchived) {
      statusText = 'Archivée';
      trackingStatus = 'archived';
    } else if (show.status === 'watching') {
      statusText = 'En cours';
    } else if (show.status === 'completed') {
      statusText = 'Terminée';
    } else if (show.status === 'plan_to_watch') {
      statusText = 'À voir';
    } else if (show.status === 'dropped') {
      statusText = 'Abandonnée';
    } else if (show.status === 'Ended' || show.status === 'Canceled') {
      const isUpToDate = total > 0 && seenCount >= total;
      statusText = (isUpToDate || !show.nextEpisodeToWatch) ? 'Terminée' : 'En cours';
      trackingStatus = (isUpToDate || !show.nextEpisodeToWatch) ? 'completed' : 'watching';
    }

    return {
      tmdbId: show.tmdbId,
      title: show.title,
      posterPath: show.posterPath,
      status: trackingStatus,
      statusText,
      seenCount,
      total,
      progressPercent,
      totalSeasons,
      networks: show.networks || []
    };
  };

  const handleImageError = (id: string) => {
    setFailedImages((prev) => ({ ...prev, [id]: true }));
  };

  const markNewsAsRead = async (newsId: string) => {
    const updated = Array.from(new Set([...readNewsIds, newsId]));
    setReadNewsIds(updated);
    try {
      localStorage.setItem('read_news_ids', JSON.stringify(updated));
      localStorage.setItem('dismissed_news', JSON.stringify(updated));
    } catch (e) {
      console.error(e);
    }
    setSelectedNews(null);

    if (currentUser) {
      try {
        const prefRef = doc(db, 'users', currentUser.uid, 'settings', 'news_preferences');
        await setDoc(prefRef, { readNewsIds: updated }, { merge: true });
      } catch (e) {
        console.warn('Could not save read news IDs to Firestore:', e);
      }

      if (!newsId.startsWith('demo')) {
        try {
          await deleteDoc(doc(db, 'users', currentUser.uid, 'news', newsId));
        } catch (err) {
          console.error('Failed to delete news from Firestore:', err);
        }
      }
    }
  };

  useEffect(() => {
    if (!currentUser) {
      setNews([]);
      setHasLoaded(true);
      return;
    }
    const newsRef = collection(db, 'users', currentUser.uid, 'news');
    const q = query(newsRef, orderBy('createdAt', 'desc'));

    getDocs(q).then((snapshot) => {
      const newsData: ShowNews[] = [];
      snapshot.forEach((doc) => {
        newsData.push({ ...doc.data(), id: String(doc.id) } as ShowNews);
      });
      setNews(newsData);
      setHasLoaded(true);
    }).catch((err) => {
      console.warn('News fetch error:', err);
      setHasLoaded(true);
    });
  }, [currentUser]);

  const demoNews: ShowNews[] = [
    {
      id: 'demo4',
      type: 'ENDED',
      showId: 'falco',
      showTitle: 'Falco',
      message: 'La série s\'est officiellement achevée après 4 saisons.',
      description: 'Falco s\'est officiellement terminée sur TF1 après quatre saisons intenses, marquant la conclusion des enquêtes du lieutenant Alexandre Falco.',
      createdAt: Date.now() - 600000
    },
    {
      id: 'demo5',
      type: 'FINAL_SEASON',
      showId: 'stranger-things',
      showTitle: 'Stranger Things',
      message: 'La Saison 5 sera la dernière de la série !',
      description: 'Netflix et les créateurs de Stranger Things ont officiellement annoncé que la saison 5 sera l\'ultime saison et conclura l\'histoire d\'Eleven et du Monde à l\'Envers.',
      createdAt: Date.now() - 1200000
    },
    {
      id: 'demo1',
      type: 'CANCELED',
      showId: '1899',
      showTitle: '1899',
      message: 'La série est officiellement annulée par Netflix après une saison.',
      description: 'Netflix a officiellement décidé d’annuler la série 1899 créée par Baran bo Odar et Jantje Friese. Il n’y aura malheureusement pas de saison 2.',
      createdAt: Date.now() - 1800000
    },
    {
      id: 'demo2',
      type: 'NEW_SEASON',
      showId: '1',
      showTitle: 'The Night Agent',
      message: 'Saison 3 confirmée par Netflix !',
      description: 'La troisième saison de The Night Agent est déjà en préparation et a reçu le feu vert officiel.',
      createdAt: Date.now() - 2400000
    },
    {
      id: 'demo3',
      type: 'DATE_ANNOUNCED',
      showId: '2',
      showTitle: 'Mobland',
      message: 'La Saison 2 arrive le 18 septembre.',
      description: 'Rendez-vous le 18 septembre pour la suite des épisodes.',
      createdAt: Date.now() - 3000000
    }
  ];

  // Si l'utilisateur n'est pas connecté, ne rien afficher pour respecter la confidentialité des données
  if (!currentUser) return null;

  // Afficher les démos tant que ce n'est pas chargé, ou s'il n'y a pas de vraies news
  const rawNews = hasLoaded ? (news.length === 0 ? demoNews : news) : demoNews;
  const displayNews = rawNews.filter(n => !readNewsIds.includes(n.id));

  if (displayNews.length === 0) return null;

  const renderBadge = (type: string) => {
    switch (type) {
      case 'CANCELED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-950/70 border border-rose-500/30 text-rose-300 text-[9px] font-extrabold uppercase tracking-wider">
            <Ban size={10} />
            <span>NON RENOUVELÉE</span>
          </span>
        );
      case 'RENEWED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[9px] font-extrabold uppercase tracking-wider">
            <CheckCircle size={10} />
            <span>RENOUVELÉE</span>
          </span>
        );
      case 'NEW_SEASON':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-sky-500/10 border border-sky-500/20 text-sky-400 text-[9px] font-extrabold uppercase tracking-wider">
            <Sparkles size={10} />
            <span>NOUVELLE SAISON</span>
          </span>
        );
      case 'DATE_ANNOUNCED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-purple-500/10 border border-purple-500/20 text-purple-400 text-[9px] font-extrabold uppercase tracking-wider">
            <Calendar size={10} />
            <span>DATE ANNONCÉE</span>
          </span>
        );
      case 'ENDED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-500/15 border border-zinc-500/30 text-zinc-300 text-[9px] font-extrabold uppercase tracking-wider">
            <Flag size={10} className="text-[#E5A93D]" />
            <span>TERMINÉE</span>
          </span>
        );
      case 'FINAL_SEASON':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[9px] font-extrabold uppercase tracking-wider">
            <Sparkles size={10} className="text-amber-400" />
            <span>DERNIÈRE SAISON</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-500/10 border border-zinc-500/20 text-zinc-400 text-[9px] font-extrabold uppercase tracking-wider">
            <span>{type}</span>
          </span>
        );
    }
  };

  const getSeasonText = (newsItem: ShowNews, showDetails: any) => {
    let seasons = showDetails?.totalSeasons || showDetails?.numberOfSeasons;
    
    if (!seasons) {
      const match = (newsItem.message + ' ' + (newsItem.description || '')).match(/saison\s*(\d+)/i);
      if (match) {
        seasons = parseInt(match[1], 10);
      }
    }

    if (newsItem.type === 'FINAL_SEASON') {
      return seasons ? `Dernière saison : Saison ${seasons}` : 'Dernière saison';
    }
    if (newsItem.type === 'CANCELED' || newsItem.type === 'ENDED') {
      return seasons ? `S'arrête après ${seasons} saison${seasons > 1 ? 's' : ''}` : null;
    }
    if (newsItem.type === 'NEW_SEASON' || newsItem.type === 'DATE_ANNOUNCED') {
      return seasons ? `Saison ${seasons}` : null;
    }
    return seasons ? `${seasons} saison${seasons > 1 ? 's' : ''}` : null;
  };

  const handleNavigateOnly = (newsItem: ShowNews) => {
    setSelectedNews(null);
    if (typeof onNavigateToShow === 'function') {
      onNavigateToShow(newsItem.showId);
    } else if (typeof onShowClick === 'function') {
      onShowClick(newsItem.showId);
    }
  };

  return (
    <div className="mb-8">
      <h2 className="text-xl font-bold text-white tracking-tight mb-4 px-4 sm:px-6 flex items-center gap-2">
        <span className="text-lg">✨</span>
        <span>L'actualité de vos séries</span>
      </h2>
      <div className="flex overflow-x-auto gap-4 px-4 sm:px-6 scroll-px-4 sm:scroll-px-6 scrollbar-none hide-scrollbar snap-x snap-mandatory pb-4">
        {displayNews.map((newsItem) => {
          const showDetails = getShowDetails(newsItem);
          const seasonText = getSeasonText(newsItem, showDetails);
          const isImageFailed = failedImages[newsItem.id];
          const posterUrl = !isImageFailed && showDetails?.posterPath 
            ? (showDetails.posterPath.startsWith('http') ? showDetails.posterPath : `https://image.tmdb.org/t/p/w200${showDetails.posterPath}`)
            : null;

          return (
            <div 
              key={newsItem.id} 
              onClick={() => setSelectedNews(newsItem)}
              className="snap-start shrink-0 w-[280px] bg-zinc-900 rounded-2xl p-3 border border-white/5 hover:border-white/10 hover:bg-zinc-800/80 transition-all active:scale-[0.98] cursor-pointer flex gap-3 relative group"
            >
              <button 
                type="button"
                onClick={(e) => { e.stopPropagation(); markNewsAsRead(newsItem.id); }}
                className="absolute top-2 right-2 p-1 text-zinc-500 hover:text-white hover:bg-white/10 rounded-full transition-colors z-10"
                title="Masquer"
              >
                <X size={14} />
              </button>
              
              {/* Poster thumbnail */}
              <div className="w-14 aspect-[2/3] rounded-lg bg-zinc-950 flex items-center justify-center shrink-0 overflow-hidden border border-white/5 shadow-md">
                {posterUrl ? (
                  <img 
                    src={posterUrl} 
                    alt="" 
                    className="w-full h-full object-cover" 
                    referrerPolicy="no-referrer"
                    onError={() => handleImageError(newsItem.id)}
                  />
                ) : (
                  <Tv className="w-5 h-5 text-zinc-600" />
                )}
              </div>

              {/* Text info */}
              <div className="flex-1 min-w-0 pr-4 flex flex-col items-start justify-between py-0.5 text-left">
                <div className="flex flex-col items-start text-left w-full">
                  <div className="mb-1 flex justify-start items-center text-left">
                    {renderBadge(newsItem.type)}
                  </div>
                  <h3 className="text-white font-bold text-sm line-clamp-1 leading-tight text-left">{newsItem.showTitle}</h3>
                  {seasonText && (
                    <span className="text-[#E5A93D] text-[10px] font-semibold text-left line-clamp-1 mt-0.5">
                      {seasonText}
                    </span>
                  )}
                  <p className="text-zinc-400 text-[11px] line-clamp-2 leading-snug mt-0.5 text-left">{newsItem.message}</p>
                </div>
                {showDetails && showDetails.status !== null && (
                  <div className="text-[10px] text-zinc-300 font-medium mt-1.5 flex items-center gap-1.5 bg-zinc-800/80 border border-white/10 px-2 py-0.5 rounded-full w-fit text-left">
                    <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
                    <span>{showDetails.statusText} • {showDetails.seenCount}/{showDetails.total} ép.</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Mini-modal d'explication / Mini-fiche */}
      {selectedNews && (() => {
        const showDetails = getShowDetails(selectedNews);
        const seasonText = getSeasonText(selectedNews, showDetails);
        const isImageFailed = failedImages[selectedNews.id];
        const posterUrl = !isImageFailed && showDetails?.posterPath 
          ? (showDetails.posterPath.startsWith('http') ? showDetails.posterPath : `https://image.tmdb.org/t/p/w342${showDetails.posterPath}`)
          : null;

        return (
          <div 
            onClick={(e) => {
              if (e.target === e.currentTarget) setSelectedNews(null);
            }}
            className="fixed inset-0 bg-black/85 backdrop-blur-md z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200"
          >
            <div 
              onClick={(e) => e.stopPropagation()}
              className="bg-zinc-900 border border-white/10 w-full max-w-md rounded-3xl p-5 sm:p-6 shadow-2xl flex flex-col items-start text-left gap-4 max-h-[90vh] overflow-y-auto my-auto"
            >
              
              {/* Entête Mini-Fiche */}
              <div className="flex items-start justify-start text-left gap-4 w-full">
                {/* Poster principal */}
                <div className="w-20 sm:w-24 aspect-[2/3] rounded-2xl bg-zinc-950 flex items-center justify-center shrink-0 overflow-hidden border border-white/10 shadow-lg">
                  {posterUrl ? (
                    <img 
                      src={posterUrl} 
                      alt="" 
                      className="w-full h-full object-cover" 
                      referrerPolicy="no-referrer"
                      onError={() => handleImageError(selectedNews.id)}
                    />
                  ) : (
                    <Tv className="w-8 h-8 text-zinc-600" />
                  )}
                </div>

                {/* Infos principales de la série */}
                <div className="min-w-0 flex-1 flex flex-col items-start text-left gap-1.5 justify-start">
                  <div className="flex items-center justify-between gap-2 w-full">
                    <div className="flex flex-wrap gap-1 items-center justify-start">
                      {renderBadge(selectedNews.type)}
                    </div>
                    <button 
                      type="button"
                      onClick={() => setSelectedNews(null)}
                      className="w-7 h-7 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-white shrink-0 active:scale-95 transition-transform"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  <h3 
                    onClick={() => handleNavigateOnly(selectedNews)}
                    className="text-lg sm:text-xl font-bold text-white hover:text-[#E5A93D] cursor-pointer transition-colors break-words leading-tight text-left"
                    title="Ouvrir la fiche de la série"
                  >
                    {selectedNews.showTitle}
                  </h3>

                  {seasonText && (
                    <div className="text-xs font-bold text-[#E5A93D] text-left">
                      {seasonText}
                    </div>
                  )}

                  {/* Statut de suivi */}
                  {showDetails ? (
                    <div className="flex flex-wrap items-center justify-start gap-1.5 mt-0.5 text-left">
                      {showDetails.status ? (
                        <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-full bg-zinc-800/80 border border-white/10 text-zinc-300">
                          <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
                          {showDetails.statusText}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-full bg-zinc-800/80 border border-white/10 text-zinc-400">
                          Non suivie
                        </span>
                      )}

                      {/* Networks logos */}
                      {showDetails.networks && showDetails.networks.slice(0, 2).map((network: any, idx: number) => network.logo_path && (
                        <img 
                          key={idx}
                          src={`https://image.tmdb.org/t/p/w92${network.logo_path}`} 
                          alt={network.name} 
                          className="h-3.5 object-contain bg-zinc-950/50 p-0.5 rounded"
                          referrerPolicy="no-referrer"
                        />
                      ))}
                    </div>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-full bg-zinc-800/80 border border-white/10 text-zinc-400 text-left">
                      Non suivie
                    </span>
                  )}
                </div>
              </div>

              {/* Barre de progression d'avancement */}
              {showDetails && showDetails.status !== null && (
                <div className="w-full bg-zinc-950/40 p-3.5 rounded-2xl border border-white/5 flex flex-col items-start text-left">
                  <div className="flex items-center justify-between text-xs font-bold text-zinc-400 mb-2 w-full">
                    <span className="flex items-center gap-1.5 text-zinc-300">
                      <Layers size={13} className="text-[#E5A93D]" />
                      Progression
                    </span>
                    <span className="text-[#E5A93D]">
                      {showDetails.seenCount} / {showDetails.total} épisodes vus ({showDetails.progressPercent}%)
                    </span>
                  </div>
                  {/* Progress bar wrapper */}
                  <div className="h-2 w-full bg-zinc-800 rounded-full overflow-hidden">
                    {showDetails.total === 0 && showDetails.seenCount > 0 ? (
                      <div className="h-full w-full bg-zinc-700/50 animate-pulse rounded-full" />
                    ) : (
                      <div 
                        className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all duration-500 ease-out" 
                        style={{ width: `${showDetails.progressPercent}%` }}
                      />
                    )}
                  </div>
                </div>
              )}

              {/* Corps du mini-article (Actualité) */}
              <div className="w-full text-xs sm:text-sm text-zinc-300 leading-relaxed bg-zinc-950/50 p-3.5 sm:p-4 rounded-2xl border border-white/5 overflow-y-auto max-h-48 text-left flex flex-col items-start">
                <p className="font-bold text-white mb-1.5 flex items-center gap-1.5 text-xs text-left">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#E5A93D]" />
                  Mise à jour de l'actualité :
                </p>
                {seasonText && (
                  <div className="mb-2 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-semibold">
                    {seasonText}
                  </div>
                )}
                <p className="text-zinc-300 text-left">
                  {selectedNews.description || selectedNews.message || (
                    selectedNews.type === 'CANCELED' ? "La production a officiellement arrêté cette série. Il n'y aura malheureusement pas de nouveaux épisodes." :
                    selectedNews.type === 'RENEWED' ? "Bonne nouvelle ! La série a été officiellement renouvelée pour une nouvelle saison." :
                    selectedNews.type === 'NEW_SEASON' ? "Une nouvelle saison se prépare ou a été annoncée pour cette série." :
                    selectedNews.type === 'DATE_ANNOUNCED' ? "La date de diffusion de la nouvelle saison a été officiellement annoncée !" :
                    "Du nouveau pour cette série !"
                  )}
                </p>
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-2.5 mt-1 w-full">
                {newsTrailerVideos && newsTrailerVideos.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setTrailerModalOpen(true)}
                    className="w-full h-12 px-4 rounded-2xl font-bold bg-gradient-to-r from-amber-500 via-amber-400 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 active:scale-[0.98] text-black shadow-lg shadow-amber-500/25 text-xs sm:text-sm transition-all cursor-pointer touch-manipulation flex items-center justify-center gap-2"
                  >
                    <Clapperboard size={18} className="stroke-[2.5]" />
                    Voir la bande-annonce
                  </button>
                )}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full">
                  <button
                    type="button"
                    onClick={() => handleNavigateOnly(selectedNews)}
                    className="flex-1 h-12 px-4 rounded-2xl font-bold bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-700 text-white border border-white/10 text-xs sm:text-sm transition-colors cursor-pointer touch-manipulation flex items-center justify-center gap-1.5"
                  >
                    <Eye size={15} />
                    Voir la fiche
                  </button>

                  <button
                    type="button"
                    onClick={() => markNewsAsRead(selectedNews.id)}
                    className="flex-1 h-12 px-4 rounded-2xl font-bold bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-700 text-white border border-white/10 text-xs sm:text-sm transition-colors cursor-pointer touch-manipulation flex items-center justify-center gap-1.5"
                  >
                    J'ai compris / Masquer
                  </button>
                </div>
              </div>

            </div>
          </div>
        );
      })()}
      {trailerModalOpen && newsTrailerVideos && newsTrailerVideos.length > 0 && (
        <TrailerModal
          videos={newsTrailerVideos}
          onClose={() => setTrailerModalOpen(false)}
        />
      )}
    </div>
  );
}

