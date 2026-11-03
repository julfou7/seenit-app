import { DialogLayer } from '../components/ui/DialogLayer';
import React, { useMemo } from 'react';
import { tmdb, isMovieAtCinema, isMovieUpcoming } from '../features/shows/tmdb';
import { ChevronLeft, Heart, MoreVertical, Bookmark, Play, RefreshCw, RotateCcw, Ban, Trash2, Download, Share2 } from 'lucide-react';
import { cn, openExternalUrl } from '../lib/utils';
import { EpisodeDetailModal } from './EpisodeDetailModal';
import { PersonDetailModal } from './PersonDetailModal';
import { TrailerModal } from '../components/TrailerModal';
import { DownloadModal } from '../components/DownloadModal';
import { useShowsStore } from '../store/showsStore';
import { getFormattedProviderLogo, PLEX_LOGO_SVG } from '../utils/providerLogos';
import { openPlexWatchUrl } from '../features/plex/syncPlex';
import { RedditSection } from '../components/community/RedditSection';
import { buildRedditMovieSearchQuery } from '../components/community/redditEpisodeSearch';
import { getProviderLinkPresentation } from '../features/providers/providerLink';
import { seasonAverages, formatRating } from '../features/shows/detailPlanning';
import { DetailChip, DetailHero, DetailSynopsis, GoldCta, RoundHeaderButton, SquareAction, WhereToWatchCard, type WhereToWatchProvider } from './mediaDetail/detailUi';
import { CastRows, RelationList, RelationsLoading, ThemesCard } from './mediaDetail/detailSections';
import { SeasonAverageChart, SeasonPanel, SeasonPills, SeriesProgressCard, seasonsOf } from './mediaDetail/seriesSections';
import { MovieEndCard, VerifiedSimilarRail } from './mediaDetail/movieSections';

interface ShowDetailViewProps {
  model: Record<string, any>;
}

const STATUS_LABELS: Record<string, string> = { Ended: 'Terminée', Canceled: 'Annulée', 'Returning Series': 'En cours', 'In Production': 'En production', 'Post Production': 'Post-production', Planned: 'Prévue', Pilot: 'Pilote', ended: 'Terminée', canceled: 'Annulée', returning: 'En cours' };

export function formatDuration(minutes?: number | null): string {
  if (!minutes || minutes <= 0) return '';
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return hours > 0 ? `${hours} h ${String(rest).padStart(2, '0')}` : `${rest} min`;
}

/**
 * SEENIT-UX-019 — Fiches série et film au style du prototype : un seul défilement (plus d'onglets),
 * hero titré en or, carte de progression, saisons en pastilles, Où regarder en lignes, Personnages,
 * relations en frise et « Similaires, et pourquoi » (films). Les actions de cycle de vie restent dans ⋮.
 */
