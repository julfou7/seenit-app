import { DialogLayer, isTopDialogElement } from '../components/ui/DialogLayer';
import React, { useEffect, useState, useRef } from 'react';
import { tmdb, type TMDBMedia } from '../features/shows/tmdb';

import { ChevronLeft, ChevronRight, X, Heart, Check, Clock, Film, Images, Loader2, MapPin, CalendarDays } from 'lucide-react';
import { cn, checkIsUpToDate } from '../lib/utils';
import { useFavoritePeopleStore } from '../store/favoritePeopleStore';
import { GridMediaCard, QuickPreviewModal } from '../components/GridMediaCard';
import { useShows } from '../hooks/useShows';
import { removeTrackedMedia } from '../features/shows/removeTrackedMedia';
import { useToastStore } from '../store/toastStore';
import { type Show } from '../types';
import { isShowWatched } from '../hooks/useProAnalytics';
import {
  deduplicateAndSortPersonCredits,
  isSelfAppearanceCredit,
  type PersonActingCategory,
  PERSON_FILMOGRAPHY_PAGE_SIZE,
  personCreditIdentity,
  partitionPersonActingCredits,
  storedPersonShowIdentity,
  takeVisiblePersonCredits
} from '../features/people/personFilmography';

interface Props {
  personId: number;
  onClose: () => void;
  onShowClick: (tmdbId: number, mediaType?: 'tv' | 'movie') => void;
}

interface PersonDetails {
  id: number;
  name: string;
  profile_path?: string | null;
  known_for_department?: string;
  birthday?: string | null;
  deathday?: string | null;
  place_of_birth?: string | null;
  popularity?: number;
  biography?: string;
}

interface PersonCreditsPayload {
  cast?: unknown;
  crew?: unknown;
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

const mediaIdentity = (media: Pick<TMDBMedia, 'id' | 'media_type' | 'first_air_date'>) => {
  const mediaType = media.media_type === 'tv' || (!media.media_type && media.first_air_date !== undefined)
    ? 'tv'
    : 'movie';
  return `${mediaType}:${Number(media.id)}`;
};

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
  const [personImages, setPersonImages] = useState<string[] | null>(null);
  const [isLoadingImages, setIsLoadingImages] = useState(false);
  const [activePortraitIndex, setActivePortraitIndex] = useState<number | null>(null);
  const galleryOpenRef = useRef(false);
  const galleryRootRef = useRef<HTMLDivElement>(null);

  const startXRef = useRef<number | null>(null);
  const startYRef = useRef<number | null>(null);
  const isEdgeSwipeRef = useRef<boolean>(false);
  const isHorizontalSwipeRef = useRef<boolean | null>(null);

  const handleAnimatedClose = () => {
    if (galleryOpenRef.current) {
      closePortraitGallery();
      return;
    }
    if (isExiting) return;
    setIsExiting(true);
    setTimeout(() => {
      onClose();
    }, 280);
  };



  const [person, setPerson] = useState<PersonDetails | null>(null);
  const [credits, setCredits] = useState<PersonCreditsPayload | null>(null);
  const [bioExpanded, setBioExpanded] = useState(false);
  const [isTranslatingBio, setIsTranslatingBio] = useState(false);
  const [activeTab, setActiveTab] = useState<'cast' | 'directing' | 'crew'>('cast');
  const [actingCategory, setActingCategory] = useState<PersonActingCategory>('movies');
  const [statusFilter, setStatusFilter] = useState<'all' | 'watched' | 'unwatched'>('all');
  const [visibleCreditWindow, setVisibleCreditWindow] = useState({
    key: '',
    limit: PERSON_FILMOGRAPHY_PAGE_SIZE
  });
  const [previewMedia, setPreviewMedia] = useState<TMDBMedia | null>(null);

  const favPeopleStore = useFavoritePeopleStore();
  const { shows, addShow, updateShow, deleteShow } = useShows();
  const { showToast } = useToastStore();

  const closePortraitGallery = () => {
    if (window.history.state?.isPersonImageLightbox) {
      window.history.back();
    } else {
      galleryOpenRef.current = false;
      setActivePortraitIndex(null);
    }
  };

