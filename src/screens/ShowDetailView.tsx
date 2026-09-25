import React, { useState, useEffect, useRef, useMemo } from 'react';
import { type Show } from '../types';
import { tmdb, isMovieAtCinema, isMovieUpcoming } from '../features/shows/tmdb';
import { ChevronLeft, Star, Heart, CheckCircle2, Circle, Tv, Zap, X, EyeOff, Archive, Trash2, MoreVertical, Plus, Check, Share, Share2, Play, Calendar, ArchiveRestore, Ban, RotateCcw, MonitorPlay, Youtube, Clapperboard, ExternalLink, Clock, RefreshCw, Download } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { cn, computeAutoArchiveStatus, formatAirDateSafe, formatVoteCount, getBestLogoPath, getTodayStr, getCalendarDaysDiff, getEpisodeRelativeAirDate, scrollAllCarouselsToStart, openExternalUrl, checkIsUpToDate } from '../lib/utils';
import { EpisodeDetailModal } from './EpisodeDetailModal';
import { PersonDetailModal } from './PersonDetailModal';
import { TimelineMediaCard } from '../components/cards/TimelineMediaCard';
import { EpisodeRatingsChart } from '../components/EpisodeRatingsChart';
import { useShows } from '../hooks/useShows';
import { useToastStore } from '../store/toastStore';
import { syncSingleItem } from '../hooks/useDetailsSyncWorker';
import { auth, db } from '../lib/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { TrailerModal } from '../components/TrailerModal';
import { DownloadModal } from '../components/DownloadModal';
import { useShowsStore } from '../store/showsStore';
import { getFormattedProviderLogo, PLEX_LOGO_SVG } from '../utils/providerLogos';
import { openPlexWatchUrl } from '../features/plex/syncPlex';
import { useMediaPresence } from '../hooks/useMediaPresence';
import { RedditSection } from '../components/community/RedditSection';
import { buildRedditMovieSearchQuery } from '../components/community/redditEpisodeSearch';
import { useLiveDownloadStore } from '../store/liveDownloadStore';
import { LiveDownloadBanner } from '../components/LiveDownloadBanner';
import { useDownloadConfigStore } from '../store/downloadConfigStore';
import { useMediaPresenceStore } from '../store/mediaPresenceStore';
import { searchAndDownloadInSonarr, searchAndDownloadInRadarr } from '../services/sonarrRadarr';
import { downloadEpisodeWithSeasonPackFallback } from '../features/downloads/episodeSeasonPackFallback';
import { acceptDownloadRequest, beginDownloadRequest, failDownloadRequest, updateDownloadRequest } from '../features/downloads/downloadLifecycle';
import { readUserScopedJson } from '../lib/userIsolation';
import { mediaKeyFrom, toMediaKey } from '../features/shows/mediaRelations';
import { getParentalRatingColorClass, resolveParentalRating } from '../features/shows/parentalRating';
import {
  type ShowDetailScreenProps,
  getCleanProviderName,
  getEpisodeAirDateLabel,
  getKeywordsFromDetails,
  getProviderLinkPresentation,
  getSeasonReleaseDateText,
  getSmartDefaultSeason,
} from './showDetailPresentation';

interface ShowDetailViewProps {
  model: Record<string, any>;
}

interface StreamingProviderItem {
  provider_id: number;
  provider_name: string;
  logo_path?: string | null;
  isPlex?: boolean;
  serverName?: string;
  plexUrl?: string;
  watchUrl?: string;
}

