import { DialogLayer } from '../components/ui/DialogLayer';
import React, { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { tmdb, isMovieAtCinema, isMovieUpcoming } from '../features/shows/tmdb';
import { ChevronLeft, Heart, MoreVertical, Play, RefreshCw, RotateCcw, Ban, Trash2, Download, Share2 } from 'lucide-react';
import { cn, getTodayStr, openExternalUrl } from '../lib/utils';
import { EpisodeDetailModal } from './EpisodeDetailModal';
import { PersonProfile as PersonDetailModal } from '../components/PersonProfile';
import { TrailerModal } from '../components/TrailerModal';
import { useShowsStore } from '../store/showsStore';
import { useToastStore } from '../store/toastStore';
import { useDownloadConfigStore } from '../store/downloadConfigStore';
import { isDownloadFeatureEnabled } from '../features/downloads/downloadFeatureVisibility';
import { getFormattedProviderLogo, PLEX_LOGO_SVG } from '../utils/providerLogos';
import { openPlexWatchUrl } from '../features/plex/syncPlex';
import { RedditSection } from '../components/community/RedditSection';
import { buildRedditMovieSearchQuery } from '../components/community/redditEpisodeSearch';
import { getProviderLinkPresentation } from '../features/providers/providerLink';
import { seasonAverages, formatRating } from '../features/shows/detailPlanning';
import { frenchGenres } from '../features/shows/frenchLabels';
import { DetailChip, DetailHero, DetailSynopsis, GoldCta, RoundHeaderButton, WhereToWatchCard, type WhereToWatchProvider } from './mediaDetail/detailUi';
import { CastRows, RelationList, RelationsLoading, ThemesCard } from './mediaDetail/detailSections';
import { SeasonAverageChart, SeasonPanel, SeasonPills, SeriesProgressCard, seasonsOf } from './mediaDetail/seriesSections';
import { MovieEndCard, VerifiedSimilarRail } from './mediaDetail/movieSections';
import type { ShowDetailViewModel } from './mediaDetail/showDetailViewModel';
import { DownloadModeBanner, DownloadModeBar, DownloadModeToggle, isEpisodeSelectable, seasonModeStates } from './mediaDetail/downloadMode';
import { SeenItRing } from '../components/SeenItLogo';
import { episodeDownloadPresentation } from '../features/downloads/episodeDownloadPresentation';
import type { DownloadQualityChoice } from '../features/downloads/downloadLaunch';
import { episodePresenceKey } from '../features/downloads/episodePresenceKey';

interface ShowDetailViewProps {
  model: ShowDetailViewModel;
}

const DownloadModal = lazy(() => import('../components/DownloadModal').then(module => ({ default: module.DownloadModal })));

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
  const downloadsEnabled = useDownloadConfigStore(isDownloadFeatureEnabled);
  const movieAvailable = !isSeries && Boolean(model.presence.radarrHasFile || model.presence.plexInfo?.available);
  const openEpisodeDownload = (season: number, episode?: number) => {
    if (!downloadsEnabled) return;
    setDownloadTargetSeason(season);
    setDownloadTargetEpisode(episode);
    setIsDownloadModalOpen(true);
  };
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
  const genres: Array<{ id: number; name: string }> = frenchGenres(tmdbDetails?.genres); // « Reality » → « Téléréalité »
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
    // Le bouton or ouvre le prochain épisode à voir (retour terrain du 03/11) ; le marquage se fait dans sa fiche.
    const code = `S${String(nextEp.season_number).padStart(2, '0')} | E${String(nextEp.episode_number).padStart(2, '0')}`;
    return <GoldCta label={`Voir ${code}`} sub={[nextEp.name, `${nextEp.runtime || runtimeFallback} min`].filter(Boolean).join(' · ')} ariaLabel={`Ouvrir l’épisode ${code}${nextEp.name ? ` : ${nextEp.name}` : ''}`} onClick={handleWatchNextEpisode} />;
  })();

  // #859 : un seul bouton à états pour le film, avec les tuiles diffuseur et Plex comme la série. Suivre,
  // puis Marquer vu (ou « Pas encore sorti »), puis le logo Vu de SeenIt (anneau or + coche, retour terrain
  // du 07/11 : plus de « ✓ Vu · annuler »). Toucher annule toujours le Vu. Ne plus suivre reste dans le menu ⋮.
  const movieFollowed = !isSeries && Boolean(show) && show?.status !== 'dropped';
  const movieCta = (() => {
    if (hasSeenMedia) return <GoldCta tone="done" label={<span data-movie-seen className="inline-flex items-center gap-2"><SeenItRing size={30} />Vu</span>} ariaLabel="Vu, toucher pour annuler" onClick={toggleMovieSeen} />;
    if (!movieFollowed) return <GoldCta label="Suivre le film" onClick={togglePlanToWatchMovie} />;
    if (isUnreleased) return <GoldCta tone="neutral" label="Pas encore sorti" sub="Film suivi" onClick={() => showToast('Ce film n’est pas encore sorti.', 'info')} />;
    return <GoldCta label="Marquer vu" sub="Film suivi" onClick={toggleMovieSeen} />;
  })();

  const selectedSeason = seasons.find(season => season.season_number === expandedSeason) || null;
  const selectedEpisodes = selectedSeason ? seasonsCache[selectedSeason.season_number]?.episodes || null : null;
  // #879 — Mode téléchargement : la fiche reste propre, la sélection d'épisodes est une surcouche.
  const [downloadMode, setDownloadMode] = useState(false);
  const [pickedEpisodes, setPickedEpisodes] = useState<Set<number>>(() => new Set());
  const canUseDownloadMode = isSeries && downloadsEnabled && Boolean(effectiveTmdbId);
  const modeToday = getTodayStr();
  const modeSeason = selectedSeason?.season_number ?? null;
  const episodePresentation = (episode: number, aired: boolean) => episodeDownloadPresentation(episode, aired, Boolean(modeSeason !== null && model.presence.episodesHasFile?.[episodePresenceKey(modeSeason, episode)]), modeSeason !== null ? model.getEpisodeDownload(effectiveTmdbId || undefined, tmdbDetails?.external_ids?.tvdb_id || show?.tvdbId, modeSeason, episode) : null);
  // Pas de mémorisation : la file en direct (lue par une fonction stable du store) doit être relue à chaque rendu.
  const modeStates = modeSeason === null ? [] : seasonModeStates(selectedEpisodes, episode => Boolean(show?.seenEpisodes?.includes(`${modeSeason}x${episode}`)), episodePresentation, modeToday);
  const selectableEpisodes = modeStates.filter(entry => isEpisodeSelectable(entry.state)).map(entry => entry.episode);
  const activeDownloads = modeStates.filter(entry => entry.state === 'active').length;
  // Retour terrain du 07/11 : entrer dans le mode amène l'épisode où on en est au centre de l'écran, et
  // toucher un segment du bandeau amène sa ligne. La demande reste en attente tant que la ligne n'est pas
  // rendue (saison encore en chargement) et se rejoue à l'arrivée des épisodes ; quitter le mode l'annule.
  const [episodeScroll, setEpisodeScroll] = useState<{ episode: number; id: number } | null>(null);
  const requestEpisodeScroll = (episode: number) => setEpisodeScroll(previous => ({ episode, id: (previous?.id || 0) + 1 }));
  useEffect(() => {
    if (!episodeScroll) return;
    const frame = requestAnimationFrame(() => {
      const row = mainScrollRef.current?.querySelector<HTMLElement>(`[data-episode-row="${episodeScroll.episode}"]`);
      if (!row) return;
      const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      row.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
      setEpisodeScroll(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [episodeScroll, mainScrollRef, selectedEpisodes]);
  const enterDownloadMode = () => {
    if (!canUseDownloadMode) return;
    const nextInSeason = nextEp && nextEp.season_number === modeSeason ? nextEp.episode_number : null;
    const next = nextInSeason !== null && selectableEpisodes.includes(nextInSeason) ? [nextInSeason] : [];
    setPickedEpisodes(new Set(next));
    setDownloadMode(true);
    const target = nextInSeason ?? selectableEpisodes[0] ?? modeStates.find(entry => entry.state !== 'seen')?.episode;
    if (target !== undefined) requestEpisodeScroll(target);
  };
  const exitDownloadMode = () => { setDownloadMode(false); setPickedEpisodes(new Set()); setEpisodeScroll(null); };
  const toggleDownloadMode = () => (downloadMode ? exitDownloadMode() : enterDownloadMode());
  const togglePickedEpisode = (episode: number) => setPickedEpisodes(previous => { const next = new Set(previous); if (next.has(episode)) next.delete(episode); else next.add(episode); return next; });
  const allPicked = selectableEpisodes.length > 0 && selectableEpisodes.every(episode => pickedEpisodes.has(episode));
  const pickSegment = (episode: number) => { if (selectableEpisodes.includes(episode)) togglePickedEpisode(episode); requestEpisodeScroll(episode); };
  // Changer de saison vide la sélection (la barre d'action ne vise qu'une saison).
  useEffect(() => { setPickedEpisodes(new Set()); }, [modeSeason]);
  // Changer d'onglet ferme le mode comme toute superposition.
  useEffect(() => {
    const close = () => { setDownloadMode(false); setPickedEpisodes(new Set()); };
    window.addEventListener('app-close-modals', close);
    return () => window.removeEventListener('app-close-modals', close);
  }, []);
  const episodeCode = (season: number, episode: number) => `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
  const pickedList = [...pickedEpisodes].sort((a, b) => a - b);
  const pickedTitle = !pickedList.length ? 'Coche des épisodes' : pickedList.length === 1 && modeSeason !== null
    ? `${episodeCode(modeSeason, pickedList[0])} · ${selectedEpisodes?.find((entry: { episode_number: number; name?: string }) => entry.episode_number === pickedList[0])?.name || `Épisode ${pickedList[0]}`}`
    : `${pickedList.length} épisodes`;
  const pickedDetail = 'Touche une barre ou un épisode.';
  /** Lance les épisodes cochés avec les mêmes gardes que la popup : rien n'est remplacé ni relancé en double. */
  const launchPickedEpisodes = async (quality: DownloadQualityChoice) => {
    if (modeSeason === null || !pickedList.length || !effectiveTmdbId) return;
    const config = useDownloadConfigStore.getState();
    if (!isDownloadFeatureEnabled(config)) return;
    // Chargé au premier lancement : les services Sonarr restent hors du chunk de la fiche.
    const { launchArrEpisodeBatch } = await import('../features/downloads/downloadLaunch');
    if (model.presence.loading) { showToast('Vérification de la disponibilité en cours.', 'info'); return; }
    if (!(config.sonarrUrl && config.sonarrApiKey)) { useToastStore.getState().showToast({ title, action: 'Sonarr n’est pas configuré pour ce média.', posterPath: show?.posterPath }, 'error'); return; }
    const episodes = pickedList;
    const season = modeSeason;
    exitDownloadMode();
    const qualityLabel = quality === '4k' ? '4K' : '1080p';
    const single = episodes.length === 1;
    if (!single) useToastStore.getState().showToast({ title, action: `${episodes.length} épisodes · recherche ${qualityLabel} en cours…`, posterPath: show?.posterPath }, 'download');
    // Le lot relit compte, gate et serveur Sonarr avant chaque épisode et s'arrête si l'un d'eux change.
    await launchArrEpisodeBatch({
      title, year, tmdbId: effectiveTmdbId,
      tvdbId: tmdbDetails?.external_ids?.tvdb_id || show?.tvdbId, imdbId: tmdbDetails?.external_ids?.imdb_id || show?.imdbId,
      posterPath: show?.posterPath || undefined, season, episodes, qualityPreference: quality,
      readConfig: () => useDownloadConfigStore.getState(),
      // Mêmes gardes que la popup : un fichier présent n'est jamais remplacé, pas de double lancement.
      skip: episode => Boolean(model.presence.episodesHasFile?.[episodePresenceKey(season, episode)]) || Boolean(model.hasActiveDownloadInScope?.({ mediaType: 'tv', tmdbId: Number(effectiveTmdbId), seasonNumber: season, episodeNumber: episode })),
      // Un épisode : tous les messages ; plusieurs : seulement les erreurs (le bilan reste dans Téléchargements).
      notify: (episode, action, toastType = 'download') => { if (single || toastType === 'error') useToastStore.getState().showToast({ title, subtitle: `S${season} | E${episode}`, action, posterPath: show?.posterPath }, toastType); }
    });
  };
  const openPreciseVersion = () => {
    if (modeSeason === null || !pickedList.length) return;
    const first = pickedList[0];
    exitDownloadMode();
    openEpisodeDownload(modeSeason, first);
  };
  const seasonVideos = selectedSeason ? (seasonsCache[selectedSeason.season_number]?.videos?.results || []).filter((video: { site?: string }) => video.site === 'YouTube') : [];
  const castPayloadKnown = isSeries ? Boolean(tmdbDetails?.aggregate_credits || tmdbDetails?.credits) : Boolean(tmdbDetails?.credits);
  const cast = (tmdbDetails?.aggregate_credits?.cast || tmdbDetails?.credits?.cast || []);
  const collectionIds = useMemo(() => new Set<number>((collectionData?.parts || []).map((part: { id: number }) => Number(part.id))), [collectionData]);
  const relationOpen = (part: { id: number; media_type?: string; title?: string }) => onShowClick && onShowClick(part.id, part.media_type === 'tv' || part.media_type === 'movie' ? part.media_type : part.title ? 'movie' : 'tv');
  const menuItem = 'w-full min-h-[52px] px-3.5 py-2 text-left text-[15.5px] font-bold flex items-center gap-3 active:bg-white/5';
  const menuSub = (text: string) => <span className="block mt-px text-[12.5px] font-medium text-zinc-400">{text}</span>;

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
      {/* #879 : menu ancré sous le bouton ⋮ (plus de feuille qui monte du bas), fermé par un toucher à côté. */}
      {showMenu && <DialogLayer label="Actions de la fiche" onDismiss={() => setShowMenu(false)} className="fixed inset-0 z-50 bg-black/40" onClick={e => { if (e.target === e.currentTarget) setShowMenu(false); }}>
        <div role="menu" aria-label={`Actions pour ${title}`} data-anchored-menu style={{ right: 'max(12px, calc((100vw - 28rem) / 2 + 12px))' }} className="absolute top-[calc(var(--seenit-safe-area-top,env(safe-area-inset-top,0px))+58px)] w-[290px] max-w-[calc(100%-24px)] rounded-[20px] bg-[#1C1C1F] py-1.5 flex flex-col shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12),0_18px_48px_rgba(0,0,0,0.8)] origin-top-right animate-in fade-in zoom-in-95 duration-150 motion-reduce:animate-none">
          {effectiveTmdbId && <button type="button" role="menuitem" onClick={() => { setShowMenu(false); void handleShare(); }} className={cn(menuItem, 'text-zinc-100')}><Share2 size={19} className="shrink-0 text-zinc-400" />Partager la fiche</button>}
          {show && <button type="button" role="menuitem" onClick={(e) => { e.stopPropagation(); setShowMenu(false); handleSyncSingle(); }} disabled={isSyncingSingle} className={cn(menuItem, 'text-zinc-100 disabled:opacity-50')}><RefreshCw size={19} className={cn('shrink-0 text-zinc-400', isSyncingSingle && 'animate-spin')} /><span className="min-w-0">Synchroniser {isSeries ? 'la série' : 'le film'}{menuSub(isSeries ? 'Épisodes et dates' : 'Dates et disponibilités')}</span></button>}
          {/* Accès existant aux téléchargements, inchangé (SEENIT-DOWNLOAD-VISIBILITY-001) */}
          {(!movieAvailable && (isSeries || !model.presence.loading)) ? <button type="button" role="menuitem" onClick={(e) => { e.stopPropagation(); setShowMenu(false); if (canUseDownloadMode) { enterDownloadMode(); return; } setDownloadTargetSeason(undefined); setDownloadTargetEpisode(undefined); setIsDownloadModalOpen(true); }} className={cn(menuItem, 'text-zinc-100')}><Download size={20} className="shrink-0 text-[#E5A93D]" /><span className="min-w-0">Téléchargement{canUseDownloadMode && menuSub(`Mode téléchargement${activeDownloads ? ` · ${activeDownloads} en cours` : ''}`)}</span></button> : <button type="button" role="menuitem" disabled={model.presence.loading} onClick={() => { setShowMenu(false); setIsDownloadModalOpen(true); }} className={cn(menuItem, 'text-zinc-100')}><Download size={20} className="shrink-0 text-[#E5A93D]" />{model.presence.loading ? 'Vérification de la disponibilité…' : 'Disponible · autre version'}</button>}
          {show && <>
            <span aria-hidden="true" className="mx-3.5 my-1 h-px bg-white/[0.07]" />
            {show.isArchived ? <button type="button" role="menuitem" onClick={(e) => { e.stopPropagation(); setShowMenu(false); isSeries ? rewatchShow() : toggleMovieSeen(); }} className={cn(menuItem, 'text-zinc-100')}><RotateCcw size={18} className="text-[#F2C36B]" />{isSeries ? 'Revoir la série' : 'Revoir le film'}</button>
              : show.status === 'dropped' ? <button type="button" role="menuitem" onClick={(e) => { e.stopPropagation(); setShowMenu(false); isSeries ? resumeShow() : togglePlanToWatchMovie(); }} className={cn(menuItem, 'text-zinc-100')}><RotateCcw size={18} className="text-[#F2C36B]" />{isSeries ? 'Reprendre la série' : 'Ajouter à ma liste'}</button>
              : <button type="button" role="menuitem" onClick={(e) => { e.stopPropagation(); setShowMenu(false); isSeries ? dropShow() : togglePlanToWatchMovie(); }} className={cn(menuItem, 'text-zinc-100')}><Ban size={18} className="text-zinc-400" />{isSeries ? 'Abandonner la série' : 'Retirer de ma liste'}</button>}
            <button type="button" role="menuitem" onClick={(e) => { e.stopPropagation(); setShowMenu(false); handleDeleteShow(); }} className={cn(menuItem, 'text-red-300')}><Trash2 size={18} />{isSeries ? 'Supprimer la série' : 'Supprimer le film'}</button>
          </>}
        </div>
      </DialogLayer>}

      <DetailHero imageUrl={backdropUrl || posterPath} title={title} meta={tmdbDetails || year ? meta : null} height={isSeries ? 300 : 380} />

      <div className="px-4 pt-1.5 pb-8 flex flex-col gap-3.5">
        {/* #857 : note, âge et bande-annonce en tête, au-dessus du bouton principal (film comme série). */}
        <div className="flex flex-wrap gap-1.5 min-h-7">
          {!tmdbDetails ? <><div className="h-7 w-20 rounded-lg bg-zinc-800/80 animate-pulse" /><div className="h-7 w-14 rounded-lg bg-zinc-800/80 animate-pulse" /></> : <>
            {isAtCinema && <DetailChip className="text-[#F2C36B] shadow-[inset_0_0_0_1px_rgba(229,169,61,0.5)]">🎟 Au cinéma</DetailChip>}
            {isUpcomingMovie && <DetailChip className="text-[#F2C36B]">À venir</DetailChip>}
            {tmdbRating && <DetailChip>★ {tmdbRating} TMDB</DetailChip>}
            <DetailChip className={ratingInfo.colorClass} aria-label={ratingInfo.provenance ? `${ratingInfo.label}, classification ${ratingInfo.provenance}` : ratingInfo.label} title={ratingInfo.provenance ? `${ratingInfo.provenance} · ${ratingInfo.label}` : ratingInfo.label}><strong>{ratingInfo.label}</strong>{ratingInfo.provenance && <small className="text-[9px] font-semibold opacity-65">{ratingInfo.provenance}</small>}</DetailChip>
            {hasTrailer && <button type="button" onClick={() => setTrailerModalVideos(ytVideos)} className="inline-flex h-7 min-h-7 items-center gap-1 rounded-lg bg-[#18181b] px-2.5 text-[12px] font-bold text-zinc-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]"><Play size={12} className="fill-current" />Bande-annonce</button>}
          </>}
        </div>
        {isSeries ? <SeriesProgressCard seenCount={seenCount} totalEpisodes={totalEpisodes} remainingMinutes={remainingTimeMinutes} seasons={seasons} show={show}>{seriesCta}{mainProvider && providerTile(mainProvider)}{plexProvider && providerTile(plexProvider)}{canUseDownloadMode && show && <DownloadModeToggle active={downloadMode} badge={activeDownloads} onToggle={toggleDownloadMode} />}</SeriesProgressCard>
          : <div className="flex gap-2">{movieCta}{mainProvider && providerTile(mainProvider)}{plexProvider && providerTile(plexProvider)}</div>}
        {!isSeries && !hasSeenMedia && !isUnreleased && !isAtCinema && <MovieEndCard runtime={tmdbDetails?.runtime} />}

        {tmdbDetails ? <DetailSynopsis text={tmdbDetails.overview || 'Aucun synopsis disponible.'} expanded={isSynopsisExpanded} onToggle={() => setIsSynopsisExpanded(!isSynopsisExpanded)} /> : <div className="space-y-2 animate-pulse" aria-hidden="true"><div className="h-3.5 w-full rounded bg-zinc-800/80" /><div className="h-3.5 w-4/5 rounded bg-zinc-800/80" /></div>}
        <ThemesCard genres={genres} keywords={keywords} expanded={areThemesExpanded} onToggle={() => setAreThemesExpanded((expanded: boolean) => !expanded)} loading={!tmdbDetails} />

        {isSeries && <>
          <SeasonAverageChart averages={averages} />
          <SeasonPills seasons={seasons} show={show} selected={expandedSeason} onSelect={season => { if (season !== expandedSeason) void loadSeason(season); }}
            downloading={canUseDownloadMode ? season => Boolean(model.hasActiveDownloadInScope?.({ mediaType: 'tv', tmdbId: Number(effectiveTmdbId), seasonNumber: season })) : undefined} />
          {downloadMode && selectedSeason && <DownloadModeBanner season={selectedSeason.season_number} states={modeStates} progress={episode => model.getEpisodeDownload(effectiveTmdbId || undefined, tmdbDetails?.external_ids?.tvdb_id || show?.tvdbId, selectedSeason.season_number, episode)?.progress} picked={pickedEpisodes} allPicked={allPicked} canPick={selectableEpisodes.length > 0} onToggleAll={() => setPickedEpisodes(allPicked ? new Set() : new Set(selectableEpisodes))} onSegment={pickSegment} />}
          {selectedSeason && <SeasonPanel season={selectedSeason} episodes={selectedEpisodes} show={show} nextKey={nextKey} runtimeFallback={runtimeFallback} onToggleSeason={event => toggleSeasonSeen(event, selectedSeason.season_number, selectedSeason.episode_count || 0)} onToggleEpisode={(event, episode) => toggleEpisodeSeen(event, selectedSeason.season_number, episode)} onOpenEpisode={episode => openEpisodeModal(selectedSeason.season_number, episode)} onSeasonTrailer={seasonVideos.length ? () => setTrailerModalVideos(seasonVideos) : undefined}
            downloadMode={canUseDownloadMode ? { active: downloadMode, picked: pickedEpisodes, onToggle: togglePickedEpisode } : null}
            episodesHasFile={model.presence.episodesHasFile}
            getEpisodeDownload={episode => model.getEpisodeDownload(effectiveTmdbId || undefined, tmdbDetails?.external_ids?.tvdb_id || show?.tvdbId, selectedSeason.season_number, episode)} />}
        </>}

        <WhereToWatchCard providers={sortedProviders} loading={plexMediaInfo === null || providers === null} userPlatforms={userPlatforms} title={title} fallbackLink={providers?.link} onOpenPlex={openPlex} onRefreshPlex={() => void refreshPlexAvailability()} refreshing={isRefreshingPlex} canRefresh={Boolean(effectiveTmdbId)} emptyLabel={isUnreleased ? 'Bientôt disponible' : 'Pas encore disponible en streaming en France.'} />

        {isSeries && <CastRows cast={cast} isSeries totalEpisodes={totalEpisodes || Number(tmdbDetails?.number_of_episodes) || 0} loading={!tmdbDetails || !castPayloadKnown} onOpenPerson={openPersonModal} />}
        {collectionData?.parts?.length > 0 && <RelationList title={tmdbDetails?.belongs_to_collection?.name || 'Ordre de visionnage'} subtitle="Ordre de visionnage" parts={collectionData.parts} currentKey={requestedMediaKey} shows={libraryShows} timeline onOpen={relationOpen} />}
        {universeData?.parts?.length > 0 && <RelationList title={universeData.parts[0]?.seenitRelationKind === 'franchise' ? 'Dans la même franchise' : 'Dans le même univers'} parts={universeData.parts} currentKey={requestedMediaKey} shows={libraryShows} timeline={false} onOpen={relationOpen} />}
        {collectionLoading && <RelationsLoading />}
        {!isSeries && <VerifiedSimilarRail movie={tmdbDetails} excludedIds={collectionIds} onOpen={movieId => onShowClick && onShowClick(movieId, 'movie')} />}
        {!isSeries && <CastRows cast={cast} isSeries={false} totalEpisodes={0} loading={!tmdbDetails || !castPayloadKnown} onOpenPerson={openPersonModal} />}
        <RedditSection query={isSeries ? `${redditVisibleTitle} series discussion` : redditMovieQuery} resolveQuery={isSeries ? undefined : resolveRedditMovieQuery} isLocked={false} title="Discussions Reddit" description="Retrouvez les avis, théories et spoilers de la communauté." />
        {downloadMode && <div aria-hidden="true" className="h-24" />}
      </div>

      {selectedEpisode && <EpisodeDetailModal show={show} season={selectedEpisode.season} episode={selectedEpisode.episode} tmdbShowTitle={tmdbDetails?.name || tmdbDetails?.title} tmdbShowId={effectiveTmdbId}
        onShowClick={(tmdbId) => { setSelectedEpisode(null); if (window.history.state?.isEpisodeDetailModal || window.history.state?.isModal) window.history.back(); const isSameShow = (effectiveTmdbId && Number(effectiveTmdbId) === Number(tmdbId)) || (show?.tmdbId && Number(show.tmdbId) === Number(tmdbId)) || (show?.id && String(show.id) === String(tmdbId)); if (!isSameShow && onShowClick) setTimeout(() => onShowClick(tmdbId, show?.mediaType || 'tv'), 50); }}
        onClose={() => { setSelectedEpisode(null); if (window.history.state?.isEpisodeDetailModal || window.history.state?.isModal) window.history.back(); }}
        onLoadSeason={async (seasonNum) => { if (!effectiveTmdbId) return null; if (seasonsCache[seasonNum]) return seasonsCache[seasonNum]?.episodes || seasonsCache[seasonNum]; const res = await tmdb.getSeasonDetails(effectiveTmdbId, seasonNum); if (res.ok && res.value) { setSeasonsCache((prev: Record<number, unknown>) => ({ ...prev, [seasonNum]: res.value })); return res.value.episodes || res.value; } return null; }} />}
      {selectedPersonId && <PersonDetailModal personId={selectedPersonId} hint={(() => { const member = cast.find((entry: { id: number }) => entry.id === selectedPersonId); return member ? { name: member.name, profile_path: member.profile_path, character: member.roles?.[0]?.character || member.character } : undefined; })()} origin={show || (effectiveTmdbId ? { id: '', userId: '', tmdbId: Number(effectiveTmdbId), title, mediaType: isSeries ? 'tv' : 'movie', posterPath: posterPath || null, backdropPath: backdropUrl || null, status: 'plan_to_watch', seenEpisodes: [], episodeRecords: {}, isArchived: false, createdAt: 0, updatedAt: 0 } as unknown as typeof show : null)}
        onClose={() => { setSelectedPersonId(null); if (window.history.state?.isPersonDetailModal || window.history.state?.isModal) window.history.back(); }}
        onShowClick={(tmdbId, type) => { setSelectedPersonId(null); if (window.history.state?.isPersonDetailModal || window.history.state?.isModal) window.history.back(); const isSameShow = (effectiveTmdbId && Number(effectiveTmdbId) === Number(tmdbId)) || (show?.tmdbId && Number(show.tmdbId) === Number(tmdbId)) || (show?.id && String(show.id) === String(tmdbId)); if (!isSameShow && onShowClick) setTimeout(() => onShowClick(tmdbId, type || 'movie'), 50); }} />}
      {downloadMode && canUseDownloadMode && <DownloadModeBar title={pickedTitle} detail={pickedDetail} enabled={pickedList.length > 0} onLaunch={quality => { void launchPickedEpisodes(quality); }} onPrecise={openPreciseVersion} onExit={exitDownloadMode} />}
      {trailerModalVideos && <TrailerModal videos={trailerModalVideos} onClose={() => setTrailerModalVideos(null)} />}
      {isDownloadModalOpen && <Suspense fallback={<span role="status">Ouverture du téléchargement…</span>}><DownloadModal isOpen={isDownloadModalOpen} onClose={() => { setIsDownloadModalOpen(false); setDownloadTargetSeason(undefined); setDownloadTargetEpisode(undefined); }} title={title} originalTitle={tmdbDetails?.original_title || tmdbDetails?.original_name || show?.originalTitle} year={(tmdbDetails?.release_date || tmdbDetails?.first_air_date || show?.firstAirDate)?.slice(0, 4)} mediaType={isSeries ? 'tv' : 'movie'} tmdbId={effectiveTmdbId} tvdbId={tmdbDetails?.external_ids?.tvdb_id || show?.tvdbId} imdbId={tmdbDetails?.external_ids?.imdb_id || show?.imdbId} posterPath={posterPath || tmdbDetails?.poster_path || show?.posterPath} initialSeason={downloadTargetSeason} initialEpisode={downloadTargetEpisode} totalSeasons={tmdbDetails?.number_of_seasons || seasons.length || 1} seasonsData={tmdbDetails?.seasons} onSuccessToast={(msg) => showToast(msg, 'success', show || undefined)} /></Suspense>}
    </div>
  );
}