  const openPortraitGallery = async () => {
    if (!person?.profile_path) return;
    setActivePortraitIndex(0);
    galleryOpenRef.current = true;
    window.history.pushState({
      ...window.history.state,
      isModal: true,
      isPersonDetailModal: true,
      isPersonImageLightbox: true,
      personId
    }, '');
    if (personImages) return;
    setIsLoadingImages(true);
    const result = await tmdb.getPersonImages(personId);
    if (result.ok) {
      const paths = Array.isArray(result.value?.profiles)
        ? result.value.profiles.map((image: { file_path?: unknown }) => image.file_path)
          .filter((path: unknown): path is string => typeof path === 'string' && /^\/[A-Za-z0-9._-]+$/.test(path))
        : [];
      setPersonImages(Array.from(new Set([person.profile_path, ...paths])).slice(0, 12));
    } else {
      setPersonImages([person.profile_path]);
    }
    setIsLoadingImages(false);
  };

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      if (galleryOpenRef.current && !event.state?.isPersonImageLightbox) {
        galleryOpenRef.current = false;
        setActivePortraitIndex(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopDialogElement(galleryRootRef.current)) return;
      if (activePortraitIndex === null) return;
      if (event.key === 'Escape') closePortraitGallery();
      if (event.key === 'ArrowRight') setActivePortraitIndex(index => index === null ? null : Math.min(index + 1, (personImages?.length || 1) - 1));
      if (event.key === 'ArrowLeft') setActivePortraitIndex(index => index === null ? null : Math.max(0, index - 1));
    };
    window.addEventListener('popstate', handlePopState);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activePortraitIndex, personImages]);

  const showsByMediaIdentity = React.useMemo(() => {
    const map = new Map<string, Show>();
    shows.forEach(s => {
      const identity = storedPersonShowIdentity(s);
      if (identity) map.set(identity, s);
    });
    return map;
  }, [shows]);

  const castCredits = React.useMemo(() => {
    return deduplicateAndSortPersonCredits(credits?.cast || [], 'cast');
  }, [credits]);

  const crewCredits = React.useMemo(() => {
    return deduplicateAndSortPersonCredits(credits?.crew || [], 'crew');
  }, [credits]);

  const actingCredits = React.useMemo(() => partitionPersonActingCredits(castCredits), [castCredits]);

  const isDirectingJob = (job: string) => {
    const j = (job || '').toLowerCase();
    return j.includes('director') || j.includes('réalisat') || j.includes('creator') || j.includes('créat') || j === 'showrunner';
  };

  const directingCredits = React.useMemo(() => {
    return crewCredits.filter(item =>
      Array.isArray(item.rawJobs) && item.rawJobs.some(isDirectingJob)
    );
  }, [crewCredits]);

  const standoutCredits = React.useMemo(() => {
    const source = person?.known_for_department === 'Directing'
      ? directingCredits
      : castCredits.filter(credit => credit.character && !isSelfAppearanceCredit(credit));
    const score = (credit: typeof castCredits[number]) => Math.log1p(credit.popularity || 0) * 0.25
      + Math.log1p(credit.vote_count || 0) * 0.45
      + Math.max(0, Math.min(10, credit.vote_average || 0)) / 10 * 0.3;
    const ranked = [...source].sort((a, b) => score(b) - score(a) || Number(b.id) - Number(a.id));
    const seenCharacters = new Set<string>();
    const selected = [] as typeof ranked;
    for (const credit of ranked) {
      const character = (credit.character || '').trim().toLocaleLowerCase('fr-FR');
      if (character && seenCharacters.has(character)) continue;
      if (character) seenCharacters.add(character);
      selected.push(credit);
      if (selected.length === 4) break;
    }
    return selected;
  }, [castCredits, directingCredits, person?.known_for_department]);

  const otherCrewCredits = React.useMemo(() => {
    return crewCredits.filter(item =>
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

  useEffect(() => {
    if (activeTab !== 'cast' || actingCredits[actingCategory].length > 0) return;
    if (actingCredits.movies.length > 0) setActingCategory('movies');
    else if (actingCredits.series.length > 0) setActingCategory('series');
    else if (actingCredits.appearances.length > 0) setActingCategory('appearances');
  }, [activeTab, actingCategory, actingCredits]);

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
    const existingShow = showsByMediaIdentity.get(mediaIdentity(media));
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
            status: 'completed'
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
        status: isTv ? 'watching' as const : 'completed' as const,
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
    setPersonImages(null);
    setActivePortraitIndex(null);
    setIsLoadingImages(false);
    galleryOpenRef.current = false;
    setIsTranslatingBio(false);

    tmdb.getPersonDetails(personId).then(async res => {
      if (res.ok && isMounted) {
        const p = res.value;
        setPerson(p);
        if (p.name && /[\u4e00-\u9fa5]/.test(p.name)) {
          translateToFrench(p.name).then(frName => {
            if (frName && isMounted) {
              setPerson(prev => prev ? { ...prev, name: frName } : prev);
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
                setPerson(prev => prev ? { ...prev, biography: frBio } : prev);
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
      <DialogLayer onDismiss={handleAnimatedClose} label="Fiche personne" historyMode="external" role="dialog" className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex justify-center items-center">
        <div className="bg-black w-full max-w-md h-full flex items-center justify-center border-x border-white/5">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#E5A93D]" />
        </div>
      </DialogLayer>
    );
  }

  const displayedCredits = activeTab === 'directing'
    ? directingCredits
    : activeTab === 'cast'
      ? actingCredits[actingCategory]
      : (person.known_for_department === 'Directing' && directingCredits.length > 0 ? otherCrewCredits : crewCredits);

  const watchedCount = displayedCredits.filter(item => {
    const show = showsByMediaIdentity.get(personCreditIdentity(item));
    return isShowWatched(show);
  }).length;
  const unwatchedCount = displayedCredits.length - watchedCount;
  const completionCount = watchedCount;
  const completionPercentage = displayedCredits.length > 0 ? Math.round((completionCount / displayedCredits.length) * 100) : 0;

  const filteredCredits = displayedCredits.filter(item => {
    const isWatched = isShowWatched(showsByMediaIdentity.get(personCreditIdentity(item)));
    if (statusFilter === 'watched') return isWatched;
    if (statusFilter === 'unwatched') return !isWatched;
    return true;
  });
  const creditListKey = `${personId}:${activeTab}:${actingCategory}:${statusFilter}`;
  const visibleCreditLimit = visibleCreditWindow.key === creditListKey
    ? visibleCreditWindow.limit
    : PERSON_FILMOGRAPHY_PAGE_SIZE;
  const visibleCredits = takeVisiblePersonCredits(filteredCredits, visibleCreditLimit);
  const remainingCreditCount = Math.max(0, filteredCredits.length - visibleCredits.length);

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
    <DialogLayer onDismiss={handleAnimatedClose} label="Fiche personne" historyMode="external" role="dialog" className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex justify-center items-center">
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          transform: isExiting ? 'translateX(100%)' : (dragX > 0 ? `translateX(${dragX}px)` : undefined),
        }}
        className={cn(
          "relative bg-black w-full max-w-md h-full overflow-y-auto pb-nav flex flex-col hide-scrollbar shadow-2xl border-x border-white/10",
          isDragging
            ? "transition-none"
            : "transition-transform duration-300 ease-out",
          !isExiting && dragX === 0 && "animate-in slide-in-from-right duration-300"
        )}
      >
        {/* Sticky Header */}
      <div className="relative seenit-dialog-header pb-2.5 px-4 flex items-center justify-between z-20 sticky top-0 bg-black/95 backdrop-blur-xl border-b border-white/10">
        <button
          type="button"
          onPointerUp={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleAnimatedClose();
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (e.detail === 0) handleAnimatedClose();
          }}
          className="flex min-h-11 items-center gap-1.5 px-3 py-1 bg-zinc-900/90 hover:bg-zinc-800 rounded-full border border-white/10 touch-manipulation select-none cursor-pointer text-white font-semibold text-xs transition-colors"
        >
          <ChevronLeft size={18} className="text-[#E5A93D]" />
          <span>Retour</span>
        </button>
        <span className="text-white font-bold tracking-wider uppercase text-xs">{headerTitle}</span>
        <button
          onClick={handleAnimatedClose}
          aria-label="Fermer la fiche"
          className="min-h-11 min-w-11 bg-zinc-900/90 rounded-full flex items-center justify-center border border-white/10 touch-manipulation cursor-pointer hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
        >
          <X size={16} />
        </button>
      </div>

        {/* Profile Header Info */}
        <div className="w-full px-4 mt-4 flex items-start gap-4">
          <button
            type="button"
            aria-label={`Voir les photos de ${person.name}`}
            disabled={!person.profile_path}
            onClick={openPortraitGallery}
            className="relative h-32 w-24 shrink-0 overflow-hidden rounded-2xl border border-[#E5A93D]/40 bg-zinc-900 shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E5A93D] disabled:cursor-default"
          >
            {person.profile_path ? (
              <img
                src={`https://image.tmdb.org/t/p/w500${person.profile_path}`}
                alt={person.name}
                className="h-full w-full object-cover object-center"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-zinc-500 font-bold text-3xl">
                {person.name.charAt(0)}
              </div>
            )}
            {person.profile_path && <span className="absolute inset-x-0 bottom-0 flex min-h-8 items-center justify-center gap-1 bg-black/75 text-[10px] font-semibold text-white"><Images size={13} /> Photos</span>}
          </button>
          <div className="min-w-0 flex-1 pt-1">
          <h1 className="text-xl font-black leading-tight text-white">{person.name}</h1>
          <p className="mt-1 text-xs font-bold text-[#E5A93D] tracking-wide uppercase">{jobLabel}</p>

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
                  "mt-3 flex min-h-11 items-center gap-2 px-3 rounded-full border transition-all touch-manipulation cursor-pointer active:scale-95",
                  fav ? "bg-rose-500/20 border-rose-500/40 text-rose-500" : "bg-zinc-900 border-white/10 text-zinc-400 hover:text-white hover:bg-zinc-800"
                )}
              >
                <Heart size={16} className={cn(fav && "fill-rose-500")} />
                <span className="text-[11px] font-bold tracking-wide uppercase">{fav ? 'En favoris' : 'Ajouter aux favoris'}</span>
              </button>
            );
          })()}
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-400">
            {person.birthday && <span className="inline-flex items-center gap-1"><CalendarDays size={13} />{new Date(person.birthday).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</span>}
            {person.place_of_birth && <span className="inline-flex items-center gap-1"><MapPin size={13} />{person.place_of_birth}</span>}
          </div>
          </div>

          </div>

          {/* Quick Facts Grid */}
          <details className="group w-full mt-4 rounded-xl border border-white/10 bg-zinc-900/50 px-4 py-1">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm font-semibold text-zinc-300 marker:hidden">
              <span>Biographie et détails</span><ChevronRight size={16} className="text-zinc-500 transition-transform group-open:rotate-90" />
            </summary>
            <div className="grid grid-cols-2 gap-2 pb-3">
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
          </details>

        {standoutCredits.length > 0 && (
          <section className="mt-6 px-4" aria-labelledby="person-highlights-heading">
            <div className="mb-3 flex items-end justify-between">
              <div>
                <h2 id="person-highlights-heading" className="text-base font-bold text-white">{person.known_for_department === 'Directing' ? 'Œuvres marquantes' : 'Rôles marquants'}</h2>
                <p className="mt-0.5 text-xs text-zinc-500">Sélection parmi ses crédits TMDB</p>
              </div>
            </div>
            <div className="flex gap-3 overflow-x-auto pb-2 hide-scrollbar snap-x" aria-label="Sélection de rôles marquants">
              {standoutCredits.map(credit => {
                const title = credit.title || credit.name || 'Œuvre sans titre';
                const mediaType = credit.media_type;
                return (
                  <button
                    key={`${mediaType}:${credit.id}`}
                    type="button"
                    onClick={() => onShowClick(Number(credit.id), mediaType)}
                    className="w-28 shrink-0 snap-start overflow-hidden rounded-xl border border-white/10 bg-zinc-900 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E5A93D]"
                    aria-label={`${credit.character ? `${credit.character}, dans ` : ''}${title}`}
                  >
                    <div className="aspect-[2/3] bg-zinc-800">
                      {credit.poster_path ? <img loading="lazy" src={`https://image.tmdb.org/t/p/w342${credit.poster_path}`} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center p-2 text-center text-xs text-zinc-500">{title}</div>}
                    </div>
                    <span className="block truncate px-2 pt-2 text-xs font-semibold text-white">{credit.character || credit.job || title}</span>
                    <span className="block truncate px-2 pb-2 text-[11px] text-zinc-400">{title}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* Completion Progress Bar */}
        {displayedCredits.length > 0 && (
          <div className="mt-5 mb-3 w-full px-5">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-base font-bold text-white">Filmographie</h2>
              <span className="text-xs font-semibold text-zinc-400"><span className="text-[#E5A93D]">{completionCount}</span> / {displayedCredits.length} vues</span>
            </div>
            <div className="w-full h-1.5 bg-zinc-900 rounded-full overflow-hidden border border-white/5 relative" role="progressbar" aria-label="Œuvres vues" aria-valuenow={completionCount} aria-valuemin={0} aria-valuemax={displayedCredits.length}>
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
                      "flex min-h-11 flex-1 items-center justify-center px-2 text-[10px] font-bold tracking-wider uppercase transition-all rounded-full touch-manipulation truncate",
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
                      "flex min-h-11 flex-1 items-center justify-center px-2 text-[10px] font-bold tracking-wider uppercase transition-all rounded-full touch-manipulation truncate",
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
                      "flex min-h-11 flex-1 items-center justify-center px-2 text-[10px] font-bold tracking-wider uppercase transition-all rounded-full touch-manipulation truncate",
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
                      "flex min-h-11 flex-1 items-center justify-center px-2 text-[10px] font-bold tracking-wider uppercase transition-all rounded-full touch-manipulation truncate",
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
                      "flex min-h-11 flex-1 items-center justify-center px-2 text-[10px] font-bold tracking-wider uppercase transition-all rounded-full touch-manipulation truncate",
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

        {activeTab === 'cast' && (
          <div className="px-4 mb-3">
            <div className="flex gap-1.5 overflow-x-auto hide-scrollbar max-w-md mx-auto" aria-label="Catégorie de filmographie">
              {([
                ['movies', 'Films', actingCredits.movies.length],
                ['series', 'Séries', actingCredits.series.length],
                ['appearances', 'Apparitions', actingCredits.appearances.length]
              ] as const).map(([category, label, count]) => count > 0 && (
                <button
                  key={category}
                  type="button"
                  aria-pressed={actingCategory === category}
                  onClick={() => {
                    setActingCategory(category);
                    setStatusFilter('all');
                  }}
                  className={cn(
                    "min-h-11 shrink-0 px-3 py-2 text-[10px] font-bold uppercase tracking-wider rounded-xl border transition-all touch-manipulation cursor-pointer",
                    actingCategory === category
                      ? "bg-[#E5A93D]/15 text-[#E5A93D] border-[#E5A93D]/50"
                      : "bg-zinc-900/60 text-zinc-400 border-white/5 hover:text-zinc-200"
                  )}
                >
                  {label} ({count})
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Status Filter Bar (Tous / Vus / À voir) */}
        {displayedCredits.length > 0 && (
          <div className="px-4 mb-3.5 flex items-center gap-1.5" role="group" aria-label="Filtrer les œuvres par statut">
            <button
              aria-pressed={statusFilter === 'all'}
              onClick={() => setStatusFilter('all')}
              className={cn(
                "min-h-11 min-w-0 flex-1 justify-center px-2 text-[10px] font-bold uppercase tracking-wide rounded-xl border transition-all touch-manipulation cursor-pointer flex items-center gap-1",
                statusFilter === 'all'
                  ? "bg-zinc-800 text-[#E5A93D] border-[#E5A93D]/40 shadow-sm"
                  : "bg-zinc-900/60 text-zinc-400 border-white/5 hover:text-zinc-200"
              )}
            >
              Tous ({displayedCredits.length})
            </button>
            <button
              aria-pressed={statusFilter === 'watched'}
              onClick={() => setStatusFilter('watched')}
              className={cn(
                "min-h-11 min-w-0 flex-1 justify-center px-2 text-[10px] font-bold uppercase tracking-wide rounded-xl border transition-all touch-manipulation cursor-pointer flex items-center gap-1",
                statusFilter === 'watched'
                  ? "bg-emerald-950/70 text-emerald-400 border-emerald-500/40 shadow-sm"
                  : "bg-zinc-900/60 text-zinc-400 border-white/5 hover:text-zinc-200"
              )}
            >
              <Check size={12} className="text-emerald-400 stroke-[3]" />
              Vus ({watchedCount})
            </button>
            <button
              aria-pressed={statusFilter === 'unwatched'}
              onClick={() => setStatusFilter('unwatched')}
              className={cn(
                "min-h-11 min-w-0 flex-1 justify-center px-2 text-[10px] font-bold uppercase tracking-wide rounded-xl border transition-all touch-manipulation cursor-pointer flex items-center gap-1",
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

        {/* Filmography grid: two readable columns on narrow screens */}
        <div className="px-3 pb-6">
          {filteredCredits.length > 0 ? (
            <>
              <div className="relative z-0 grid grid-cols-2 gap-x-3 gap-y-4 px-1">
                {visibleCredits.map((credit, idx: number) => {
                  const show = showsByMediaIdentity.get(personCreditIdentity(credit));
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
              {remainingCreditCount > 0 && (
                <button
                  type="button"
                  onClick={() => setVisibleCreditWindow({
                    key: creditListKey,
                    limit: visibleCreditLimit + PERSON_FILMOGRAPHY_PAGE_SIZE
                  })}
                  className="mt-5 min-h-11 w-full rounded-xl border border-white/10 bg-zinc-900/80 px-4 py-2 text-xs font-bold text-[#E5A93D] transition-colors hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E5A93D]"
                >
                  Afficher {Math.min(PERSON_FILMOGRAPHY_PAGE_SIZE, remainingCreditCount)} de plus
                </button>
              )}
            </>
          ) : (
            <div className="py-12 text-center text-zinc-500 text-xs flex flex-col items-center gap-2">
              <Film size={26} className="text-zinc-600 mb-1" />
              <span>{statusFilter === 'watched' ? 'Aucune œuvre vue pour le moment' : statusFilter === 'unwatched' ? 'Vous avez vu toutes les œuvres de cette liste !' : 'Aucun résultat disponible.'}</span>
            </div>
          )}
        </div>

        {activePortraitIndex !== null && (
          <DialogLayer ref={galleryRootRef} onDismiss={closePortraitGallery} label="Galerie de portraits" historyMode="external" role="dialog"

            aria-modal="true"
            aria-label={`Photos de ${person.name}`}
            className="fixed inset-0 z-[130] flex items-center justify-center bg-black/95 p-4 backdrop-blur-sm"
            onClick={closePortraitGallery}
            onTouchStart={event => event.stopPropagation()}
          >
            <button type="button" autoFocus aria-label="Fermer la galerie" onClick={event => { event.stopPropagation(); closePortraitGallery(); }} className="absolute right-4 top-[calc(env(safe-area-inset-top)+1rem)] z-10 flex min-h-11 min-w-11 items-center justify-center rounded-full border border-white/15 bg-zinc-900 text-white"><X size={20} /></button>
            {isLoadingImages && <span className="absolute text-sm text-zinc-300">Chargement des photos…</span>}
            {(personImages ? activePortraitIndex < personImages.length : Boolean(person.profile_path)) && (
              <>
                <img onClick={event => event.stopPropagation()} src={`https://image.tmdb.org/t/p/original${personImages?.[activePortraitIndex] || person.profile_path}`} alt={`Photo ${activePortraitIndex + 1} de ${person.name}`} className="max-h-[78dvh] max-w-[88vw] rounded-xl object-contain" />
                {(personImages?.length || 0) > 1 && <>
                  <button type="button" aria-label="Photo précédente" onClick={event => { event.stopPropagation(); setActivePortraitIndex(index => index === null ? null : (index - 1 + (personImages?.length || 1)) % (personImages?.length || 1)); }} className="absolute left-3 top-1/2 flex min-h-11 min-w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/70 text-white"><ChevronLeft size={22} /></button>
                  <button type="button" aria-label="Photo suivante" onClick={event => { event.stopPropagation(); setActivePortraitIndex(index => index === null ? null : (index + 1) % (personImages?.length || 1)); }} className="absolute right-3 top-1/2 flex min-h-11 min-w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/70 text-white"><ChevronRight size={22} /></button>
                  <span className="absolute bottom-[calc(env(safe-area-inset-bottom)+1.5rem)] rounded-full bg-zinc-900/90 px-3 py-1 text-xs text-zinc-200">{activePortraitIndex + 1} / {personImages?.length}</span>
                </>}
              </>
            )}
          </DialogLayer>
        )}

        {/* Modal de prévisualisation partagée (QuickPreviewModal / long-press) */}
        {previewMedia && (
          <QuickPreviewModal
            media={previewMedia}
            isAdded={Boolean(showsByMediaIdentity.get(mediaIdentity(previewMedia)))}
            isWatched={isShowWatched(showsByMediaIdentity.get(mediaIdentity(previewMedia)))}
            onClose={() => setPreviewMedia(null)}
            onAddClick={handleAddClick}
            onRemoveClick={media => { const show = showsByMediaIdentity.get(mediaIdentity(media)); if (show) return removeTrackedMedia(show, deleteShow); }}
            onToggleWatched={handleToggleWatched}
            onShowClick={(id, type) => {
              setPreviewMedia(null);
              onShowClick(id, type);
            }}
          />
        )}
      </div>
    </DialogLayer>
  );
}
