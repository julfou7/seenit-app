import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import type { Show } from '../../types';
import { tmdb, isMovieAtCinema } from '../../features/shows/tmdb';
import { usePassiveWatchProvider } from '../../hooks/usePassiveWatchProvider';
import { createWatchProviderRequestLimiter } from '../../features/providers/watchProviderRequestPolicy';
import { createPassiveCardEnrichmentGate } from '../../features/providers/passiveCardEnrichmentPolicy';
import { getFormattedProviderLogo } from '../../utils/providerLogos';
import { seriesCardPosterCandidates, seriesCardPosterCrossOrigin } from '../../features/watchlist/seriesCardPresentation';
import { dominantPosterHue, POSTER_HUE_FALLBACK, readPosterHue, rememberPosterHue } from '../../features/watchlist/posterHue';
import { movieEndTime, movieRuntime } from '../../features/watchlist/watchNext18c';
import { formatMovieRating, formatMovieRuntime, formatReleaseCountdown, homeMovieRelease, readHomeMovieFacts } from '../../features/watchlist/homeMovies';
import { SeenItCheckButton } from '../SeenItCheckButton';
import type { TicketActor } from '../../features/people/movieActors';
import { MovieActorLine } from './MovieActorLine';
import { SeenItWatchedStamp } from './SeenItWatchedStamp';