export function ShowDetailView({ model }: ShowDetailViewProps) {
  const { areThemesExpanded, backdropUrl, collectionData, collectionLoading, downloadTargetEpisode, downloadTargetSeason, dropShow, effectiveTmdbId, epStatus, expandedSeason, followShow, handleAnimatedBack, handleDeleteShow, handleShare, handleSyncSingle, handleWatchNextEpisode, hasSeenMedia, hasTrailer, isDownloadModalOpen, isExiting, isRefreshingPlex, isSeries, isSyncingSingle, isSynopsisExpanded, isUnreleased, keywords, loadSeason, mainScrollRef, nextEp, onShowClick, openEpisodeModal, openPersonModal, plexMediaInfo, posterPath, providers, ratingInfo, refreshPlexAvailability, releaseYear, remainingTimeMinutes, requestedMediaKey, resumeShow, rewatchShow, seasonsCache, seenCount, selectedEpisode, selectedPersonId, setAreThemesExpanded, setDownloadTargetEpisode, setDownloadTargetSeason, setIsDownloadModalOpen, setIsSynopsisExpanded, setSeasonsCache, setSelectedEpisode, setSelectedPersonId, setShowMenu, setTrailerModalVideos, show, showMenu, showToast, sortedProviders, title, tmdbDetails, toggleEpisodeSeen, toggleFavorite, toggleMovieSeen, togglePlanToWatchMovie, toggleSeasonSeen, totalEpisodes, trailerModalVideos, universeData, userPlatforms, ytVideos } = model;
  const libraryShows = useShowsStore(state => state.shows);
  const redditVisibleTitle = tmdbDetails?.name || tmdbDetails?.title || show?.title || '';
  const redditMovieOriginalTitle = tmdbDetails?.original_title || show?.originalTitle || null;
  const isAtCinema = !isSeries && (isMovieAtCinema(tmdbDetails) || isMovieAtCinema(show));
  const isUpcomingMovie = !isSeries && !isAtCinema && (isMovieUpcoming(tmdbDetails) || isMovieUpcoming(show));
  const redditMovieQuery = buildRedditMovieSearchQuery({ movieTitle: redditVisibleTitle, originalMovieTitle: redditMovieOriginalTitle });
  const resolveRedditMovieQuery = async () => {
    if (isSeries || !effectiveTmdbId) return redditMovieQuery;
    const englishTitleResult = await tmdb.getEnglishMediaTitle(Number(effectiveTmdbId), 'movie');
    return buildRedditMovieSearchQuery({ movieTitle: redditVisibleTitle, communityMovieTitle: englishTitleResult.ok ? englishTitleResult.value : null, originalMovieTitle: redditMovieOriginalTitle });
  };

  const seasons = useMemo(() => seasonsOf(tmdbDetails), [tmdbDetails]);
  const averages = useMemo(() => seasonAverages(tmdbDetails?.seasons), [tmdbDetails?.seasons]);
  const runtimeFallback = Number(tmdbDetails?.episode_run_time?.[0]) || 45;
  const genres: Array<{ id: number; name: string }> = tmdbDetails?.genres || [];
  const year = (tmdbDetails?.first_air_date || tmdbDetails?.release_date || show?.firstAirDate || '').slice(0, 4);
  const rawStatus = isSeries ? (tmdbDetails?.status || show?.status) : null;
  const statusText = rawStatus ? STATUS_LABELS[rawStatus] || null : null;
  const lastYear = (tmdbDetails?.last_air_date || '').slice(0, 4);
  const years = isSeries && year && lastYear && lastYear !== year && (rawStatus === 'Ended' || rawStatus === 'Canceled') ? `${year}–${lastYear}` : year;
  const seasonCount = tmdbDetails?.number_of_seasons || seasons.length;
  const meta = isSeries
    ? [years, seasonCount ? `${seasonCount} saison${seasonCount > 1 ? 's' : ''}` : '', statusText && statusText !== 'Terminée' ? statusText : '', genres.slice(0, 2).map(genre => genre.name).join(', ')].filter(Boolean).join(' · ')
    : [year, formatDuration(tmdbDetails?.runtime), genres.slice(0, 2).map(genre => genre.name).join(', ')].filter(Boolean).join(' · ');
  const tmdbRating = Number(tmdbDetails?.vote_average) > 0 ? formatRating(Number(tmdbDetails.vote_average)) : null;

  const openPlex = () => { void openPlexWatchUrl(show || { id: show?.id, tmdbId: effectiveTmdbId, imdbId: tmdbDetails?.external_ids?.imdb_id || tmdbDetails?.imdb_id || show?.imdbId, title: (title !== 'Chargement...' ? title : '') || tmdbDetails?.title || tmdbDetails?.name, originalTitle: tmdbDetails?.original_title || tmdbDetails?.original_name || show?.originalTitle, year: releaseYear, mediaType: isSeries ? 'tv' : 'movie' }); };
  const openProvider = (provider: WhereToWatchProvider) => {
    if (provider.isPlex) return openPlex();
    const link = getProviderLinkPresentation({ providerId: provider.provider_id, providerName: provider.provider_name, title, fallbackLink: providers?.link || '#' });
    if (link.url && link.url !== '#') openExternalUrl(link.url);
  };
  const mainProvider: WhereToWatchProvider | undefined = sortedProviders.find((provider: WhereToWatchProvider) => !provider.isPlex && userPlatforms.includes(provider.provider_id)) || sortedProviders.find((provider: WhereToWatchProvider) => !provider.isPlex);
  const plexProvider: WhereToWatchProvider | undefined = sortedProviders.find((provider: WhereToWatchProvider) => provider.isPlex);
  const providerTile = (provider: WhereToWatchProvider) => {
    const logo = provider.isPlex ? PLEX_LOGO_SVG : getFormattedProviderLogo(provider.logo_path, provider.provider_name);
    return <button type="button" key={`tile-${provider.provider_id}`} onClick={() => openProvider(provider)} aria-label={`Ouvrir ${provider.isPlex ? 'Plex' : provider.provider_name}`} className="w-[52px] h-[52px] shrink-0 rounded-[15px] overflow-hidden bg-zinc-800 shadow-[0_0_0_1px_rgba(255,255,255,0.12)] active:scale-95">{logo ? <img src={logo} alt="" className="w-full h-full object-cover" /> : <span className="text-[12px] font-bold">{provider.provider_name.slice(0, 2)}</span>}</button>;
  };

  const nextKey = isSeries && nextEp ? `${nextEp.season_number}x${nextEp.episode_number}` : null;
  const seriesCta = (() => {
    if (!show) return <GoldCta label="Suivre la série" onClick={followShow} />;
    if (show.status === 'dropped') return <GoldCta label="Reprendre la série" onClick={resumeShow} />;
    if (show.isArchived) return <GoldCta tone="done" label="Revoir la série" onClick={rewatchShow} />;
    if (!epStatus) return <GoldCta tone="done" label="✓ Série à jour" ariaLabel="Série à jour sur la diffusion" />;
    if (epStatus.isUpcoming) return <GoldCta tone="neutral" label={epStatus.label} sub="Ouvrir l’épisode" onClick={handleWatchNextEpisode} />;
    const code = `S${String(nextEp.season_number).padStart(2, '0')} | E${String(nextEp.episode_number).padStart(2, '0')}`;
    return <GoldCta label={`Marquer ${code} vu`} sub={[nextEp.name, `${nextEp.runtime || runtimeFallback} min`].filter(Boolean).join(' · ')} onClick={event => toggleEpisodeSeen(event, nextEp.season_number, nextEp.episode_number)} />;
  })();

  const selectedSeason = seasons.find(season => season.season_number === expandedSeason) || null;
  const selectedEpisodes = selectedSeason ? seasonsCache[selectedSeason.season_number]?.episodes || null : null;
  const seasonVideos = selectedSeason ? (seasonsCache[selectedSeason.season_number]?.videos?.results || []).filter((video: { site?: string }) => video.site === 'YouTube') : [];
  const castPayloadKnown = isSeries ? Boolean(tmdbDetails?.aggregate_credits || tmdbDetails?.credits) : Boolean(tmdbDetails?.credits);
  const cast = (tmdbDetails?.aggregate_credits?.cast || tmdbDetails?.credits?.cast || []);
  const collectionIds = useMemo(() => new Set<number>((collectionData?.parts || []).map((part: { id: number }) => Number(part.id))), [collectionData]);
  const relationOpen = (part: { id: number; media_type?: string; title?: string }) => onShowClick && onShowClick(part.id, part.media_type || (part.title ? 'movie' : 'tv'));
  const inMovieList = !isSeries && Boolean(show) && !hasSeenMedia && show?.status !== 'dropped';
  const menuItem = 'w-full min-h-12 px-4 text-left text-[14px] font-semibold flex items-center gap-3 active:bg-white/5';

  return (
    <div ref={mainScrollRef} style={{ transform: isExiting ? 'translateX(100%)' : undefined }} className="flex-1 overflow-y-auto bg-[#09090b] text-white relative pb-nav w-full h-full transition-transform duration-300 ease-out">
      <div className="sticky top-0 z-40 h-0">
        <div className="seenit-sheet-header absolute inset-x-3.5 flex justify-between">
          <button type="button" onPointerUp={(e) => { e.preventDefault(); e.stopPropagation(); handleAnimatedBack(); }} onClick={(e) => { e.stopPropagation(); if (e.detail === 0) handleAnimatedBack(); }} aria-label="Retour" className="w-11 h-11 rounded-full bg-[rgba(9,9,11,0.7)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)] flex items-center justify-center text-white active:scale-95 touch-manipulation select-none"><ChevronLeft size={22} /></button>
          <div className="flex gap-2">
            {hasSeenMedia && <RoundHeaderButton label={show?.isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'} onClick={toggleFavorite}><Heart size={20} className={cn(show?.isFavorite ? 'fill-[#E5A93D] text-[#E5A93D]' : 'text-white')} /></RoundHeaderButton>}
            <RoundHeaderButton label="Actions de la fiche" expanded={showMenu} onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}><MoreVertical size={20} /></RoundHeaderButton>
          </div>
        </div>
      </div>
      {showMenu && <DialogLayer label="Actions de la fiche" onDismiss={() => setShowMenu(false)} className="fixed inset-0 z-50 bg-black/50 flex items-end justify-center" onClick={e => { if (e.target === e.currentTarget) setShowMenu(false); }}>
        <div className="w-full max-w-md rounded-t-[24px] bg-[#111113] shadow-[0_-10px_40px_rgba(0,0,0,0.5)] pb-[max(16px,env(safe-area-inset-bottom))] pt-2 flex flex-col animate-in slide-in-from-bottom duration-200">
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-zinc-700" aria-hidden="true" />
          <p className="px-4 pb-2 text-[15px] font-bold text-white truncate">{title}</p>
          {effectiveTmdbId && <button type="button" onClick={() => { setShowMenu(false); void handleShare(); }} className={cn(menuItem, 'text-zinc-100')}><Share2 size={18} className="text-zinc-400" />Partager la fiche</button>}
          {show && <button type="button" onClick={(e) => { e.stopPropagation(); setShowMenu(false); handleSyncSingle(); }} disabled={isSyncingSingle} className={cn(menuItem, 'text-[#F2C36B] disabled:opacity-50')}><RefreshCw size={18} className={cn(isSyncingSingle && 'animate-spin')} />Synchroniser {isSeries ? 'la série' : 'le film'}</button>}
          {/* Accès existant aux téléchargements, inchangé (SEENIT-DOWNLOAD-VISIBILITY-001) */}
          <button type="button" onClick={(e) => { e.stopPropagation(); setShowMenu(false); setDownloadTargetSeason(undefined); setDownloadTargetEpisode(undefined); setIsDownloadModalOpen(true); }} className={cn(menuItem, 'text-zinc-100')}><Download size={18} className="text-zinc-400" />Téléchargement</button>
          {show && <>
            {show.isArchived ? <button type="button" onClick={(e) => { e.stopPropagation(); setShowMenu(false); isSeries ? rewatchShow() : toggleMovieSeen(); }} className={cn(menuItem, 'text-zinc-100')}><RotateCcw size={18} className="text-[#F2C36B]" />{isSeries ? 'Revoir la série' : 'Revoir le film'}</button>
              : show.status === 'dropped' ? <button type="button" onClick={(e) => { e.stopPropagation(); setShowMenu(false); isSeries ? resumeShow() : togglePlanToWatchMovie(); }} className={cn(menuItem, 'text-zinc-100')}><RotateCcw size={18} className="text-[#F2C36B]" />{isSeries ? 'Reprendre la série' : 'Ajouter à ma liste'}</button>
              : <button type="button" onClick={(e) => { e.stopPropagation(); setShowMenu(false); isSeries ? dropShow() : togglePlanToWatchMovie(); }} className={cn(menuItem, 'text-zinc-100')}><Ban size={18} className="text-zinc-400" />{isSeries ? 'Abandonner la série' : 'Retirer de ma liste'}</button>}
            <button type="button" onClick={(e) => { e.stopPropagation(); setShowMenu(false); handleDeleteShow(); }} className={cn(menuItem, 'text-red-300')}><Trash2 size={18} />{isSeries ? 'Supprimer la série' : 'Supprimer le film'}</button>
          </>}
        </div>
      </DialogLayer>}

      <DetailHero imageUrl={backdropUrl || posterPath} title={title} meta={tmdbDetails || year ? meta : null} height={isSeries ? 300 : 380} />

      <div className="px-4 pt-1.5 pb-8 flex flex-col gap-3.5">
        {isSeries ? <SeriesProgressCard seenCount={seenCount} totalEpisodes={totalEpisodes} remainingMinutes={remainingTimeMinutes} seasons={seasons} show={show}>{seriesCta}{mainProvider && providerTile(mainProvider)}{plexProvider && providerTile(plexProvider)}</SeriesProgressCard>
          : <div className="flex gap-2">
            <GoldCta tone={hasSeenMedia ? 'done' : 'gold'} label={hasSeenMedia ? '✓ Vu · annuler' : isUnreleased ? 'Pas encore sorti' : 'Marquer vu'} onClick={hasSeenMedia || !isUnreleased ? toggleMovieSeen : () => showToast('Ce film n’est pas encore sorti.', 'info')} className="rounded-[16px]" />
            {!hasSeenMedia && <SquareAction label={inMovieList ? 'Retirer de ma liste' : 'Ajouter à ma liste'} active={inMovieList} onClick={togglePlanToWatchMovie}><Bookmark size={20} className={cn(inMovieList && 'fill-[#E5A93D]')} /></SquareAction>}
            {hasTrailer && <SquareAction label="Bande-annonce" onClick={() => setTrailerModalVideos(ytVideos)}><Play size={18} className="fill-current" /></SquareAction>}
          </div>}
        {!isSeries && !hasSeenMedia && !isUnreleased && !isAtCinema && <MovieEndCard runtime={tmdbDetails?.runtime} />}

        <div className="flex flex-wrap gap-1.5 min-h-7">
          {!tmdbDetails ? <><div className="h-7 w-20 rounded-lg bg-zinc-800/80 animate-pulse" /><div className="h-7 w-14 rounded-lg bg-zinc-800/80 animate-pulse" /></> : <>
            {isAtCinema && <DetailChip className="text-[#F2C36B] shadow-[inset_0_0_0_1px_rgba(229,169,61,0.5)]">🎟 Au cinéma</DetailChip>}
            {isUpcomingMovie && <DetailChip className="text-[#F2C36B]">À venir</DetailChip>}
            {tmdbRating && <DetailChip>★ {tmdbRating} TMDB</DetailChip>}
            <DetailChip className={ratingInfo.colorClass} aria-label={ratingInfo.provenance ? `${ratingInfo.label}, classification ${ratingInfo.provenance}` : ratingInfo.label} title={ratingInfo.provenance ? `${ratingInfo.provenance} · ${ratingInfo.label}` : ratingInfo.label}><strong>{ratingInfo.label}</strong>{ratingInfo.provenance && <small className="text-[9px] font-semibold opacity-65">{ratingInfo.provenance}</small>}</DetailChip>
            {isSeries && hasTrailer && <button type="button" onClick={() => setTrailerModalVideos(ytVideos)} className="inline-flex h-7 min-h-7 items-center gap-1 rounded-lg bg-[#18181b] px-2.5 text-[12px] font-bold text-zinc-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]"><Play size={12} className="fill-current" />Bande-annonce</button>}
          </>}
        </div>
        {tmdbDetails ? <DetailSynopsis text={tmdbDetails.overview || 'Aucun synopsis disponible.'} expanded={isSynopsisExpanded} onToggle={() => setIsSynopsisExpanded(!isSynopsisExpanded)} /> : <div className="space-y-2 animate-pulse" aria-hidden="true"><div className="h-3.5 w-full rounded bg-zinc-800/80" /><div className="h-3.5 w-4/5 rounded bg-zinc-800/80" /></div>}

        {isSeries && <>
          <SeasonAverageChart averages={averages} />
          <SeasonPills seasons={seasons} show={show} selected={expandedSeason} onSelect={season => { if (season !== expandedSeason) void loadSeason(season); }} />
          {selectedSeason && <SeasonPanel season={selectedSeason} episodes={selectedEpisodes} show={show} nextKey={nextKey} runtimeFallback={runtimeFallback} onToggleSeason={event => toggleSeasonSeen(event, selectedSeason.season_number, selectedSeason.episode_count || 0)} onToggleEpisode={(event, episode) => toggleEpisodeSeen(event, selectedSeason.season_number, episode)} onOpenEpisode={episode => openEpisodeModal(selectedSeason.season_number, episode)} onSeasonTrailer={seasonVideos.length ? () => setTrailerModalVideos(seasonVideos) : undefined} />}
        </>}

        <WhereToWatchCard providers={sortedProviders} loading={plexMediaInfo === null || providers === null} userPlatforms={userPlatforms} title={title} fallbackLink={providers?.link} onOpenPlex={openPlex} onRefreshPlex={() => void refreshPlexAvailability()} refreshing={isRefreshingPlex} canRefresh={Boolean(effectiveTmdbId)} emptyLabel={isUnreleased ? 'Bientôt disponible' : 'Pas encore disponible en streaming en France.'} />

        {isSeries && <CastRows cast={cast} isSeries totalEpisodes={totalEpisodes || Number(tmdbDetails?.number_of_episodes) || 0} loading={!tmdbDetails || !castPayloadKnown} onOpenPerson={openPersonModal} />}
        {collectionData?.parts?.length > 0 && <RelationList title={tmdbDetails?.belongs_to_collection?.name || 'Ordre de visionnage'} subtitle="Ordre de visionnage" parts={collectionData.parts} currentKey={requestedMediaKey} shows={libraryShows} timeline onOpen={relationOpen} />}
        {universeData?.parts?.length > 0 && <RelationList title={universeData.parts[0]?.seenitRelationKind === 'franchise' ? 'Dans la même franchise' : 'Dans le même univers'} parts={universeData.parts} currentKey={requestedMediaKey} shows={libraryShows} timeline={false} onOpen={relationOpen} />}
        {collectionLoading && <RelationsLoading />}
        {!isSeries && <VerifiedSimilarRail movie={tmdbDetails} excludedIds={collectionIds} onOpen={movieId => onShowClick && onShowClick(movieId, 'movie')} />}
        {!isSeries && <CastRows cast={cast} isSeries={false} totalEpisodes={0} loading={!tmdbDetails || !castPayloadKnown} onOpenPerson={openPersonModal} />}
        <ThemesCard genres={genres} keywords={keywords} expanded={areThemesExpanded} onToggle={() => setAreThemesExpanded((expanded: boolean) => !expanded)} loading={!tmdbDetails} />
        <RedditSection query={isSeries ? `${redditVisibleTitle} series discussion` : redditMovieQuery} resolveQuery={isSeries ? undefined : resolveRedditMovieQuery} isLocked={false} title="Discussions Reddit" description="Retrouvez les avis, théories et spoilers de la communauté." />
      </div>

      {selectedEpisode && <EpisodeDetailModal show={show} season={selectedEpisode.season} episode={selectedEpisode.episode} tmdbShowTitle={tmdbDetails?.name || tmdbDetails?.title} tmdbShowId={effectiveTmdbId}
        onShowClick={(tmdbId) => { setSelectedEpisode(null); if (window.history.state?.isEpisodeDetailModal || window.history.state?.isModal) window.history.back(); const isSameShow = (effectiveTmdbId && Number(effectiveTmdbId) === Number(tmdbId)) || (show?.tmdbId && Number(show.tmdbId) === Number(tmdbId)) || (show?.id && String(show.id) === String(tmdbId)); if (!isSameShow && onShowClick) setTimeout(() => onShowClick(tmdbId, show?.mediaType || 'tv'), 50); }}
        onClose={() => { setSelectedEpisode(null); if (window.history.state?.isEpisodeDetailModal || window.history.state?.isModal) window.history.back(); }}
        onLoadSeason={async (seasonNum) => { if (!effectiveTmdbId) return null; if (seasonsCache[seasonNum]) return seasonsCache[seasonNum]?.episodes || seasonsCache[seasonNum]; const res = await tmdb.getSeasonDetails(effectiveTmdbId, seasonNum); if (res.ok && res.value) { setSeasonsCache((prev: Record<number, unknown>) => ({ ...prev, [seasonNum]: res.value })); return res.value.episodes || res.value; } return null; }} />}
      {selectedPersonId && <PersonDetailModal personId={selectedPersonId}
        onClose={() => { setSelectedPersonId(null); if (window.history.state?.isPersonDetailModal || window.history.state?.isModal) window.history.back(); }}
        onShowClick={(tmdbId, type) => { setSelectedPersonId(null); if (window.history.state?.isPersonDetailModal || window.history.state?.isModal) window.history.back(); const isSameShow = (effectiveTmdbId && Number(effectiveTmdbId) === Number(tmdbId)) || (show?.tmdbId && Number(show.tmdbId) === Number(tmdbId)) || (show?.id && String(show.id) === String(tmdbId)); if (!isSameShow && onShowClick) setTimeout(() => onShowClick(tmdbId, type || 'movie'), 50); }} />}
      {trailerModalVideos && <TrailerModal videos={trailerModalVideos} onClose={() => setTrailerModalVideos(null)} />}
      {isDownloadModalOpen && <DownloadModal isOpen={isDownloadModalOpen} onClose={() => { setIsDownloadModalOpen(false); setDownloadTargetSeason(undefined); setDownloadTargetEpisode(undefined); }} title={title} originalTitle={tmdbDetails?.original_title || tmdbDetails?.original_name || show?.originalTitle} year={(tmdbDetails?.release_date || tmdbDetails?.first_air_date || show?.firstAirDate)?.slice(0, 4)} mediaType={isSeries ? 'tv' : 'movie'} tmdbId={effectiveTmdbId} tvdbId={tmdbDetails?.external_ids?.tvdb_id || show?.tvdbId} imdbId={tmdbDetails?.external_ids?.imdb_id || show?.imdbId} posterPath={posterPath || tmdbDetails?.poster_path || show?.posterPath} initialSeason={downloadTargetSeason} initialEpisode={downloadTargetEpisode} totalSeasons={tmdbDetails?.number_of_seasons || seasons.length || 1} seasonsData={tmdbDetails?.seasons} onSuccessToast={(msg) => showToast(msg, 'success', show || undefined)} />}
    </div>
  );
}
