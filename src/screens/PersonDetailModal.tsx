import React, { useEffect, useState, useRef } from 'react';
import { tmdb, type TMDBMedia } from '../features/shows/tmdb';

import { ChevronLeft, X, Heart, Check, Clock, Film, Loader2 } from 'lucide-react';
import { cn, checkIsUpToDate } from '../lib/utils';
import { useFavoritePeopleStore } from '../store/favoritePeopleStore';
import { GridMediaCard, QuickPreviewModal } from '../components/GridMediaCard';
import { useShows } from '../hooks/useShows';
import { useToastStore } from '../store/toastStore';
import { type Show } from '../types';
import { isShowWatched } from '../hooks/useProAnalytics';

interface Props {
  personId: number;
  onClose: () => void;
  onShowClick: (tmdbId: number, mediaType?: 'tv' | 'movie') => void;
}

const getAge = (birthday: string, deathday?: string) => {
  const birthDate = new Date(birthday);
  const endDate = deathday ? new Date(deathday) : new Date();
  let age = endDate.getFullYear() - birthDate.getFullYear();
  const m = endDate.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && endDate.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
};

const ASIAN_LANGUAGES = ['ja', 'ko', 'zh', 'cn', 'th', 'hi', 'ta', 'te'];

const jobPriority = (job: string) => {
  const j = (job || '').toLowerCase();
  if (j.includes('director') || j.includes('réalisateur')) return 1;
  if (j.includes('creator') || j.includes('créateur')) return 2;
  if (j.includes('writer') || j.includes('screenplay') || j.includes('scénariste') || j.includes('story')) return 3;
  if (j.includes('producer') || j.includes('producteur')) return 4;
  return 5;
};

const translateJob = (job: string) => {
  const map: Record<string, string> = {
    'Director': 'Réalisateur',
    'Writer': 'Scénariste',
    'Screenplay': 'Scénariste',
    'Story': 'Histoire originale',
    'Producer': 'Producteur',
    'Executive Producer': 'Producteur exécutif',
    'Creator': 'Créateur',
    'Author': 'Auteur',
    'Novel': 'Roman',
    'Co-Director': 'Co-réalisateur',
    'Original Concept': 'Concept original'
  };
  return map[job] || job;
};

function deduplicateAndSortCredits(rawList: any[], type: 'cast' | 'crew') {
  if (!Array.isArray(rawList)) return [];

  const map = new Map<string, any>();

  for (const item of rawList) {
    if (!item || !item.id) continue;
    
    const lang = item.original_language;
    if (lang && ASIAN_LANGUAGES.includes(lang)) {
      const pop = item.popularity || 0;
      const vote = item.vote_average || 0;
      const count = item.vote_count || 0;
      if (!(pop >= 35 || (vote >= 7.8 && count >= 100))) {
        continue;
      }
    }

    const mediaType = item.media_type || (item.first_air_date !== undefined ? 'tv' : 'movie');
    const key = `${item.id}_${mediaType}`;

    if (!map.has(key)) {
      const clone = { ...item, media_type: mediaType };
      if (type === 'crew') {
        clone.rawJobs = item.job ? [item.job] : [];
        clone.job = item.job ? translateJob(item.job) : '';
      } else {
        clone.rawCharacters = item.character ? [item.character] : [];
        clone.character = item.character || '';
      }
      map.set(key, clone);
    } else {
      const existing = map.get(key);
      if (type === 'crew') {
        if (item.job && !existing.rawJobs.includes(item.job)) {
          existing.rawJobs.push(item.job);
          existing.rawJobs.sort((a: string, b: string) => jobPriority(a) - jobPriority(b));
          existing.job = existing.rawJobs.map(translateJob).join(', ');
        }
      } else {
        if (item.character && !existing.rawCharacters.includes(item.character)) {
          existing.rawCharacters.push(item.character);
          existing.character = existing.rawCharacters.join(' / ');
        }
      }
      if (!existing.poster_path && item.poster_path) existing.poster_path = item.poster_path;
      if (!existing.vote_average && item.vote_average) existing.vote_average = item.vote_average;
    }
  }

  return Array.from(map.values()).sort((a: any, b: any) => {
    const dateA = new Date(a.release_date || a.first_air_date || '1900-01-01').getTime();
    const dateB = new Date(b.release_date || b.first_air_date || '1900-01-01').getTime();
    return dateB - dateA;
  });
}