export function ShowDetailView({ model }: ShowDetailViewProps) {
  const { activeTab, areThemesExpanded, backdropUrl, collectionData, collectionLoading, downloadTargetEpisode, downloadTargetSeason, dragX, dropShow, effectiveTmdbId, epStatus, expandedSeason, followShow, formatRemainingTime, formatRuntime, getEpisodeDownload, handle1ClickDownloadEpisode, handle1ClickDownloadMovie, handle1ClickDownloadSeason, handleAnimatedBack, handleDeleteShow, handleSyncSingle, handleTabChange, handleTouchEnd, handleTouchMove, handleTouchStart, handleWatchNextEpisode, hasActiveDownload, hasCancelledDownload, hasCompletedDownload, hasDownloadError, hasSeenMedia, hasTrailer, initialEpisode, initialSeason, is1ClickDownloading, isDownloadModalOpen, isDownloadMode, isDragging, isExiting, isRefreshingPlex, isSeries, isSyncingSingle, isSynopsisExpanded, isUnreleased, keywords, loadSeason, logoPath, mainScrollRef, onShowClick, openEpisodeModal, openPersonModal, plexMediaInfo, posterError, posterPath, progressPercentage, providers, ratingInfo, refreshPlexAvailability, releaseYear, remainingTimeMinutes, requestedMediaKey, resumeShow, rewatchShow, seasonObserverRef, seasonsCache, seenCount, selectedEpisode, selectedPersonId, setAreThemesExpanded, setDownloadTargetEpisode, setDownloadTargetSeason, setIsDownloadModalOpen, setIsDownloadMode, setIsSynopsisExpanded, setLogoError, setPosterError, setSeasonsCache, setSelectedEpisode, setSelectedPersonId, setShowAllCast, setShowMenu, setTrailerModalVideos, show, showDownloadSummary, showMenu, showToast, sortedProviders, tabsRef, title, tmdbDetails, toggleEpisodeSeen, toggleFavorite, toggleMovieSeen, togglePlanToWatchMovie, toggleSeasonSeen, totalEpisodes, trailerModalVideos, universeData, userPlatforms, visibleSeasons, ytVideos } = model;
  const redditVisibleTitle = tmdbDetails?.name || tmdbDetails?.title || show?.title || '';
  const redditMovieOriginalTitle = tmdbDetails?.original_title || show?.originalTitle || null;
  const isAtCinema = !isSeries && (isMovieAtCinema(tmdbDetails) || isMovieAtCinema(show));
  const redditMovieQuery = buildRedditMovieSearchQuery({
    movieTitle: redditVisibleTitle,
    originalMovieTitle: redditMovieOriginalTitle,
  });

  const resolveRedditMovieQuery = async () => {
    if (isSeries || !effectiveTmdbId) return redditMovieQuery;
    const englishTitleResult = await tmdb.getEnglishMediaTitle(Number(effectiveTmdbId), 'movie');
    return buildRedditMovieSearchQuery({
      movieTitle: redditVisibleTitle,
      communityMovieTitle: englishTitleResult.ok ? englishTitleResult.value : null,
      originalMovieTitle: redditMovieOriginalTitle,
    });
  };
  return (
    <div ref={mainScrollRef} onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}
      style={{ transform: isExiting ? 'translateX(100%)' : (dragX > 0 ? `translateX(${dragX}px)` : undefined) }}
      className={cn("flex-1 overflow-y-auto bg-transparent text-white relative pb-nav w-full h-full", isDragging ? "transition-none" : "transition-transform duration-300 ease-out")}>
      <div className="relative">
        <div className="absolute top-0 inset-x-0 h-96 z-0">
          {backdropUrl && <img loading="eager" decoding="async" fetchPriority="high" src={backdropUrl} alt="Backdrop" className="w-full h-full object-cover opacity-60" />}
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/80 to-transparent" />
        </div>
        <div className="sticky top-0 z-40 pt-10 pb-2 px-4 flex justify-between items-center bg-gradient-to-b from-black/90 via-black/50 to-transparent">
          <button type="button" onPointerUp={(e) => { e.preventDefault(); e.stopPropagation(); handleAnimatedBack(); }} onClick={(e) => e.stopPropagation()} className="w-10 h-10 bg-black/60 backdrop-blur-md rounded-full flex items-center justify-center border border-white/10 text-white hover:bg-black/80 transition-colors active:scale-95 touch-manipulation cursor-pointer z-50 select-none"><ChevronLeft size={24} /></button>
          <div className="relative z-50">
            <button type="button" onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }} className="w-10 h-10 bg-black/60 backdrop-blur-md rounded-full flex items-center justify-center border border-white/10 text-white hover:bg-black/80 transition-colors active:scale-95 touch-manipulation cursor-pointer"><MoreVertical size={20} /></button>
            {showMenu && (
              <><div className="fixed inset-0 z-40 bg-black/20" onClick={(e) => { e.stopPropagation(); setShowMenu(false); }} />
              <div className="absolute right-0 top-12 w-56 bg-zinc-900/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl z-50 overflow-hidden flex flex-col py-1 animate-in fade-in duration-150">
                {/* Action Téléchargement */}
                <button type="button" onClick={(e) => { e.stopPropagation(); setShowMenu(false); setDownloadTargetSeason(undefined); setDownloadTargetEpisode(undefined); setIsDownloadModalOpen(true); }} className="w-full px-4 py-3 text-left text-sm text-blue-400 hover:bg-zinc-800 transition-colors flex items-center gap-3 font-semibold cursor-pointer active:bg-zinc-800"><Download size={16} className="text-blue-400 shrink-0" /><span>Téléchargement</span></button>
                <div className="h-px bg-white/5 my-0.5" />
                {show && <button type="button" onClick={(e) => { e.stopPropagation(); setShowMenu(false); handleSyncSingle(); }} disabled={isSyncingSingle} className="w-full px-4 py-3 text-left text-sm text-[#E5A93D] hover:bg-zinc-800 transition-colors flex items-center gap-3 font-semibold cursor-pointer active:bg-zinc-800 disabled:opacity-50"><RefreshCw size={16} className={cn(isSyncingSingle && "animate-spin")} /><span>Synchroniser {isSeries ? 'la série' : 'le film'}</span></button>}
                {show && <><div className="h-px bg-white/5 my-1" />
                  {show.isArchived ? <button type="button" onClick={(e) => { e.stopPropagation(); setShowMenu(false); isSeries ? rewatchShow() : toggleMovieSeen(); }} className="w-full px-4 py-3 text-left text-sm text-zinc-300 hover:bg-zinc-800 transition-colors flex items-center gap-3 font-semibold cursor-pointer active:bg-zinc-800"><RotateCcw size={16} className="text-emerald-400" /><span>{isSeries ? "Revoir la série" : "Revoir le film"}</span></button>
                  : show.status === 'dropped' ? <button type="button" onClick={(e) => { e.stopPropagation(); setShowMenu(false); isSeries ? resumeShow() : togglePlanToWatchMovie(); }} className="w-full px-4 py-3 text-left text-sm text-zinc-300 hover:bg-zinc-800 transition-colors flex items-center gap-3 font-semibold cursor-pointer active:bg-zinc-800"><RotateCcw size={16} className="text-emerald-400" /><span>{isSeries ? "Reprendre la série" : "Ajouter à ma liste"}</span></button>
                  : <button type="button" onClick={(e) => { e.stopPropagation(); setShowMenu(false); isSeries ? dropShow() : togglePlanToWatchMovie(); }} className="w-full px-4 py-3 text-left text-sm text-zinc-300 hover:bg-zinc-800 transition-colors flex items-center gap-3 font-semibold cursor-pointer active:bg-zinc-800"><Ban size={16} className="text-amber-400" /><span>{isSeries ? "Abandonner la série" : "Retirer de ma liste"}</span></button>}
                  <div className="h-px bg-white/5 my-1" />
                  <button type="button" onClick={(e) => { e.stopPropagation(); setShowMenu(false); handleDeleteShow(); }} className="w-full px-4 py-3 text-left text-sm text-red-500 hover:bg-red-500/10 transition-colors flex items-center gap-3 font-semibold cursor-pointer active:bg-zinc-800"><Trash2 size={16} /><span>{isSeries ? "Supprimer la série" : "Supprimer le film"}</span></button>
                </>}
              </div></>)}
          </div>
        </div>

        <div className="relative z-10 px-4 mt-6">
          <div className="flex gap-4">
            <div className="w-[120px] shrink-0">
              {posterPath && !posterError ? <img loading="eager" decoding="async" fetchPriority="high" src={posterPath} alt={title} onError={() => setPosterError(true)} className="w-full aspect-[2/3] rounded-xl shadow-2xl border border-white/10 object-cover" />
              : <div className="w-full aspect-[2/3] rounded-xl bg-zinc-900 border border-white/10 flex flex-col items-center justify-center p-2 text-center shadow-2xl">{isSeries ? <Tv className="w-8 h-8 text-[#E5A93D]/70 mb-1" /> : <Clapperboard className="w-8 h-8 text-[#E5A93D]/70 mb-1" />}<span className="text-[10px] font-bold text-zinc-300 line-clamp-2 leading-tight">{title}</span></div>}
            </div>
            <div className="flex-1 min-w-0 flex flex-col justify-end pb-1">
              <div className="mb-2 flex items-center gap-2 flex-wrap min-h-[24px]">
                {!tmdbDetails ? <><div className="h-5 w-28 bg-zinc-800/80 rounded-md border border-white/5 animate-pulse" /><div className="h-5 w-16 bg-zinc-800/80 rounded-md border border-white/5 animate-pulse" /></>
                : <><span className="inline-flex items-center gap-1.5 px-2 py-1 bg-[#E5A93D]/20 text-[10px] font-bold tracking-widest text-[#E5A93D] uppercase rounded-md border border-[#E5A93D]/30 shrink-0">{isSeries ? <>📺 SÉRIE</> : isAtCinema ? <>🎟 AU CINÉMA • {formatRuntime(tmdbDetails?.runtime)}</> : <>🎬 FILM • {formatRuntime(tmdbDetails?.runtime)}</>}</span><span className={cn("inline-flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold tracking-wider uppercase rounded-md border shrink-0", ratingInfo.colorClass)} aria-label={ratingInfo.provenance ? `${ratingInfo.label}, classification ${ratingInfo.provenance}` : ratingInfo.label} title={ratingInfo.provenance ? `${ratingInfo.provenance} · ${ratingInfo.label}` : ratingInfo.label}><strong>{ratingInfo.label}</strong>{ratingInfo.provenance && <small className="text-[8px] normal-case font-semibold opacity-65">{ratingInfo.provenance}</small>}</span></>}
              </div>
              <div className="my-2 min-h-[64px] flex items-center">
                {logoPath ? <img src={`https://image.tmdb.org/t/p/w500${logoPath}`} alt={title} className="h-16 sm:h-20 w-auto max-w-full object-contain object-left filter drop-shadow-[0_4px_12px_rgba(0,0,0,0.9)]" loading="eager" decoding="async" onError={() => setLogoError(true)} />
                : title && title !== 'Chargement...' ? <h1 className="text-xl sm:text-2xl font-extrabold leading-tight drop-shadow-lg text-white line-clamp-2 sm:line-clamp-3">{title}</h1>
                : <div className="h-8 w-48 bg-zinc-800/80 rounded-lg animate-pulse" />}
              </div>
              {(() => {
                const year = tmdbDetails?.first_air_date?.substring(0, 4) || tmdbDetails?.release_date?.substring(0, 4) || show?.firstAirDate?.substring(0, 4) || '';
                const isUpcoming = !isSeries && !isAtCinema && (isMovieUpcoming(tmdbDetails) || isMovieUpcoming(show));
                const rawStatus = isSeries ? (tmdbDetails?.status || show?.status) : null;
                const statusText = rawStatus ? (rawStatus === 'Ended' ? 'Terminée' : rawStatus === 'Canceled' ? 'Annulée' : rawStatus === 'Returning Series' ? 'En cours' : rawStatus === 'In Production' ? 'En production' : rawStatus === 'Post Production' ? 'Post-production' : rawStatus === 'Planned' ? 'Prévue' : rawStatus === 'Pilot' ? 'Pilote' : rawStatus === 'ended' ? 'Terminée' : rawStatus === 'canceled' ? 'Annulée' : rawStatus === 'returning' ? 'En cours' : rawStatus) : null;
                const numberOfSeasons = tmdbDetails?.number_of_seasons || (show as Show & { totalSeasons?: number })?.totalSeasons;
                const hasTmdb = tmdbDetails?.vote_average != null && Number(tmdbDetails.vote_average) > 0;
                const tmdbRating = hasTmdb ? Number(tmdbDetails.vote_average).toFixed(1) : null;
                const isTmdbLoading = !tmdbDetails;
                return <div className="flex flex-col gap-2.5 mt-2">
                  {!tmdbDetails && !year ? <div className="h-4 w-36 bg-zinc-800/80 rounded animate-pulse my-0.5" /> : <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] sm:text-xs text-zinc-300 font-medium">
                    {(year || (!isSeries && isUpcoming)) && <span className="flex items-center gap-1.5">{year && <span>{year}</span>}{!isSeries && isUpcoming && <span className="text-purple-400 font-extrabold inline-flex items-center gap-1 bg-purple-500/10 px-2 py-0.5 rounded border border-purple-500/30 text-[10px]"><Calendar size={11} className="text-purple-400" />À venir</span>}</span>}
                    {year && statusText && <span className="text-zinc-600">•</span>}{statusText && <span>{statusText}</span>}{numberOfSeasons != null && numberOfSeasons > 0 && <>{(year || statusText) && <span className="text-zinc-600">•</span>}<span>{numberOfSeasons} Saison{numberOfSeasons > 1 ? 's' : ''}</span></>}
                  </div>}
                  <div className="flex flex-wrap items-center gap-2 mt-0.5 min-h-[26px]">
                    {hasTmdb ? <div className="flex items-center gap-1.5 px-2 py-1 bg-white/10 backdrop-blur-md border border-white/10 rounded-lg shadow-sm"><span className="text-[#01b4e4] font-black text-[9px] tracking-tight bg-black/20 px-1 rounded-sm">TMDB</span><span className="text-[11px] font-bold text-white">{tmdbRating}</span></div>
                    : isTmdbLoading ? <div className="flex items-center gap-1.5 px-2 py-1 bg-zinc-800/80 border border-white/5 rounded-lg animate-pulse"><span className="text-[#01b4e4]/60 font-black text-[9px] tracking-tight bg-black/20 px-1 rounded-sm">TMDB</span><div className="w-5 h-3 bg-zinc-700/60 rounded-xs" /></div> : null}
                  </div>
                </div>;
              })()}
            </div>
          </div>
          {(hasSeenMedia || (show && isSeries)) && show?.status !== 'dropped' && <div className="mt-5"><div className="flex justify-between text-[10px] font-bold text-zinc-400 mb-1.5 uppercase tracking-wider"><span className="text-white">{progressPercentage}% vu</span>{remainingTimeMinutes > 0 && <span>reste {formatRemainingTime(remainingTimeMinutes)}</span>}</div><div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">{seenCount > 0 && progressPercentage === 0 && totalEpisodes === 0 ? <div className="h-full w-full bg-zinc-700/50 animate-pulse rounded-full" /> : <div className="h-full bg-emerald-500 rounded-full transition-all duration-500 ease-out" style={{ width: `${progressPercentage}%` }} />}</div></div>}
          <div className="flex flex-col w-full mt-4 gap-2"><div className="flex items-center gap-3 w-full">
            {isSeries ? (!show ? <button onClick={followShow} className="flex-1 py-3.5 px-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all bg-[#E5A93D] text-black hover:bg-[#d49935] active:scale-95 shadow-lg shadow-[#E5A93D]/20 touch-manipulation cursor-pointer"><Plus size={18} /><span>Suivre la série</span></button>
            : show.status === 'dropped' ? <button onClick={resumeShow} className="flex-1 py-3.5 px-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all bg-[#E5A93D] text-black hover:bg-[#d49935] active:scale-95 shadow-lg shadow-[#E5A93D]/20 touch-manipulation cursor-pointer"><RotateCcw size={18} /><span>Reprendre la série</span></button>
            : show.isArchived ? <button onClick={rewatchShow} className="flex-1 py-3.5 px-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all bg-[#E5A93D]/20 text-[#E5A93D] border border-[#E5A93D]/30 hover:bg-[#E5A93D]/30 active:scale-95 touch-manipulation cursor-pointer"><RotateCcw size={18} /><span>Revoir la série</span></button>
            : epStatus ? (epStatus.isUpcoming ? <button onClick={handleWatchNextEpisode} className="flex-1 py-3.5 px-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all bg-zinc-800/80 text-zinc-300 border border-zinc-700/80 hover:bg-zinc-700 hover:text-white active:scale-95 touch-manipulation cursor-pointer" title="Ouvrir les détails et le synopsis de cet épisode"><Calendar size={18} className="text-amber-400" /><span>{epStatus.label}</span></button> : <button onClick={handleWatchNextEpisode} className="flex-1 py-3.5 px-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all bg-[#E5A93D] text-black hover:bg-[#d49935] active:scale-95 shadow-lg shadow-[#E5A93D]/20 touch-manipulation cursor-pointer"><CheckCircle2 size={18} /><span>{epStatus.label}</span></button>)
            : <div className="flex-1 py-3.5 px-4 rounded-2xl font-bold flex items-center justify-center gap-2 bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 select-none"><CheckCircle2 size={18} /><span>À jour sur la diffusion</span></div>)
            : (!show ? <button type="button" onClick={togglePlanToWatchMovie} className="flex-1 py-3.5 px-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all bg-[#E5A93D] text-black hover:bg-[#d49935] active:scale-95 shadow-lg shadow-[#E5A93D]/20 touch-manipulation cursor-pointer"><Plus size={18} /><span>Ajouter aux films à voir</span></button> : !hasSeenMedia ? <button type="button" onClick={toggleMovieSeen} className="flex-1 py-3.5 px-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all bg-[#E5A93D] text-black hover:bg-[#d49935] active:scale-95 shadow-lg shadow-[#E5A93D]/20 touch-manipulation cursor-pointer"><Check size={18} /><span>Marquer comme vu</span></button> : <button type="button" onClick={toggleMovieSeen} className="flex-1 py-3.5 px-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 active:scale-95 touch-manipulation cursor-pointer"><CheckCircle2 size={18} /><span>Film vu</span></button>)}
            {hasTrailer && <button onClick={() => setTrailerModalVideos(ytVideos)} className="w-12 h-12 bg-amber-500/10 border border-amber-500/30 rounded-2xl flex items-center justify-center text-amber-400 hover:text-amber-300 hover:bg-amber-500/20 hover:border-amber-400/50 hover:shadow-[0_0_20px_rgba(245,158,11,0.25)] shrink-0 active:scale-95 transition-all cursor-pointer backdrop-blur-md" title="Voir la bande-annonce"><Clapperboard size={20} className="stroke-[2]" /></button>}
            <button type="button" onClick={() => { setDownloadTargetSeason(undefined); setDownloadTargetEpisode(undefined); setIsDownloadModalOpen(true); }} className="w-12 h-12 bg-blue-500/15 border border-blue-500/40 rounded-2xl flex items-center justify-center text-blue-400 hover:text-blue-300 hover:bg-blue-500/25 hover:border-blue-400/60 hover:shadow-[0_0_20px_rgba(59,130,246,0.25)] shrink-0 active:scale-95 transition-all cursor-pointer backdrop-blur-md" title={isSeries ? "Télécharger la série (1080p / 4K)" : "Télécharger le film (1080p / 4K)"}><Download size={20} className="stroke-[2.2]" /></button>
            {hasSeenMedia && <button type="button" onClick={toggleFavorite} className={cn("w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 active:scale-95 transition-all cursor-pointer border", show?.isFavorite ? "bg-rose-500/20 border-rose-500/40 text-rose-500" : "bg-zinc-900 border-white/10 text-zinc-400 hover:text-white")} title={show?.isFavorite ? "Retirer des favoris" : "Ajouter aux favoris"}><Heart size={20} className={cn(show?.isFavorite && "fill-rose-500 text-rose-500")} /></button>}
          </div></div>
          {showDownloadSummary && <div className="mt-4 px-1"><div className={cn("flex items-center gap-2.5 rounded-2xl border px-3.5 py-3 text-xs font-bold backdrop-blur-md", hasActiveDownload ? "border-cyan-500/20 bg-cyan-500/[0.08] text-cyan-200" : hasCompletedDownload ? "border-emerald-500/20 bg-emerald-500/[0.08] text-emerald-300" : hasCancelledDownload ? "border-zinc-600/30 bg-zinc-500/[0.06] text-zinc-400" : "border-red-500/20 bg-red-500/[0.08] text-red-300")}>{hasActiveDownload ? <><Download size={16} className="shrink-0" /><span>Téléchargement en cours</span></> : hasCompletedDownload ? <><CheckCircle2 size={16} className="shrink-0" /><span>Téléchargement terminé</span></> : hasCancelledDownload ? <><X size={16} className="shrink-0" /><span>Téléchargement annulé</span></> : hasDownloadError ? <><X size={16} className="shrink-0" /><span>Téléchargement interrompu</span></> : null}</div></div>}
        </div>
      </div>

      <div ref={tabsRef} className="px-4 mt-6 sticky top-0 z-20 bg-black/90 backdrop-blur-xl pt-2 pb-2"><div className="flex gap-1 bg-zinc-900 p-1 rounded-full border border-white/5">
        <button onClick={() => handleTabChange('about')} className={cn("flex-1 py-2 text-xs font-bold tracking-wider uppercase transition-all rounded-full touch-manipulation", activeTab === 'about' ? "bg-zinc-800 text-[#E5A93D] shadow-lg" : "text-zinc-500")}>À propos</button>
        {isSeries && <button onClick={() => { handleTabChange('episodes'); if (expandedSeason === null) loadSeason(getSmartDefaultSeason(show, tmdbDetails)); }} className={cn("flex-1 py-2 text-xs font-bold tracking-wider uppercase transition-all rounded-full touch-manipulation", activeTab === 'episodes' ? "bg-zinc-800 text-[#E5A93D] shadow-lg" : "text-zinc-500")}>Épisodes</button>}
        <button onClick={() => { handleTabChange('casting'); setShowAllCast(false); }} className={cn("flex-1 py-2 text-xs font-bold tracking-wider uppercase transition-all rounded-full touch-manipulation", activeTab === 'casting' ? "bg-zinc-800 text-[#E5A93D] shadow-lg" : "text-zinc-500")}>Casting</button>
      </div></div>

      <div className="p-4 min-h-[400px] pb-6">
        <div id="section-about" className="scroll-mt-40 space-y-6 animate-in fade-in duration-200">
          <div><h3 className="text-xs font-bold uppercase text-zinc-500 tracking-wider mb-3">Synopsis</h3>{tmdbDetails?.overview ? <div><p onClick={() => setIsSynopsisExpanded(!isSynopsisExpanded)} className={cn("text-[13px] text-zinc-300 leading-relaxed cursor-pointer transition-all duration-300 ease-in-out", !isSynopsisExpanded && "line-clamp-3")}>{tmdbDetails.overview}</p>{!isSynopsisExpanded && tmdbDetails.overview.length > 120 && <button onClick={() => setIsSynopsisExpanded(true)} className="text-[11px] font-extrabold uppercase tracking-wider text-zinc-500 mt-1 hover:text-white transition-colors cursor-pointer">Suite...</button>}</div> : !tmdbDetails ? <div className="space-y-2 animate-pulse"><div className="h-3.5 bg-zinc-800/80 rounded w-full" /><div className="h-3.5 bg-zinc-800/80 rounded w-11/12" /><div className="h-3.5 bg-zinc-800/80 rounded w-4/5" /></div> : <p className="text-xs text-zinc-500 italic">Aucun synopsis disponible.</p>}</div>

          {(collectionData && collectionData.parts && collectionData.parts.length > 0) && <div><h3 className="text-xs font-bold uppercase text-zinc-500 tracking-wider mb-3">Ordre de visionnage</h3><div className="flex overflow-x-auto gap-3.5 hide-scrollbar py-2 px-1 -mx-1">{collectionData.parts.map((part: Parameters<typeof mediaKeyFrom>[0], idx: number) => <TimelineMediaCard key={`col_part_${part.media_type || 'media'}_${part.id}_${idx}`} media={part} isActive={mediaKeyFrom(part) === requestedMediaKey} onClick={() => onShowClick && onShowClick(part.id, part.media_type || (part.title ? 'movie' : 'tv'))} />)}</div></div>}
          {(universeData && universeData.parts && universeData.parts.length > 0) && <div className={collectionData?.parts?.length > 0 ? "mt-6" : ""}><h3 className="text-xs font-bold uppercase text-zinc-500 tracking-wider mb-3">{universeData.parts[0]?.seenitRelationKind === 'franchise' ? 'Dans la même franchise' : 'Dans le même univers'}</h3><div className="flex overflow-x-auto gap-3.5 hide-scrollbar py-2 px-1 -mx-1">{universeData.parts.map((part: Parameters<typeof mediaKeyFrom>[0], idx: number) => <TimelineMediaCard key={`univ_part_${part.media_type || 'media'}_${part.id}_${idx}`} media={part} isActive={mediaKeyFrom(part) === requestedMediaKey} onClick={() => onShowClick && onShowClick(part.id, part.media_type || (part.title ? 'movie' : 'tv'))} />)}</div></div>}
          {collectionLoading && <div data-seenit-relation-loading="true" aria-hidden="true"><h3 className="text-xs font-bold uppercase text-zinc-500 tracking-wider mb-3">Relations</h3><div className="flex overflow-x-auto gap-3.5 hide-scrollbar py-2 px-1 -mx-1">{[1,2,3,4].map(i => <div key={`saga_loader_${i}`} className="flex-none w-[120px] sm:w-[140px] animate-pulse"><div className="w-full aspect-[2/3] bg-zinc-800/80 rounded-xl" /><div className="mt-2 flex flex-col px-0.5"><div className="h-3 bg-zinc-800/80 rounded w-3/4" /><div className="h-2.5 bg-zinc-800/60 rounded w-1/3 mt-1" /></div></div>)}</div></div>}

          {!tmdbDetails ? <div className="col-span-2 bg-zinc-900/40 border border-white/5 p-4 rounded-2xl mt-1"><span className="block text-xs font-bold uppercase text-zinc-500 tracking-wider mb-3">Catégories & Thèmes</span><div className="flex flex-wrap gap-2 animate-pulse"><div className="h-7 w-20 bg-zinc-800/80 rounded-full" /><div className="h-7 w-24 bg-zinc-800/80 rounded-full" /><div className="h-7 w-16 bg-zinc-800/80 rounded-full" /></div></div>
          : (tmdbDetails?.genres?.length > 0 || keywords.length > 0) ? <div className="col-span-2 bg-zinc-900/40 border border-white/5 p-4 rounded-2xl mt-1"><span className="block text-xs font-bold uppercase text-zinc-500 tracking-wider mb-3">Catégories & Thèmes</span><div className="flex flex-wrap gap-2">{tmdbDetails?.genres?.map((g: { id: number; name: string }, idx: number) => <span key={`genre_${g.id}_${idx}`} className="px-3 py-1.5 bg-white/10 border border-white/15 text-white text-[11px] font-bold uppercase tracking-wide rounded-full backdrop-blur-md shadow-sm">{g.name}</span>)}<span id="series-theme-keywords" className="contents">{areThemesExpanded && keywords.map((kw: string, idx: number) => <span key={idx} className="px-3 py-1.5 bg-zinc-800/60 border border-zinc-700/50 text-zinc-300 hover:text-white transition-colors text-[11px] font-medium rounded-full capitalize">{kw}</span>)}</span>{keywords.length > 0 && <button type="button" onClick={() => setAreThemesExpanded(expanded => !expanded)} aria-expanded={areThemesExpanded} aria-controls="series-theme-keywords" className="min-h-11 px-2.5 py-1 rounded-full border border-white/10 text-zinc-400 text-[10px] font-semibold hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E5A93D]">{areThemesExpanded ? 'Masquer les thèmes' : `+${keywords.length} thèmes`}</button>}</div></div> : null}

          <div><div className="flex items-center gap-1.5 mb-2"><h3 className="text-xs font-bold uppercase text-zinc-500 tracking-wider">Où regarder</h3><button type="button" onClick={() => void refreshPlexAvailability()} disabled={!effectiveTmdbId || isRefreshingPlex} aria-label="Actualiser Plex" title="Actualiser Plex" className="inline-flex w-11 h-11 items-center justify-center rounded-full text-zinc-500 transition hover:text-white hover:bg-white/5 active:scale-95 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E5A93D]"><RefreshCw size={16} className={cn(isRefreshingPlex && "animate-spin")} /></button></div>{(() => {
            const hasProviders = sortedProviders.length > 0;
            const isLoadingPlex = plexMediaInfo === null;
            const isLoadingProviders = providers === null;
            if (hasProviders) return <div className="flex items-center gap-2 flex-wrap">{sortedProviders.map((provider: StreamingProviderItem, idx: number) => {
              if (provider.isPlex) return <button type="button" key={`plex-provider-item-${idx}`} onClick={(e) => { e.preventDefault(); openPlexWatchUrl(show || { id: show?.id, tmdbId: effectiveTmdbId, imdbId: tmdbDetails?.external_ids?.imdb_id || tmdbDetails?.imdb_id || show?.imdbId, title: (title !== 'Chargement...' ? title : '') || tmdbDetails?.title || tmdbDetails?.name, originalTitle: tmdbDetails?.original_title || tmdbDetails?.original_name || show?.originalTitle, year: releaseYear, mediaType: isSeries ? 'tv' : 'movie' }); }} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-[#E5A93D]/40 bg-[#E5A93D]/10 text-[#E5A93D] hover:bg-[#E5A93D]/20 text-xs font-bold transition-all active:scale-95 cursor-pointer shadow-[0_0_12px_rgba(229,169,61,0.2)]" title={`Disponible sur Plex : ${provider.serverName || 'Serveur'}`}><img src={PLEX_LOGO_SVG} alt="Plex" className="w-4 h-4 object-contain rounded shrink-0" /><span>Disponible sur Plex {provider.serverName ? `(${provider.serverName})` : ''}</span></button>;
              const isSubscribed = userPlatforms.includes(provider.provider_id);
              const providerLink = getProviderLinkPresentation({
                providerId: provider.provider_id,
                providerName: provider.provider_name,
                title,
                fallbackLink: providers?.link || '#',
              });
              const directLink = providerLink.url;
              const logoUrl = getFormattedProviderLogo(provider.logo_path, provider.provider_name);
              const providerContent = <>{logoUrl ? <img loading="lazy" decoding="async" src={logoUrl} alt={provider.provider_name} className="w-4 h-4 object-cover rounded shrink-0" /> : <MonitorPlay size={14} className={cn("shrink-0", isSubscribed ? "text-amber-400" : "text-zinc-400")} />}<span>{providerLink.label}</span></>;
              if (!directLink) return <span key={`provider_${provider.provider_id}_${idx}`} className={cn("inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-bold", isSubscribed ? "bg-amber-500/10 border-amber-500/30 text-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.15)]" : "bg-zinc-900/80 border-white/10 text-zinc-400")} title={providerLink.title} aria-label={providerLink.title}>{providerContent}</span>;
              return <a key={`provider_${provider.provider_id}_${idx}`} href={directLink} target="_blank" rel="noopener noreferrer" onClick={(e) => { if (directLink !== '#') { e.preventDefault(); openExternalUrl(directLink); } }} className={cn("inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all active:scale-95 cursor-pointer", isSubscribed ? "bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20 hover:border-amber-400/50 shadow-[0_0_10px_rgba(245,158,11,0.15)]" : "bg-zinc-900/80 border-white/10 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800")} title={providerLink.title}>{providerContent}</a>;
            })}{(isLoadingPlex || isLoadingProviders) && <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-zinc-900/60 border border-white/5 text-zinc-400 text-xs animate-pulse"><img src={PLEX_LOGO_SVG} alt="Plex" className="w-3.5 h-3.5 object-contain rounded shrink-0" /><span className="whitespace-nowrap">Recherche Plex & streaming…</span></div>}</div>;
            if (isLoadingPlex || isLoadingProviders) return <div className="flex items-center gap-2 flex-wrap"><div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-white/10 bg-zinc-900/80 text-zinc-400 text-xs font-medium animate-pulse"><img src={PLEX_LOGO_SVG} alt="Plex" className="w-4 h-4 object-contain rounded shrink-0" /><span className="whitespace-nowrap">Recherche Plex & streaming…</span></div></div>;
            return <div className="flex items-center gap-3 flex-wrap">{isUnreleased ? <p className="text-xs text-zinc-500 italic font-medium flex items-center gap-1.5"><Clock size={14} /><span>Bientôt disponible</span></p> : <div className="flex items-center gap-2 flex-wrap">{!isSeries ? <button type="button" onClick={(e) => handle1ClickDownloadMovie(e)} disabled={is1ClickDownloading.movie} className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-blue-500/40 bg-blue-500/15 hover:bg-blue-500/25 active:scale-95 text-xs font-bold text-blue-300 transition-all cursor-pointer shadow-[0_0_15px_rgba(59,130,246,0.25)]" title="Télécharger le film en 1 clic dans Radarr"><Download size={14} className={cn("text-blue-300 stroke-[2.5]", is1ClickDownloading.movie && "animate-spin")} /><span>{is1ClickDownloading.movie ? "Lancement Radarr..." : "Télécharger le film (1 Clic)"}</span></button> : <button type="button" onClick={() => setIsDownloadModalOpen(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-blue-500/40 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 active:scale-95 text-xs font-bold transition-all cursor-pointer shadow-[0_0_12px_rgba(59,130,246,0.2)]" title="Rechercher et télécharger sur Sonarr / C411"><Download size={14} className="shrink-0" /><span>Télécharger</span></button>}</div>}</div>;
          })()}</div>

          <div className="pt-1"><RedditSection query={isSeries ? `${redditVisibleTitle} series discussion` : redditMovieQuery} resolveQuery={isSeries ? undefined : resolveRedditMovieQuery} isLocked={false} title="Discussions Reddit" description="Retrouvez les avis, théories et spoilers de la communauté." /></div>
        </div>

        {isSeries && <div id="section-episodes" className="scroll-mt-40 mt-12 space-y-4 animate-in fade-in duration-200">
          <div className="flex items-center justify-between gap-2 mb-2"><h3 className="text-xs font-bold uppercase text-zinc-500 tracking-wider">Épisodes</h3><button type="button" onClick={() => setIsDownloadMode(!isDownloadMode)} className={cn("px-2.5 py-1 rounded-xl border text-[11px] font-bold flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer", isDownloadMode ? "bg-blue-500/20 border-blue-500/40 text-blue-300 shadow-[0_0_12px_rgba(59,130,246,0.25)]" : "bg-zinc-800/80 border-white/10 text-zinc-400 hover:text-white")} title="Activer le mode téléchargement 1-clic direct vers Sonarr"><Download size={12} className={cn(isDownloadMode && "text-blue-400 animate-pulse")} /><span>{isDownloadMode ? "Mode Téléchargement (Actif)" : "Téléchargement 1-Clic"}</span></button></div>
          {tmdbDetails?.seasons?.length > 0 && <EpisodeRatingsChart effectiveTmdbId={effectiveTmdbId} seasons={tmdbDetails.seasons} seasonsCache={seasonsCache} onLoadSeason={async (sNum) => { if (!effectiveTmdbId || seasonsCache[sNum]) return; const res = await tmdb.getSeasonDetails(effectiveTmdbId, sNum); if (res.ok) setSeasonsCache(prev => ({ ...prev, [sNum]: res.value })); }} onSelectEpisode={(seasonNum, ep) => openEpisodeModal(seasonNum, ep)} defaultSeasonNumber={expandedSeason || getSmartDefaultSeason(show, tmdbDetails)} />}
          {tmdbDetails?.seasons?.filter((s: any) => s.season_number > 0).slice(0, visibleSeasons).map((season: any, idx: number) => {
            const seasonNum = season.season_number;
            const seasonEpCount = season.episode_count || 0;
            const cachedSeason = seasonsCache[seasonNum];
            const displayAirDate = cachedSeason?.episodes?.[0]?.air_date || season.air_date;
            const todayStr = getTodayStr();
            const isFutureByDate = displayAirDate ? displayAirDate > todayStr : false;
            const hasAiredEpisodesInCache = cachedSeason?.episodes?.some((ep: any) => !ep.air_date || ep.air_date <= todayStr);
            const isFutureSeason = isFutureByDate || seasonEpCount === 0 || (cachedSeason?.episodes && !hasAiredEpisodesInCache);
            const seasonPrefix = `${seasonNum}x`;
            const watchedInSeason = (show?.seenEpisodes || []).filter(epKey => epKey.startsWith(seasonPrefix)).length;
            const isFullyWatched = seasonEpCount > 0 && watchedInSeason >= seasonEpCount;
            return <div key={`season_${season.id || season.season_number}_${idx}`} className={cn("bg-[#1a1b26] border border-white/5 rounded-2xl overflow-hidden transition-all", isFutureSeason && "opacity-75")}>
              <div className="w-full p-4 flex items-center gap-3">
                <button type="button" onClick={() => loadSeason(seasonNum)} aria-expanded={expandedSeason === seasonNum} aria-controls={`season-panel-${seasonNum}`} className="flex-1 min-h-11 flex items-center text-left touch-manipulation py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E5A93D] rounded-lg"><div className="flex items-center gap-3 w-full min-w-0"><h3 className="font-bold text-white text-[15px] whitespace-nowrap">Saison {seasonNum}{seasonEpCount > 0 && <span className="text-zinc-400 font-semibold text-xs ml-1.5">({watchedInSeason}/{seasonEpCount})</span>}</h3>{!isFutureSeason && seasonEpCount > 0 && show?.status !== 'dropped' && <div className="w-12 h-1 bg-zinc-800 rounded-full overflow-hidden flex items-center shrink-0"><div className="h-full bg-emerald-500" style={{ width: `${(watchedInSeason / seasonEpCount) * 100}%` }} /></div>}{isFutureSeason && displayAirDate && <span className="inline-block bg-amber-500/20 border border-amber-500/30 text-amber-400 text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md truncate">PROCHAINEMENT • {formatAirDateSafe(displayAirDate, 'long')}</span>}</div></button>
                {!isFutureSeason && seasonEpCount > 0 && <button type="button" onClick={(e) => toggleSeasonSeen(e, seasonNum, seasonEpCount)} className={cn("min-h-11 px-2 py-1 rounded-full border text-[10px] font-bold flex items-center gap-1 transition-colors active:scale-95 touch-manipulation shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E5A93D]", isFullyWatched ? "border-emerald-500 bg-emerald-500/15 text-emerald-400 font-bold" : "border-[#E5A93D]/30 text-[#E5A93D] hover:bg-[#E5A93D]/5 font-bold")} aria-label={isFullyWatched ? "Marquer toute la saison comme non vue" : "Marquer toute la saison comme vue"} title={isFullyWatched ? "Marquer toute la saison comme non vue" : "Marquer toute la saison comme vue"}>{isFullyWatched ? "Tout marquer non vu" : "Tout marquer vu"}</button>}
                {!isFutureSeason && <button type="button" onClick={(e) => handle1ClickDownloadSeason(e, seasonNum)} disabled={is1ClickDownloading[`S${seasonNum}`]} className="p-1.5 px-2.5 rounded-full border border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 hover:text-blue-300 text-[10px] font-bold flex items-center gap-1 transition-colors active:scale-95 touch-manipulation uppercase tracking-wider shrink-0 cursor-pointer disabled:opacity-50" title={`Télécharger la saison ${seasonNum} en 1 clic dans Sonarr`}><Download size={12} className={cn("text-blue-400", is1ClickDownloading[`S${seasonNum}`] && "animate-spin")} /><span className="hidden sm:inline">S{seasonNum}</span></button>}
              </div>
              {expandedSeason === season.season_number && <div id={`season-panel-${seasonNum}`} className="bg-[#1a1b26] border-t border-white/5 divide-y divide-white/5 animate-in fade-in duration-200">
                {!seasonsCache[season.season_number] ? <div className="p-4 space-y-3 animate-pulse">{[1,2,3].map(i => <div key={i} className="flex items-center gap-3"><div className="w-24 h-16 rounded-xl bg-zinc-800/80 shrink-0" /><div className="flex-1 space-y-2"><div className="h-4 bg-zinc-800/80 rounded w-3/4" /><div className="h-3 bg-zinc-800/60 rounded w-1/2" /></div></div>)}</div>
                : <>{(() => {
                  const seasonVideos = seasonsCache[season.season_number].videos?.results?.filter((v: any) => v.site === 'YouTube') || [];
                  return seasonVideos.length > 0 ? <div className="p-3"><button onClick={() => setTrailerModalVideos(seasonVideos)} className="w-full py-2.5 px-4 bg-gradient-to-r from-amber-500/15 via-amber-500/10 to-amber-600/15 border border-amber-500/30 rounded-xl flex items-center justify-center gap-2 text-amber-300 hover:text-amber-200 hover:bg-amber-500/20 hover:border-amber-400/40 transition-all cursor-pointer font-bold text-xs shadow-[0_0_15px_rgba(245,158,11,0.15)] active:scale-[0.98]"><Clapperboard size={16} className="text-amber-400 stroke-[2.2]" /><span>Bande-annonce de la saison {seasonNum}</span></button></div> : null;
                })()}
                {(!seasonsCache[season.season_number].episodes || seasonsCache[season.season_number].episodes.length === 0) ? <div className="p-6 flex flex-col items-center justify-center gap-2 text-center border-t border-white/5 bg-[#1a1b26]/50"><span className="text-sm font-bold text-zinc-300">Saison annoncée</span><span className="text-xs text-zinc-500 font-medium max-w-[200px]">Les épisodes de cette saison seront disponibles prochainement.</span></div>
                : seasonsCache[season.season_number].episodes.map((ep: any, epIdx: number) => {
                  const epKey = `${season.season_number}x${ep.episode_number}`;
                  const isSeen = show?.seenEpisodes?.includes(epKey);
                  const isFutureEp = ep.air_date ? ep.air_date > todayStr : false;
                  const epDownload = getEpisodeDownload(effectiveTmdbId, tmdbDetails?.external_ids?.tvdb_id || show?.tvdbId, season.season_number, ep.episode_number);
                  const isDownloadingThis = is1ClickDownloading[`S${season.season_number}E${ep.episode_number}`];
                  return <div key={`ep_${ep.id || ep.episode_number}_${epIdx}`} onClick={() => openEpisodeModal(season.season_number, ep)} className={cn("p-3 flex items-center gap-3 hover:bg-white/5 transition-colors cursor-pointer active:bg-white/10 relative", isFutureEp && "opacity-50")}>
                    <div className="relative w-24 h-16 rounded-xl overflow-hidden bg-zinc-800 shrink-0 border border-white/5">{ep.still_path && <img loading="lazy" decoding="async" src={`https://image.tmdb.org/t/p/w300${ep.still_path}`} className="w-full h-full object-cover" alt="" />}<div className="absolute inset-0 bg-black/20" /></div>
                    <div className="flex-1 min-w-0"><div className="flex items-center gap-2 mb-0.5 flex-wrap">{(() => { const airDateLabel = getEpisodeAirDateLabel(ep.air_date); return airDateLabel ? <span className="inline-block bg-amber-500/20 border border-amber-500/30 text-amber-400 text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md mb-1 w-max">{airDateLabel}</span> : null; })()}</div><p className={cn("text-[14px] font-bold truncate leading-tight", isSeen ? "text-zinc-500 line-through" : "text-zinc-200")}>{ep.name}</p><p className="text-[12px] font-semibold text-zinc-500 mt-1">E{(ep.episode_number ?? 1).toString().padStart(2, '0')} • {ep.runtime ? `${ep.runtime}min` : '45min'}</p></div>
                    <div className="flex flex-col gap-2 shrink-0 items-end">{epDownload ? <div className="scale-[0.85] origin-right" onClick={(e) => e.stopPropagation()}><LiveDownloadBanner items={[epDownload]} compact={true} /></div>
                    : isDownloadMode ? <button type="button" onClick={(e) => handle1ClickDownloadEpisode(e, season.season_number, ep.episode_number)} disabled={isDownloadingThis} className="p-2.5 rounded-xl border border-blue-500/40 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 transition-all active:scale-90 touch-manipulation cursor-pointer shadow-[0_0_12px_rgba(59,130,246,0.3)] disabled:opacity-50" title="Télécharger l'épisode en 1 clic dans Sonarr"><Download size={16} className={cn("text-blue-300 stroke-[2.5]", isDownloadingThis && "animate-spin")} /></button>
                    : <div className="flex items-center gap-1">{!isFutureEp && <button type="button" onClick={(e) => handle1ClickDownloadEpisode(e, season.season_number, ep.episode_number)} disabled={isDownloadingThis} className="p-1.5 rounded-full border border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 transition-colors active:scale-95 touch-manipulation cursor-pointer disabled:opacity-50" title="Télécharger en 1 clic dans Sonarr"><Download size={13} className={cn("text-blue-400", isDownloadingThis && "animate-spin")} /></button>}{!isFutureEp && <button onClick={(e) => toggleEpisodeSeen(e, season.season_number, ep.episode_number)} className="p-1.5 touch-manipulation active:scale-90 transition-transform">{isSeen ? <div className="w-5 h-5 rounded-full border border-emerald-500 flex items-center justify-center bg-emerald-500/15"><Check size={12} className="text-emerald-400 stroke-[3]" /></div> : <div className="w-5 h-5 rounded-full border border-zinc-700" />}</button>}</div>}</div>
                  </div>;
                })}</>}
              </div>}
            </div>;
          })}
          {tmdbDetails?.seasons?.filter((s: any) => s.season_number > 0).length > visibleSeasons && <div ref={seasonObserverRef} className="h-10 w-full flex items-center justify-center"><div className="animate-spin rounded-full h-5 w-5 border-b-2 border-[#E5A93D]" /></div>}
        </div>}

        <div id="section-casting" className="scroll-mt-40 mt-12 animate-in fade-in duration-200"><h3 className="text-xs font-bold uppercase text-zinc-500 tracking-wider mb-3">Casting</h3>{(() => {
          const castingPayloadKnown = isSeries
            ? Boolean(tmdbDetails?.aggregate_credits || tmdbDetails?.credits)
            : Boolean(tmdbDetails?.credits);
          const cast = (tmdbDetails?.aggregate_credits?.cast || tmdbDetails?.credits?.cast || []) as any[];
          if (!tmdbDetails || !castingPayloadKnown) return <div data-seenit-casting-loading="true" className="grid grid-cols-3 sm:grid-cols-4 gap-4 py-2" aria-hidden="true">{Array.from({ length: 6 }, (_, actorIdx) => <div key={`actor_loader_${actorIdx}`} className="min-h-11 flex flex-col items-center animate-pulse"><div className="w-20 h-20 rounded-full bg-zinc-800/80 border border-white/10 mb-2" /><div className="h-3 w-16 bg-zinc-800/80 rounded mb-1.5" /><div className="h-2.5 w-14 bg-zinc-800/60 rounded" /></div>)}</div>;
          if (cast.length === 0) return <p className="text-xs text-zinc-500 italic">Aucun casting disponible.</p>;
          return <div className="grid grid-cols-3 sm:grid-cols-4 gap-4 py-2">{cast.map((actor: any, actorIdx: number) => <button type="button" key={`actor_${actor.id}_${actorIdx}`} onClick={() => openPersonModal(actor.id)} aria-label={`Ouvrir la fiche de ${actor.name}`} className="min-h-11 flex flex-col items-center cursor-pointer group active:scale-95 transition-transform rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E5A93D]"><div className="w-20 h-20 rounded-full overflow-hidden bg-zinc-800 border border-white/10 shadow-md mb-2">{actor.profile_path ? <img loading="lazy" decoding="async" src={`https://image.tmdb.org/t/p/w185${actor.profile_path}`} className="w-full h-full object-cover object-[50%_25%] group-hover:scale-105 transition-transform duration-300" alt="" /> : <div className="w-full h-full flex items-center justify-center text-xs font-bold text-zinc-600">{actor.name?.charAt(0)}</div>}</div><p className="text-xs font-bold text-zinc-100 text-center line-clamp-2 min-h-[2.2em] w-full">{actor.name}</p><p className="text-[10px] text-zinc-500 text-center line-clamp-2 min-h-[2.2em] w-full mt-0.5">{actor.roles && actor.roles.length > 0 ? actor.roles.map((r: any) => r.character).filter(Boolean).join(' / ') || 'Rôle inconnu' : (actor.character || 'Rôle inconnu')}</p>{Number(actor.total_episode_count || actor.episode_count || 0) > 1 && <span className="mt-1 text-[9px] font-medium text-zinc-600">{actor.total_episode_count || actor.episode_count} ép.</span>}</button>)}</div>;
        })()}</div>
      </div>

      {selectedEpisode && <EpisodeDetailModal show={show} season={selectedEpisode.season} episode={selectedEpisode.episode} tmdbShowTitle={tmdbDetails?.name || tmdbDetails?.title} tmdbShowId={effectiveTmdbId}
        onShowClick={(tmdbId) => { setSelectedEpisode(null); if (window.history.state?.isEpisodeDetailModal || window.history.state?.isModal) window.history.back(); const isSameShow = (effectiveTmdbId && Number(effectiveTmdbId) === Number(tmdbId)) || (show?.tmdbId && Number(show.tmdbId) === Number(tmdbId)) || (show?.id && String(show.id) === String(tmdbId)); if (!isSameShow && onShowClick) setTimeout(() => onShowClick(tmdbId, show?.mediaType || 'tv'), 50); }}
        onClose={() => { setSelectedEpisode(null); if (window.history.state?.isEpisodeDetailModal || window.history.state?.isModal) window.history.back(); }}
        onLoadSeason={async (seasonNum) => { if (!effectiveTmdbId) return null; if (seasonsCache[seasonNum]) return seasonsCache[seasonNum]?.episodes || seasonsCache[seasonNum]; const res = await tmdb.getSeasonDetails(effectiveTmdbId, seasonNum); if (res.ok && res.value) { setSeasonsCache(prev => ({ ...prev, [seasonNum]: res.value })); return res.value.episodes || res.value; } return null; }} />}
      {selectedPersonId && <PersonDetailModal personId={selectedPersonId}
        onClose={() => { setSelectedPersonId(null); if (window.history.state?.isPersonDetailModal || window.history.state?.isModal) window.history.back(); }}
        onShowClick={(tmdbId, type) => { setSelectedPersonId(null); if (window.history.state?.isPersonDetailModal || window.history.state?.isModal) window.history.back(); const isSameShow = (effectiveTmdbId && Number(effectiveTmdbId) === Number(tmdbId)) || (show?.tmdbId && Number(show.tmdbId) === Number(tmdbId)) || (show?.id && String(show.id) === String(tmdbId)); if (!isSameShow && onShowClick) setTimeout(() => onShowClick(tmdbId, type || 'movie'), 50); }} />}
      {trailerModalVideos && <TrailerModal videos={trailerModalVideos} onClose={() => setTrailerModalVideos(null)} />}
      {isDownloadModalOpen && <DownloadModal isOpen={isDownloadModalOpen} onClose={() => { setIsDownloadModalOpen(false); setDownloadTargetSeason(undefined); setDownloadTargetEpisode(undefined); }} title={title} originalTitle={tmdbDetails?.original_title || tmdbDetails?.original_name || show?.originalTitle} year={(tmdbDetails?.release_date || tmdbDetails?.first_air_date || show?.firstAirDate)?.slice(0, 4)} mediaType={isSeries ? 'tv' : 'movie'} tmdbId={effectiveTmdbId} tvdbId={tmdbDetails?.external_ids?.tvdb_id || show?.tvdbId} imdbId={tmdbDetails?.external_ids?.imdb_id || show?.imdbId} posterPath={posterPath || tmdbDetails?.poster_path || show?.posterPath} initialSeason={downloadTargetSeason} initialEpisode={downloadTargetEpisode} totalSeasons={tmdbDetails?.number_of_seasons || tmdbDetails?.seasons?.filter((season: { season_number: number }) => season.season_number > 0)?.length || 1} seasonsData={tmdbDetails?.seasons} onSuccessToast={(msg) => showToast(msg, 'success', show || undefined)} />}
    </div>
  );
}
