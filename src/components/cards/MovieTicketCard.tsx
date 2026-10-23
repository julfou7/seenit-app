import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import type { Show } from '../../types';
import { tmdb } from '../../features/shows/tmdb';
import { usePassiveWatchProvider } from '../../hooks/usePassiveWatchProvider';
import { createWatchProviderRequestLimiter } from '../../features/providers/watchProviderRequestPolicy';
import { createPassiveCardEnrichmentGate } from '../../features/providers/passiveCardEnrichmentPolicy';
import { getFormattedProviderLogo } from '../../utils/providerLogos';
import { seriesCardPosterCandidates, seriesCardPosterCrossOrigin } from '../../features/watchlist/seriesCardPresentation';
import { dominantPosterHue, POSTER_HUE_FALLBACK, readPosterHue, rememberPosterHue } from '../../features/watchlist/posterHue';
import { movieEndTime, movieRuntime } from '../../features/watchlist/watchNext18c';
import { SeenItCheckButton } from '../SeenItCheckButton';
import { SeenItWatchedStamp } from './SeenItWatchedStamp';

const detailLimiter = createWatchProviderRequestLimiter(2);
const detailGate = createPassiveCardEnrichmentGate(240);
interface Props {
  layout?: 'poster' | 'horizontal';
  show: Show;
  start: number;
  onOpen: (id: string, type: 'movie') => void;
  onToggle: (show: Show) => void | boolean | Promise<void | boolean>;
  onRuntime: (id: string, runtime: number) => void;
}
export function MovieTicketCard({ show, start, onOpen, onToggle, onRuntime, layout = 'poster' }: Props) {
  const cached = show.tmdbId ? tmdb.peekMediaDetails(show.tmdbId, 'movie') : null;
  const [details, setDetails] = useState<unknown>(cached);
  const [phase, setPhase] = useState<{ kind: 'tear' | 'back'; sequence: number } | null>(null);
  const [pendingFrom, setPendingFrom] = useState<boolean | null>(null);
  const [error, setError] = useState(false);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const runtime = movieRuntime(show, details || cached);
  const enrich = useCallback(() => {
    if (!show.tmdbId || movieRuntime(show, tmdb.peekMediaDetails(show.tmdbId, 'movie'))) return;
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
    tmdbId: show.tmdbId, mediaType: 'movie', retainInLibraryCache: true, onEnrich: runtime ? undefined : enrich,
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
  return <div ref={cardRef} className={`movie-ticket movie-ticket--${layout}${visibleWatched ? ' movie-ticket--watched' : ''}${phase ? ` movie-ticket--${phase.kind}` : ''}`} data-movie-ticket={show.id} style={{ '--ticket-hue': hue } as React.CSSProperties}>
    <div className="movie-ticket__body">
      <button className="movie-ticket__open" type="button" aria-label={`Ouvrir ${show.title}, film${year ? ` de ${year}` : ''}${end ? `, ${end.label}` : ''}`} onClick={() => onOpen(show.id, 'movie')} />
      <div className="movie-ticket__poster" aria-hidden="true"><span>{initials}</span>{poster && <img src={poster} crossOrigin={posterCrossOrigin} alt="" loading="lazy" decoding="async" onLoad={event => handlePosterLoad(event.currentTarget)} onError={() => setPosterIndex(index => index + 1)} />}
        {visibleWatched && <SeenItWatchedStamp key={phase?.sequence || 0} className="movie-ticket__stamp" />}
      </div>
      {provider && <span className="movie-ticket__provider" role="img" aria-label={providerName || 'Diffuseur'} title={providerName || undefined}><img src={provider} alt="" loading="lazy" onError={event => { event.currentTarget.style.visibility = 'hidden'; }} /></span>}
      {providerName?.startsWith('Plex (') && <span className="movie-ticket__server">Plex · {providerName.slice(6, -1)}</span>}
      <SeenItCheckButton size={24} className="movie-ticket__check" error={error} isWatched={visibleWatched} pending={pendingFrom !== null} title={`Marquer ${show.title} comme ${watched ? 'non vu' : 'vu'}`} onClick={toggle} />
      {visibleWatched && <button type="button" className="movie-ticket__undo" aria-label={`Annuler le visionnage de ${show.title}`} disabled={pendingFrom !== null} onClick={toggle}><SeenItWatchedStamp className="movie-ticket__undo-stamp" /></button>}
      <div key={phase?.sequence || 0} className="movie-ticket__stub" aria-hidden="true"><span>{layout === 'horizontal' ? 'Fin à' : year}</span>{end && <strong className={end.afterMidnight ? 'movie-ticket__late' : undefined}>{end.label.replace('fin ', '')}</strong>}{layout === 'horizontal' && <small>{runtime ? `${Math.floor(runtime / 60)}h${String(runtime % 60).padStart(2, '0')}` : 'Durée inconnue'}</small>}</div>
    </div>
    <h3>{show.title}</h3>
    {layout === 'horizontal' && <p className="movie-ticket__metadata">{[year, movieDetails?.genres?.[0]?.name].filter(Boolean).join(' · ') || 'Film'}</p>}
    <span className="sr-only" role="status" aria-live="polite">{error ? 'Le visionnage n’a pas pu être enregistré.' : phase ? `${show.title} marqué ${visibleWatched ? 'vu' : 'non vu'}` : ''}</span>
  </div>;
}