const detailLimiter = createWatchProviderRequestLimiter(2);
// Fenêtre large autour de celle de la politique cinéma : seuls ces films ont besoin de la preuve détaillée.
const CINEMA_PROOF_PAST_DAYS = 120;
const CINEMA_PROOF_FUTURE_DAYS = 30;
const detailGate = createPassiveCardEnrichmentGate(240);
interface Props {
  actor?: TicketActor | null;
  onActor?: (actor: TicketActor, origin: Show) => void;
  layout?: 'poster' | 'horizontal';
  show: Show;
  start: number;
  onOpen: (id: string, type: 'movie') => void;
  onToggle: (show: Show) => void | boolean | Promise<void | boolean>;
  onRuntime: (id: string, runtime: number) => void;
}
// Mémoïsé : un Vu, un toast ou l'arrivée d'une fiche voisine ne re-rend plus chaque billet (props stables).
export const MovieTicketCard = React.memo(function MovieTicketCard({ actor = null, onActor, show, start, onOpen, onToggle, onRuntime, layout = 'poster' }: Props) {
  const openActor = useCallback((selected: TicketActor) => onActor?.(selected, show), [onActor, show]);
  const cached = show.tmdbId ? tmdb.peekRenderableMediaDetails(show.tmdbId, 'movie') : null;
  const [details, setDetails] = useState<unknown>(cached);
  const [phase, setPhase] = useState<{ kind: 'tear' | 'back'; sequence: number } | null>(null);
  const [pendingFrom, setPendingFrom] = useState<boolean | null>(null);
  const [error, setError] = useState(false);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const runtime = movieRuntime(show, details || cached);
  // Revue Codex #943 : un film sorti récemment sans preuve « en salle » détaillée est rechargé une fois, même
  // si sa durée est déjà connue (ancien instantané sans release_dates).
  const needsCinemaProof = (value: unknown) => {
    const date = readHomeMovieFacts(show, value).releaseDate;
    if (!date || (value && typeof value === 'object' && 'release_dates' in value)) return false;
    const age = (start - new Date(`${date}T12:00:00`).getTime()) / 86_400_000;
    return age >= -CINEMA_PROOF_FUTURE_DAYS && age <= CINEMA_PROOF_PAST_DAYS;
  };
  const missingProof = needsCinemaProof(details || cached);
  const enrich = useCallback(() => {
    const known = show.tmdbId ? tmdb.peekRenderableMediaDetails(show.tmdbId, 'movie') : null;
    if (!show.tmdbId || (movieRuntime(show, known) && !needsCinemaProof(known))) return;
    const key = `movie:${show.tmdbId}`;
    if (!detailGate.tryStart(key)) return;
    void detailLimiter.run(async () => {
      const result = await tmdb.getMovieDetails(show.tmdbId);
      if (!result.ok) { detailGate.fail(key); return; }
      detailGate.succeed(key);
      if (!mounted.current) return;
      setDetails(result.value);
      const duration = movieRuntime(show, result.value);
      if (duration) onRuntime(show.id, duration);
    }).catch(() => detailGate.fail(key));
  }, [show.id, show.tmdbId, onRuntime]);
  const { cardRef, providerLogo, providerName } = usePassiveWatchProvider({
    tmdbId: show.tmdbId, mediaType: 'movie', retainInLibraryCache: true, onEnrich: runtime && !missingProof ? undefined : enrich,
  });
  const movieDetails = details && typeof details === 'object' ? details as { release_date?: string; genres?: Array<{ name: string }> } : null;
  const local = show as Show & { releaseDate?: string; year?: number | string };
  const year = (show.firstAirDate || local.releaseDate || movieDetails?.release_date)?.slice(0, 4) || local.year || '';
  const posterCandidates = seriesCardPosterCandidates(show);
  const candidatesKey = posterCandidates.join('\0');
  const [posterIndex, setPosterIndex] = useState(0);
  const poster = posterCandidates[posterIndex] ?? null;
  const posterCrossOrigin = seriesCardPosterCrossOrigin(poster, Capacitor.isNativePlatform());
  const [hue, setHue] = useState(() => readPosterHue(poster) ?? POSTER_HUE_FALLBACK);
  useEffect(() => { setPosterIndex(0); }, [candidatesKey]);
  useEffect(() => { setHue(readPosterHue(poster) ?? POSTER_HUE_FALLBACK); }, [poster]);
  const watched = show.seenEpisodes?.includes('movie') || false;
  const previousWatched = useRef(watched);
  useEffect(() => {
    if (previousWatched.current && !watched && !inFlight.current) {
      setPhase(previous => ({ kind: 'back', sequence: (previous?.sequence || 0) + 1 }));
    }
    previousWatched.current = watched;
  }, [watched]);
  const visibleWatched = pendingFrom ?? watched;
  const end = movieEndTime(start, runtime);
  // SEENIT-UX-022 : note, durée · genre et sortie lues dans les détails déjà en cache ; jamais de Vu avant la sortie.
  const facts = readHomeMovieFacts(show, details || cached);
  const release = homeMovieRelease(facts.releaseDate, isMovieAtCinema(details || cached), start);
  const meta = [formatMovieRuntime(runtime), facts.genre].filter(Boolean).join(' · ') || String(year);
  const countdown = release.kind === 'upcoming' ? formatReleaseCountdown(release) : null;
  const canMark = release.kind !== 'upcoming' || visibleWatched;
  const stubTop = countdown ? countdown.top : release.kind === 'cinema' ? 'au cinéma' : end?.afterMidnight ? 'après minuit' : 'fin à';
  const stubValue = countdown ? countdown.value : release.kind === 'cinema' ? formatMovieRuntime(runtime) || '—' : end ? end.label.replace('fin ', '') : '—';
  const late = !countdown && release.kind !== 'cinema' && Boolean(end?.afterMidnight);
  const rating = facts.rating !== null && <span className="movie-ticket__rating" aria-label={`Note ${formatMovieRating(facts.rating)} sur 10`}>★ {formatMovieRating(facts.rating)}</span>;
  const variant = countdown ? ' movie-ticket--upcoming' : release.kind === 'cinema' ? ' movie-ticket--cinema' : '';
  const provider = getFormattedProviderLogo(providerLogo, providerName);
  const initials = show.title.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase();
  const handlePosterLoad = (image: HTMLImageElement) => {
    if (!poster) return;
    const existing = readPosterHue(poster);
    if (existing !== undefined) { setHue(existing); return; }
    try {
      const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 24;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return;
      context.drawImage(image, 0, 0, 16, 24);
      const value = dominantPosterHue(context.getImageData(0, 0, 16, 24).data);
      rememberPosterHue(poster, value); setHue(value);
    } catch { /* Le poster natif reste visible lorsque les pixels ne sont pas lisibles. */ }
  };
  async function toggle() {
    if (inFlight.current) return;
    inFlight.current = true; setPendingFrom(watched); setError(false);
    try {
      const result = await onToggle(show);
      if (result === false) { if (mounted.current) setError(true); return; }
      if (!mounted.current) return;
      try { navigator.vibrate?.(15); } catch { /* Haptique facultative. */ }
      setPhase(previous => ({ kind: watched ? 'back' : 'tear', sequence: (previous?.sequence || 0) + 1 }));
    } catch { if (mounted.current) setError(true); }
    finally { inFlight.current = false; if (mounted.current) setPendingFrom(null); }
  }
  if (layout === 'horizontal') return <div ref={cardRef} className={`movie-ticket movie-ticket--horizontal${variant}${visibleWatched ? ' movie-ticket--watched' : ''}${phase ? ` movie-ticket--${phase.kind}` : ''}`} data-movie-ticket={show.id} style={{ '--ticket-hue': hue } as React.CSSProperties}>
    <div className="movie-ticket__body">
      <div className="movie-ticket__main">
        {poster && <img className="movie-ticket__ambient" src={poster} alt="" aria-hidden="true" loading="lazy" />}
        <div className="movie-ticket__tint" aria-hidden="true" />
        <button className="movie-ticket__open" type="button" aria-label={`Ouvrir ${show.title}, film${year ? ` de ${year}` : ''}`} onClick={() => onOpen(show.id, 'movie')} />
        <div className="movie-ticket__poster"><span aria-hidden="true">{initials}</span>{poster && <img src={poster} crossOrigin={posterCrossOrigin} alt="" aria-hidden="true" loading="lazy" onLoad={event => handlePosterLoad(event.currentTarget)} onError={() => setPosterIndex(index => index + 1)} />}{rating}</div>
        <div className="movie-ticket__info"><h3>{show.title}</h3><p className="movie-ticket__meta">{meta}</p>{actor && <MovieActorLine actor={actor} list onOpen={openActor} />}<p>{provider && <img src={provider} alt={providerName || 'Diffuseur'} title={providerName || undefined} loading="lazy" onError={event => { event.currentTarget.style.visibility = 'hidden'; }} />}<span>{countdown ? `Sortie le ${countdown.date}` : providerName || (release.kind === 'cinema' ? 'En salle' : year)}</span></p></div>
        {visibleWatched && <button type="button" className="movie-ticket__undo" aria-label={`Annuler le visionnage de ${show.title}`} disabled={pendingFrom !== null} onClick={toggle}><SeenItWatchedStamp screen className="movie-ticket__undo-stamp" /></button>}
      </div>
      <div key={phase?.sequence || 0} className="movie-ticket__stub" aria-hidden="true"><span>{stubTop}</span><strong className={late ? 'movie-ticket__late' : undefined}>{stubValue}</strong></div>
      {canMark && <SeenItCheckButton glyph="screen" size={26} className="movie-ticket__check" error={error} isWatched={visibleWatched} pending={pendingFrom !== null} title={`Marquer ${show.title} comme ${watched ? 'non vu' : 'vu'}`} onClick={toggle} />}
    </div>
    <span className="sr-only" role="status" aria-live="polite">{error ? 'Le visionnage n’a pas pu être enregistré.' : phase ? `${show.title} marqué ${visibleWatched ? 'vu' : 'non vu'}` : ''}</span>
  </div>;
  return <div ref={cardRef} className={`movie-ticket movie-ticket--${layout}${variant}${visibleWatched ? ' movie-ticket--watched' : ''}${phase ? ` movie-ticket--${phase.kind}` : ''}`} data-movie-ticket={show.id} style={{ '--ticket-hue': hue } as React.CSSProperties}>
    <div className="movie-ticket__body">
      <button className="movie-ticket__open" type="button" aria-label={`Ouvrir ${show.title}, film${year ? ` de ${year}` : ''}${countdown ? `, ${countdown.top} ${countdown.value}` : end && release.kind === 'released' ? `, ${end.label}` : ''}`} onClick={() => onOpen(show.id, 'movie')} />
      <div className="movie-ticket__poster" aria-hidden="true"><span>{initials}</span>{poster && <img src={poster} crossOrigin={posterCrossOrigin} alt="" loading="lazy" decoding="async" onLoad={event => handlePosterLoad(event.currentTarget)} onError={() => setPosterIndex(index => index + 1)} />}
        {visibleWatched && <SeenItWatchedStamp key={phase?.sequence || 0} className="movie-ticket__stamp" />}
        {rating}
      </div>
      {provider && <span className="movie-ticket__provider" role="img" aria-label={providerName || 'Diffuseur'} title={providerName || undefined}><img src={provider} alt="" loading="lazy" onError={event => { event.currentTarget.style.visibility = 'hidden'; }} /></span>}
      {canMark && <SeenItCheckButton glyph="screen" size={26} className="movie-ticket__check" error={error} isWatched={visibleWatched} pending={pendingFrom !== null} title={`Marquer ${show.title} comme ${watched ? 'non vu' : 'vu'}`} onClick={toggle} />}
      {visibleWatched && <button type="button" className="movie-ticket__undo" aria-label={`Annuler le visionnage de ${show.title}`} disabled={pendingFrom !== null} onClick={toggle}><SeenItWatchedStamp className="movie-ticket__undo-stamp" /></button>}
      <div key={phase?.sequence || 0} className="movie-ticket__stub" aria-hidden="true"><span className={late ? 'movie-ticket__late' : undefined}>{stubTop}<strong>{stubValue}</strong></span>{countdown && <small>{countdown.date}</small>}</div>
    </div>
    <h3>{show.title}</h3>
    <div className="movie-ticket__metadata"><span>{meta}</span></div>
    <MovieActorLine actor={actor} onOpen={openActor} />
    <span className="sr-only" role="status" aria-live="polite">{error ? 'Le visionnage n’a pas pu être enregistré.' : phase ? `${show.title} marqué ${visibleWatched ? 'vu' : 'non vu'}` : ''}</span>
  </div>;
});