async function translateToFrench(text: string): Promise<string> {
  if (!text || !text.trim()) return text;
  
  const lower = text.toLowerCase();
  const englishWords = [' born ', ' is an ', ' was an ', ' actor ', ' actress ', ' known for ', ' career ', ' signed ', ' american '];
  const isEnglish = englishWords.some(w => lower.includes(w)) || (!lower.includes(' né ') && !lower.includes(' née ') && !lower.includes(' est un ') && !lower.includes(' est une '));

  if (!isEnglish) return text;

  try {
    const paragraphs = text.split('\n\n');
    const translated: string[] = [];

    for (const para of paragraphs) {
      if (!para.trim()) continue;
      const cleanPara = para.trim();
      if (cleanPara.length <= 450) {
        const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(cleanPara)}&langpair=en|fr`);
        const json = await res.json();
        if (json?.responseData?.translatedText && !json.responseData.translatedText.includes('MYMEMORY WARNING')) {
          translated.push(json.responseData.translatedText);
        } else {
          translated.push(cleanPara);
        }
      } else {
        const sentences = cleanPara.match(/[^.!?]+[.!?]+/g) || [cleanPara];
        let currentChunk = '';
        let chunkTrans = '';

        for (const sentence of sentences) {
          if ((currentChunk + sentence).length < 450) {
            currentChunk += sentence;
          } else {
            if (currentChunk) {
              const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(currentChunk)}&langpair=en|fr`);
              const json = await res.json();
              const t = json?.responseData?.translatedText;
              chunkTrans += (t && !t.includes('MYMEMORY WARNING') ? t : currentChunk) + ' ';
            }
            currentChunk = sentence;
          }
        }
        if (currentChunk) {
          const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(currentChunk)}&langpair=en|fr`);
          const json = await res.json();
          const t = json?.responseData?.translatedText;
          chunkTrans += (t && !t.includes('MYMEMORY WARNING') ? t : currentChunk);
        }
        translated.push(chunkTrans.trim());
      }
    }
    return translated.join('\n\n');
  } catch (e) {
    return text;
  }
}

export function PersonDetailModal({ personId, onClose, onShowClick }: Props) {
  const [isExiting, setIsExiting] = useState(false);
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const startXRef = useRef<number | null>(null);
  const startYRef = useRef<number | null>(null);
  const isEdgeSwipeRef = useRef<boolean>(false);
  const isHorizontalSwipeRef = useRef<boolean | null>(null);

  const handleAnimatedClose = () => {
    if (isExiting) return;
    setIsExiting(true);
    setTimeout(() => {
      onClose();
    }, 280);
  };



  const [person, setPerson] = useState<any>(null);
  const [credits, setCredits] = useState<any>(null);
  const [bioExpanded, setBioExpanded] = useState(false);
  const [isTranslatingBio, setIsTranslatingBio] = useState(false);
  const [activeTab, setActiveTab] = useState<'cast' | 'directing' | 'crew'>('cast');
  const [statusFilter, setStatusFilter] = useState<'all' | 'watched' | 'unwatched'>('all');
  const [previewMedia, setPreviewMedia] = useState<TMDBMedia | null>(null);

  const favPeopleStore = useFavoritePeopleStore();
  const { shows, addShow, updateShow, deleteShow } = useShows();
  const { showToast } = useToastStore();

  useEffect(() => {
    const handleCloseAll = () => {
      onClose();
    };
    window.addEventListener('app-close-modals', handleCloseAll);
    return () => window.removeEventListener('app-close-modals', handleCloseAll);
  }, [onClose]);

  const showsByTmdbId = React.useMemo(() => {
    const map = new Map<number, Show>();
    shows.forEach(s => {
      if (s.tmdbId) map.set(Number(s.tmdbId), s);
    });
    return map;
  }, [shows]);

  const castCredits = React.useMemo(() => {
    return deduplicateAndSortCredits(credits?.cast || [], 'cast');
  }, [credits]);

  const crewCredits = React.useMemo(() => {
    return deduplicateAndSortCredits(credits?.crew || [], 'crew');
  }, [credits]);

  const isDirectingJob = (job: string) => {
    const j = (job || '').toLowerCase();
    return j.includes('director') || j.includes('réalisat') || j.includes('creator') || j.includes('créat') || j === 'showrunner';
  };

  const directingCredits = React.useMemo(() => {
    return crewCredits.filter((item: any) => 
      Array.isArray(item.rawJobs) && item.rawJobs.some(isDirectingJob)
    );
  }, [crewCredits]);

  const otherCrewCredits = React.useMemo(() => {
    return crewCredits.filter((item: any) => 
      !Array.isArray(item.rawJobs) || !item.rawJobs.some(isDirectingJob)
    );
  }, [crewCredits]);

  // Set intelligent default tab when person loads
  useEffect(() => {
    if (person?.known_for_department) {
      if (person.known_for_department === 'Directing') {
        setActiveTab('directing');
      } else if (person.known_for_department === 'Writing' || person.known_for_department === 'Production') {
        setActiveTab('crew');
      } else {
        setActiveTab('cast');
      }
    }
  }, [person?.known_for_department]);

  // Fallback tab switch if active tab is empty but other has items
  useEffect(() => {
    if (activeTab === 'directing' && directingCredits.length === 0) {
      if (otherCrewCredits.length > 0) setActiveTab('crew');
      else if (castCredits.length > 0) setActiveTab('cast');
    } else if (activeTab === 'cast' && castCredits.length === 0) {
      if (directingCredits.length > 0) setActiveTab('directing');
      else if (otherCrewCredits.length > 0 || crewCredits.length > 0) setActiveTab('crew');
    } else if (activeTab === 'crew' && (person?.known_for_department === 'Directing' ? otherCrewCredits.length === 0 : crewCredits.length === 0)) {
      if (directingCredits.length > 0) setActiveTab('directing');
      else if (castCredits.length > 0) setActiveTab('cast');
    }
  }, [activeTab, castCredits.length, directingCredits.length, otherCrewCredits.length, crewCredits.length, person?.known_for_department]);

  const handleAddClick = async (media: TMDBMedia) => {
    const isTv = media.media_type === 'tv' || (!media.media_type && media.first_air_date !== undefined);
    const title = media.name || media.title || '';
    const newShowData = {
      tmdbId: Number(media.id),
      title,
      posterPath: media.poster_path || '',
      backdropPath: media.backdrop_path || '',
      year: (media.first_air_date || media.release_date || '').substring(0, 4),
      rating: media.vote_average ? parseFloat(media.vote_average.toFixed(1)) : undefined,
      mediaType: isTv ? 'tv' : 'movie' as 'tv' | 'movie',
      seasonRecords: {},
      episodeRecords: {},
      status: 'watching' as const,
      updatedAt: Date.now(),
      createdAt: Date.now(),
      seenEpisodes: [],
      isArchived: false,
    };
    const newId = await addShow(newShowData);
    const savedShow = { ...newShowData, id: newId, userId: '' } as Show;
    showToast(
      isTv ? 'Série ajoutée à votre suivi' : 'Film ajouté à votre liste',
      'follow',
      savedShow,
      async () => {
        if (newId) await deleteShow(newId);
      }
    );
  };

  const handleToggleWatched = async (media: TMDBMedia) => {
    const existingShow = showsByTmdbId.get(Number(media.id));
    const isTv = media.media_type === 'tv' || (!media.media_type && media.first_air_date !== undefined);
    if (existingShow) {
      if (!isTv) {
        const isSeen = existingShow.status === 'completed' || existingShow.seenEpisodes?.includes('movie');
        const oldStatus = existingShow.status;
        const oldSeen = existingShow.seenEpisodes || [];
        if (isSeen) {
          await updateShow(existingShow.id, {
            status: 'watching',
            seenEpisodes: []
          });
          showToast(
            `« ${existingShow.title} » marqué comme à voir`, 
            'unfollow', 
            existingShow,
            async () => {
              await updateShow(existingShow.id, { status: oldStatus, seenEpisodes: oldSeen });
            }
          );
        } else {
          await updateShow(existingShow.id, {
            status: 'completed',
            seenEpisodes: ['movie']
          });
          showToast(
            `« ${existingShow.title} » marqué comme vu !`, 
            'success', 
            existingShow,
            async () => {
              await updateShow(existingShow.id, { status: oldStatus, seenEpisodes: oldSeen });
            }
          );
        }
      } else {
        const isUpToDate = checkIsUpToDate(existingShow);
        const oldStatus = existingShow.status;
        if (isUpToDate) {
          await updateShow(existingShow.id, {
            status: 'watching',
            seenEpisodes: []
          });
          showToast(
            `« ${existingShow.title} » réinitialisée`, 
            'unfollow', 
            existingShow,
            async () => {
              await updateShow(existingShow.id, { status: oldStatus });
            }
          );
        } else {
          await updateShow(existingShow.id, {
            status: 'up_to_date'
          });
          showToast(
            `« ${existingShow.title} » marquée à jour`, 
            'success', 
            existingShow,
            async () => {
              await updateShow(existingShow.id, { status: oldStatus });
            }
          );
        }
      }
    } else {
      const title = media.name || media.title || '';
      const newShowData = {
        tmdbId: Number(media.id),
        title,
        posterPath: media.poster_path || '',
        backdropPath: media.backdrop_path || '',
        year: (media.first_air_date || media.release_date || '').substring(0, 4),
        rating: media.vote_average ? parseFloat(media.vote_average.toFixed(1)) : undefined,
        mediaType: isTv ? 'tv' : 'movie' as 'tv' | 'movie',
        seasonRecords: {},
        episodeRecords: {},
        status: isTv ? 'up_to_date' as const : 'completed' as const,
        updatedAt: Date.now(),
        createdAt: Date.now(),
        seenEpisodes: isTv ? [] : ['movie'],
        isArchived: false,
      };
      const newId = await addShow(newShowData);
      const savedShow = { ...newShowData, id: newId, userId: '' } as Show;
      showToast(
        `« ${title} » marqué comme vu !`, 
        'success', 
        savedShow,
        async () => {
          if (newId) await deleteShow(newId);
        }
      );
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    startXRef.current = touch.clientX;
    startYRef.current = touch.clientY;
    isHorizontalSwipeRef.current = null;

    if (touch.clientX <= 70) {
      isEdgeSwipeRef.current = true;
    } else {
      isEdgeSwipeRef.current = false;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (startXRef.current === null || startYRef.current === null) return;
    const touch = e.touches[0];
    const diffX = touch.clientX - startXRef.current;
    const diffY = touch.clientY - startYRef.current;

    if (isHorizontalSwipeRef.current === null) {
      if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 8) {
        isHorizontalSwipeRef.current = true;
      } else if (Math.abs(diffY) > Math.abs(diffX) && Math.abs(diffY) > 8) {
        isHorizontalSwipeRef.current = false;
      }
    }

    if (isEdgeSwipeRef.current && isHorizontalSwipeRef.current === true && diffX > 0) {
      setIsDragging(true);
      setDragX(diffX);
    }
  };

  const handleTouchEnd = () => {
    if (isDragging) {
      setIsDragging(false);
      if (dragX > 90) {
        handleAnimatedClose();
      } else {
        setDragX(0);
      }
    }
    startXRef.current = null;
    startYRef.current = null;
    isEdgeSwipeRef.current = false;
    isHorizontalSwipeRef.current = null;
  };

  useEffect(() => {
    let isMounted = true;
    setIsTranslatingBio(false);

    tmdb.getPersonDetails(personId).then(async res => {
      if (res.ok && isMounted) {
        const p = res.value;
        setPerson(p);
        if (p.name && /[\u4e00-\u9fa5]/.test(p.name)) {
          translateToFrench(p.name).then(frName => {
            if (frName && isMounted) {
              setPerson((prev: any) => prev ? { ...prev, name: frName } : prev);
            }
          });
        }
        if (p.biography && p.biography.trim()) {
          const lower = p.biography.toLowerCase();
          const englishWords = [' born ', ' is an ', ' was an ', ' actor ', ' actress ', ' known for ', ' career ', ' signed ', ' american ', ' english ', ' directed '];
          const isEnglish = englishWords.some(w => lower.includes(w)) || (!lower.includes(' né ') && !lower.includes(' née ') && !lower.includes(' est un ') && !lower.includes(' est une '));

          if (isEnglish) {
            setIsTranslatingBio(true);
            try {
              const frBio = await translateToFrench(p.biography);
              if (isMounted && frBio) {
                setPerson((prev: any) => prev ? { ...prev, biography: frBio } : prev);
              }
            } finally {
              if (isMounted) {
                setIsTranslatingBio(false);
              }
            }
          }
        }
      }
    });
    tmdb.getPersonCredits(personId).then(res => {
      if (res.ok && isMounted) setCredits(res.value);
    });
    return () => { isMounted = false; };
  }, [personId]);

  if (!person) {
    return (
      <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex justify-center items-center">
        <div className="bg-black w-full max-w-md h-full flex items-center justify-center border-x border-white/5">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#E5A93D]" />
        </div>
      </div>
    );
  }

  const displayedCredits = activeTab === 'directing' 
    ? directingCredits 
    : activeTab === 'cast' 
      ? castCredits 
      : (person.known_for_department === 'Directing' && directingCredits.length > 0 ? otherCrewCredits : crewCredits);

  const watchedCount = displayedCredits.filter((item: any) => {
    const show = showsByTmdbId.get(Number(item.id));
    return isShowWatched(show);
  }).length;
  const unwatchedCount = displayedCredits.length - watchedCount;
  const completionCount = watchedCount;
  const completionPercentage = displayedCredits.length > 0 ? Math.round((completionCount / displayedCredits.length) * 100) : 0;

  const filteredCredits = displayedCredits.filter((item: any) => {
    const isWatched = isShowWatched(showsByTmdbId.get(Number(item.id)));
    if (statusFilter === 'watched') return isWatched;
    if (statusFilter === 'unwatched') return !isWatched;
    return true;
  });

  const isBioLong = person.biography && person.biography.length > 200;

  const headerTitle = person.known_for_department === 'Directing'
    ? 'Fiche Réalisateur'
    : person.known_for_department === 'Writing'
      ? 'Fiche Scénariste'
      : person.known_for_department === 'Production'
        ? 'Fiche Producteur'
        : 'Fiche Acteur';

  const jobLabel = person.known_for_department === 'Acting'
    ? 'Acteur / Actrice'
    : person.known_for_department === 'Directing'
      ? 'Réalisateur / Réalisatrice'
      : person.known_for_department === 'Writing'
        ? 'Scénariste'
        : person.known_for_department === 'Production'
          ? 'Producteur'
          : person.known_for_department;

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex justify-center items-center">
      <div 
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          transform: isExiting ? 'translateX(100%)' : (dragX > 0 ? `translateX(${dragX}px)` : undefined),
        }}
        className={cn(
          "relative bg-black w-full max-w-md h-full overflow-y-auto pb-36 flex flex-col hide-scrollbar shadow-2xl border-x border-white/10",
          isDragging 
            ? "transition-none" 
            : "transition-transform duration-300 ease-out",
          !isExiting && dragX === 0 && "animate-in slide-in-from-right duration-300"
        )}
      >
        {/* Sticky Header */}
      <div className="relative pt-3 pb-2.5 px-4 flex items-center justify-between z-20 sticky top-0 bg-black/95 backdrop-blur-xl border-b border-white/10">
        <button 
          onPointerUp={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleAnimatedClose();
          }}
          onClick={(e) => {
            e.stopPropagation();
          }}
          className="flex items-center gap-1.5 px-3 py-1 bg-zinc-900/90 hover:bg-zinc-800 rounded-full border border-white/10 touch-manipulation select-none cursor-pointer text-white font-semibold text-xs transition-colors"
        >
          <ChevronLeft size={18} className="text-[#E5A93D]" />
          <span>Retour</span>
        </button>
        <span className="text-white font-bold tracking-wider uppercase text-xs">{headerTitle}</span>
        <button 
          onClick={handleAnimatedClose}
          className="w-8 h-8 bg-zinc-900/90 rounded-full flex items-center justify-center border border-white/10 touch-manipulation cursor-pointer hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
        >
          <X size={16} />
        </button>
      </div>

        {/* Profile Header Info */}
        <div className="px-4 mt-3 flex flex-col items-center">
          {/* Prominent high-res Star photo */}
          <div className="w-32 h-32 sm:w-36 sm:h-36 rounded-full overflow-hidden bg-zinc-800 border-3 border-[#E5A93D]/70 shadow-2xl ring-4 ring-[#E5A93D]/20 mb-3 flex-shrink-0">
            {person.profile_path ? (
              <img 
                src={`https://image.tmdb.org/t/p/w500${person.profile_path}`} 
                alt={person.name} 
                className="w-full h-full object-cover object-top" 
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-zinc-500 font-bold text-3xl">
                {person.name.charAt(0)}
              </div>
            )}
          </div>
          <h1 className="text-lg sm:text-xl font-black uppercase tracking-wide text-white mb-0.5 text-center">{person.name}</h1>
          <p className="text-[11px] font-bold text-[#E5A93D] tracking-wider uppercase mb-2.5 text-center">
            {jobLabel}
          </p>

          {/* Favorite Person Button */}
          {(() => {
            const { isFavorite, addPerson, removePerson } = favPeopleStore;
            const fav = isFavorite(person.id);
            return (
              <button
                onClick={() => {
                  if (fav) removePerson(person.id);
                  else addPerson({ id: person.id, name: person.name, profile_path: person.profile_path, known_for_department: person.known_for_department });
                }}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-full border mb-3.5 transition-all touch-manipulation cursor-pointer active:scale-95",
                  fav ? "bg-rose-500/20 border-rose-500/40 text-rose-500" : "bg-zinc-900 border-white/10 text-zinc-400 hover:text-white hover:bg-zinc-800"
                )}
              >
                <Heart size={13} className={cn(fav && "fill-rose-500")} />
                <span className="text-[10px] font-bold tracking-wider uppercase">{fav ? 'En favoris' : 'Ajouter aux favoris'}</span>
              </button>
            );
          })()}

          {/* Quick Facts Grid */}
          <div className="w-full grid grid-cols-2 gap-2 mb-4">
            {person.place_of_birth && (
              <div className="bg-zinc-900/60 p-2.5 rounded-xl border border-white/5">
                <span className="block text-[8px] uppercase font-bold text-zinc-500 mb-0.5">Lieu de naissance</span>
                <span className="text-[11px] text-zinc-200 font-medium line-clamp-2 leading-snug">{person.place_of_birth}</span>
              </div>
            )}
            {person.birthday && (
              <div className="bg-zinc-900/60 p-2.5 rounded-xl border border-white/5">
                <span className="block text-[8px] uppercase font-bold text-zinc-500 mb-0.5">Date de naissance</span>
                <span className="text-[11px] text-zinc-200 font-medium leading-snug">
                  {new Date(person.birthday).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                  {person.birthday && ` (${getAge(person.birthday, person.deathday)} ans)`}
                </span>
              </div>
            )}
            {person.known_for_department && (
              <div className="bg-zinc-900/60 p-2.5 rounded-xl border border-white/5">
                <span className="block text-[8px] uppercase font-bold text-zinc-500 mb-0.5">Métier principal</span>
                <span className="text-[11px] text-zinc-200 font-medium leading-snug">{jobLabel}</span>
              </div>
            )}
            {person.popularity && (
              <div className="bg-zinc-900/60 p-2.5 rounded-xl border border-white/5">
                <span className="block text-[8px] uppercase font-bold text-zinc-500 mb-0.5">Popularité TMDB</span>
                <span className="text-[11px] text-zinc-200 font-medium leading-snug">⭐ {person.popularity.toFixed(1)}</span>
              </div>
            )}
          </div>

          {/* Biography with translation skeleton */}
          {isTranslatingBio ? (
            <div className="w-full bg-zinc-900/50 rounded-2xl p-3 border border-white/5 mb-5 animate-pulse">
              <div className="flex items-center justify-between mb-2">
                <div className="h-2.5 w-16 bg-zinc-700/60 rounded" />
                <span className="text-[9px] text-[#E5A93D] font-semibold flex items-center gap-1.5">
                  <Loader2 size={10} className="animate-spin text-[#E5A93D]" />
                  Traduction en français...
                </span>
              </div>
              <div className="space-y-1.5 py-0.5">
                <div className="h-2.5 bg-zinc-800/80 rounded w-full" />
                <div className="h-2.5 bg-zinc-800/80 rounded w-[90%]" />
                <div className="h-2.5 bg-zinc-800/80 rounded w-[72%]" />
              </div>
            </div>
          ) : person.biography ? (
            <div className="w-full bg-zinc-900/50 rounded-2xl p-3 border border-white/5 mb-5">
               <h3 className="text-[9px] font-bold uppercase text-zinc-500 tracking-wider mb-1">Biographie</h3>
               <p className={cn("text-zinc-300 text-[11px] sm:text-xs leading-relaxed", !bioExpanded && isBioLong && "line-clamp-4")}>
                  {person.biography}
               </p>
               {isBioLong && (
                 <button 
                   onClick={() => setBioExpanded(!bioExpanded)}
                   className="text-[#E5A93D] text-[10px] font-bold mt-1 uppercase tracking-wider hover:underline"
                 >
                   {bioExpanded ? 'Réduire' : 'Lire la suite'}
                 </button>
               )}
            </div>
          ) : null}
        </div>

        {/* Completion Progress Bar */}
        {displayedCredits.length > 0 && (
          <div className="px-5 mb-5 w-full max-w-sm mx-auto">
            <div className="flex justify-between items-end mb-1.5 px-1">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                Oeuvres vues
              </span>
              <span className="text-xs font-black text-[#E5A93D]">
                {completionCount} <span className="text-zinc-500 text-[10px]">/ {displayedCredits.length}</span>
              </span>
            </div>
            <div className="w-full h-2 bg-zinc-900 rounded-full overflow-hidden border border-white/5 relative">
              <div 
                className="absolute top-0 left-0 h-full bg-gradient-to-r from-amber-600 to-[#E5A93D] rounded-full transition-all duration-700 ease-out"
                style={{ width: `${completionPercentage}%` }}
              />
            </div>
          </div>
        )}

        {/* Filmographie Tabs */}
        <div className="px-4 mb-3">
          <div className="flex gap-1 bg-zinc-900/80 p-1 rounded-full border border-white/5 max-w-md mx-auto">
            {person.known_for_department === 'Directing' ? (
              <>
                {directingCredits.length > 0 && (
                  <button 
                    onClick={() => {
                      setActiveTab('directing');
                      setStatusFilter('all');
                    }}
                    className={cn(
                      "flex-1 py-1.5 px-2 text-[10px] font-bold tracking-wider uppercase transition-all rounded-full touch-manipulation truncate",
                      activeTab === 'directing' ? "bg-[#E5A93D] text-black shadow-md" : "text-zinc-400 hover:text-white"
                    )}
                  >
                    Réalisation ({directingCredits.length})
                  </button>
                )}
                {otherCrewCredits.length > 0 && (
                  <button 
                    onClick={() => {
                      setActiveTab('crew');
                      setStatusFilter('all');
                    }}
                    className={cn(
                      "flex-1 py-1.5 px-2 text-[10px] font-bold tracking-wider uppercase transition-all rounded-full touch-manipulation truncate",
                      activeTab === 'crew' ? "bg-[#E5A93D] text-black shadow-md" : "text-zinc-400 hover:text-white"
                    )}
                  >
                    Autres rôles ({otherCrewCredits.length})
                  </button>
                )}
                {castCredits.length > 0 && (
                  <button 
                    onClick={() => {
                      setActiveTab('cast');
                      setStatusFilter('all');
                    }}
                    className={cn(
                      "flex-1 py-1.5 px-2 text-[10px] font-bold tracking-wider uppercase transition-all rounded-full touch-manipulation truncate",
                      activeTab === 'cast' ? "bg-[#E5A93D] text-black shadow-md" : "text-zinc-400 hover:text-white"
                    )}
                  >
                    Joués ({castCredits.length})
                  </button>
                )}
              </>
            ) : (
              <>
                {castCredits.length > 0 && (
                  <button 
                    onClick={() => {
                      setActiveTab('cast');
                      setStatusFilter('all');
                    }}
                    className={cn(
                      "flex-1 py-1.5 px-2 text-[10px] font-bold tracking-wider uppercase transition-all rounded-full touch-manipulation truncate",
                      activeTab === 'cast' ? "bg-[#E5A93D] text-black shadow-md" : "text-zinc-400 hover:text-white"
                    )}
                  >
                    Joués ({castCredits.length})
                  </button>
                )}
                {crewCredits.length > 0 && (
                  <button 
                    onClick={() => {
                      setActiveTab('crew');
                      setStatusFilter('all');
                    }}
                    className={cn(
                      "flex-1 py-1.5 px-2 text-[10px] font-bold tracking-wider uppercase transition-all rounded-full touch-manipulation truncate",
                      activeTab === 'crew' ? "bg-[#E5A93D] text-black shadow-md" : "text-zinc-400 hover:text-white"
                    )}
                  >
                    Équipe ({crewCredits.length})
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Status Filter Bar (Tous / Vus / À voir) */}
        {displayedCredits.length > 0 && (
          <div className="px-4 mb-3.5 flex items-center justify-center gap-1.5 flex-wrap">
            <button 
              onClick={() => setStatusFilter('all')}
              className={cn(
                "px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-xl border transition-all touch-manipulation cursor-pointer flex items-center gap-1",
                statusFilter === 'all' 
                  ? "bg-zinc-800 text-[#E5A93D] border-[#E5A93D]/40 shadow-sm" 
                  : "bg-zinc-900/60 text-zinc-400 border-white/5 hover:text-zinc-200"
              )}
            >
              Tous ({displayedCredits.length})
            </button>
            <button 
              onClick={() => setStatusFilter('watched')}
              className={cn(
                "px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-xl border transition-all touch-manipulation cursor-pointer flex items-center gap-1",
                statusFilter === 'watched' 
                  ? "bg-emerald-950/70 text-emerald-400 border-emerald-500/40 shadow-sm" 
                  : "bg-zinc-900/60 text-zinc-400 border-white/5 hover:text-zinc-200"
              )}
            >
              <Check size={12} className="text-emerald-400 stroke-[3]" />
              Vus ({watchedCount})
            </button>
            <button 
              onClick={() => setStatusFilter('unwatched')}
              className={cn(
                "px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-xl border transition-all touch-manipulation cursor-pointer flex items-center gap-1",
                statusFilter === 'unwatched' 
                  ? "bg-amber-950/70 text-amber-400 border-amber-500/40 shadow-sm" 
                  : "bg-zinc-900/60 text-zinc-400 border-white/5 hover:text-zinc-200"
              )}
            >
              <Clock size={11} className="text-amber-400" />
              À voir ({unwatchedCount})
            </button>
          </div>
        )}

        {/* Filmographie Grid (3 Cols on Mobile) */}
        <div className="px-3 pb-6">
          {filteredCredits.length > 0 ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 gap-y-3">
              {filteredCredits.map((credit: any, idx: number) => {
                const show = showsByTmdbId.get(Number(credit.id));
                return (
                  <GridMediaCard
                    key={`${credit.id}-${credit.media_type}-${idx}`}
                    media={credit}
                    show={show}
                    onShowClick={(id, mediaType) => {
                      onShowClick(id, mediaType);
                    }}
                    onAddClick={handleAddClick}
                    onToggleWatched={handleToggleWatched}
                    onLongPress={(media) => setPreviewMedia(media)}
                  />
                );
              })}
            </div>
          ) : (
            <div className="py-12 text-center text-zinc-500 text-xs flex flex-col items-center gap-2">
              <Film size={26} className="text-zinc-600 mb-1" />
              <span>{statusFilter === 'watched' ? 'Aucune œuvre vue pour le moment' : statusFilter === 'unwatched' ? 'Vous avez vu toutes les œuvres de cette liste !' : 'Aucun résultat disponible.'}</span>
            </div>
          )}
        </div>

        {/* Modal de prévisualisation partagée (QuickPreviewModal / long-press) */}
        {previewMedia && (
          <QuickPreviewModal
            media={previewMedia}
            isAdded={Boolean(showsByTmdbId.get(Number(previewMedia.id)))}
            isWatched={isShowWatched(showsByTmdbId.get(Number(previewMedia.id)))}
            onClose={() => setPreviewMedia(null)}
            onAddClick={handleAddClick}
            onToggleWatched={handleToggleWatched}
            onShowClick={(id, type) => {
              setPreviewMedia(null);
              onShowClick(id, type);
            }}
          />
        )}
      </div>
    </div>
  );
}
