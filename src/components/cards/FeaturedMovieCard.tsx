import React from 'react';
import type { Show } from '../../types';
import { usePassiveWatchProvider } from '../../hooks/usePassiveWatchProvider';
import { getFormattedProviderLogo } from '../../utils/providerLogos';
import { imageUrl } from '../../features/watchlist/seriesCardPresentation';
import { formatMovieRating, formatMovieRuntime, type HomeMovieFacts } from '../../features/watchlist/homeMovies';

interface Props {
  show: Show;
  facts: HomeMovieFacts;
  runtime: number | null;
  onOpen: (id: string, type: 'movie') => void;
  onShuffle: () => void;
  canShuffle: boolean;
}

/** « À l'affiche » : un film à voir bien noté, tiré au hasard (SEENIT-UX-022). */
export function FeaturedMovieCard({ show, facts, runtime, onOpen, onShuffle, canShuffle }: Props) {
  const { cardRef, providerLogo, providerName } = usePassiveWatchProvider({ tmdbId: show.tmdbId, mediaType: 'movie', retainInLibraryCache: true });
  const provider = getFormattedProviderLogo(providerLogo, providerName);
  const backdrop = imageUrl(show.backdropPath, 'w780') || imageUrl(show.posterPath, 'w500');
  const meta = [formatMovieRuntime(runtime), facts.genre].filter(Boolean).join(' · ');
  return <div ref={cardRef} className="home-featured-movie" role="region" aria-label={`À l’affiche : ${show.title}`}>
    {backdrop && <img className="home-featured-movie__image" src={backdrop} alt="" loading="lazy" decoding="async" />}
    <span className="home-featured-movie__eyebrow">À l’affiche</span>
    <div className="home-featured-movie__body">
      <h3>{show.title}</h3>
      <p className="home-featured-movie__meta">{meta}{meta && facts.rating !== null ? ' · ' : ''}{facts.rating !== null && <strong>★ {formatMovieRating(facts.rating)}</strong>}</p>
      <p className="home-featured-movie__why">Tiré au hasard parmi tes films à voir les mieux notés.</p>
      <div className="home-featured-movie__actions">
        {provider && <span className="home-featured-movie__provider" role="img" aria-label={providerName || 'Diffuseur'}><img src={provider} alt="" loading="lazy" /></span>}
        <button type="button" className="home-featured-movie__open" onClick={() => onOpen(show.id, 'movie')}>Voir la fiche</button>
        {canShuffle && <button type="button" className="home-featured-movie__shuffle" aria-label="Tirer un autre film" onClick={onShuffle}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" /><path d="M3 21v-5h5" /></svg>
        </button>}
      </div>
    </div>
  </div>;
}
