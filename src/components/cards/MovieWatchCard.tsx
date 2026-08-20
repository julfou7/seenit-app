import React, { useState, useEffect } from 'react';
import { SeenItCheckButton } from '../SeenItCheckButton';
import { type Show } from '../../types';
import { tmdb, isMovieAtCinema, isMovieUpcoming } from '../../features/shows/tmdb';
import { getFormattedProviderLogo, extractOfficialStreamingProvider, PLEX_LOGO_SVG } from '../../utils/providerLogos';
import { checkPlexAvailability } from '../../features/plex/plexAvailability';

interface Props {
  key?: React.Key;
  show: Show;
  onShowClick?: (id: string, mediaType?: 'tv' | 'movie') => void;
  onMarkAsSeen: (show: Show) => void;
}

function formatRuntime(minutes?: number) {
  if (!minutes || isNaN(minutes) || minutes <= 0) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h}h${m > 0 ? (m < 10 ? `0${m}` : m) : ''}`;
  return `${m}min`;
}

export function MovieWatchCard({ show, onShowClick, onMarkAsSeen }: Props) {
  const [runtime, setRuntime] = useState<number | null>((show as any).runtime || null);
  const [releaseYear, setReleaseYear] = useState<string | null>(
    show.firstAirDate ? show.firstAirDate.slice(0, 4) : null
  );
  const [providerLogo, setProviderLogo] = useState<string | null>(null);
  const [providerName, setProviderName] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    if (show.tmdbId) {
      if (!runtime || !releaseYear) {
        tmdb.getMovieDetails(show.tmdbId).then(res => {
          if (isMounted && res.ok && res.value) {
            if (res.value.runtime && !runtime) {
              setRuntime(res.value.runtime);
            }
            if (res.value.release_date && !releaseYear) {
              setReleaseYear(res.value.release_date.slice(0, 4));
            }
          }
        }).catch(() => {});
      }

      tmdb.getWatchProviders(show.tmdbId, 'movie').then(res => {
        if (!isMounted) return;
        let officialFound = false;
        if (res.ok && res.value?.results) {
          const stream = extractOfficialStreamingProvider(res.value.results);
          if (stream) {
            setProviderLogo(stream.logo_path);
            setProviderName(stream.provider_name);
            officialFound = true;
          }
        }

        // Si aucun diffuseur officiel SVOD/Streaming n'est disponible, on vérifie la disponibilité sur Plex
        if (!officialFound) {
          checkPlexAvailability({
            tmdbId: show.tmdbId,
            title: show.title,
            originalTitle: (show as any).originalTitle || (show as any).original_title,
            year: releaseYear || show.firstAirDate?.slice(0, 4),
            mediaType: 'movie'
          }).then(plexInfo => {
            if (isMounted && plexInfo.available) {
              setProviderLogo(PLEX_LOGO_SVG);
              setProviderName(plexInfo.serverName ? `Plex (${plexInfo.serverName})` : 'Plex');
            }
          }).catch(() => {});
        }
      }).catch(() => {});
    }
    return () => { isMounted = false; };
  }, [show.tmdbId, runtime, releaseYear, show.title]);

  const rawPath = show.posterPath || show.backdropPath;
  const imgSrc = rawPath ? (rawPath.startsWith('http') ? rawPath : `https://image.tmdb.org/t/p/w500${rawPath}`) : null;

  // Build meta string in blue (e.g., "2023 • 2h15" or "2023" or "2h15")
  const metaParts: string[] = [];
  if (releaseYear) metaParts.push(releaseYear);
  const formattedRuntime = formatRuntime(runtime || undefined);
  if (formattedRuntime) metaParts.push(formattedRuntime);
  const metaStr = metaParts.join(' • ') || 'Film';

  // Badge "AU CINÉMA" / sortie récente
  let cinemaBadge = null;
  
  if (show.firstAirDate) {
    const [y, m, d] = show.firstAirDate.split('-').map(Number);
    if (y && m && d) {
      const relDate = new Date(y, m - 1, d);
      relDate.setHours(0, 0, 0, 0);
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const diffMs = now.getTime() - relDate.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays === 0) {
        cinemaBadge = (
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 z-20 bg-gradient-to-r from-red-600 to-amber-600 text-white text-[9px] font-extrabold px-2 py-0.5 rounded-t-lg shadow-lg uppercase tracking-wider whitespace-nowrap animate-pulse">
            SORTI AUJOURD'HUI 🔥
          </div>
        );
      } else if (diffDays === 1) {
        cinemaBadge = (
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 z-20 bg-blue-600 text-white text-[9px] font-extrabold px-2 py-0.5 rounded-t-lg shadow-lg uppercase tracking-wider whitespace-nowrap">
            SORTI HIER 🌟
          </div>
        );
      } else if (diffDays > 1 && diffDays <= 7) {
        cinemaBadge = (
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 z-20 bg-indigo-600 text-white text-[9px] font-extrabold px-2 py-0.5 rounded-t-lg shadow-lg uppercase tracking-wider whitespace-nowrap">
            SORTI IL Y A {diffDays}J 🆕
          </div>
        );
      } else if (isMovieAtCinema(show)) {
        cinemaBadge = (
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 z-20 bg-gradient-to-r from-amber-600 to-rose-600 text-white text-[9px] font-extrabold px-2 py-0.5 rounded-t-lg shadow-lg uppercase tracking-wider whitespace-nowrap shadow-black/50">
            AU CINÉMA 🎬
          </div>
        );
      } else if (isMovieUpcoming(show)) {
        cinemaBadge = (
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 z-20 bg-purple-600 text-white text-[9px] font-extrabold px-2 py-0.5 rounded-t-lg shadow-lg uppercase tracking-wider whitespace-nowrap shadow-black/50">
            À VENIR 🗓️
          </div>
        );
      }
    }
  }

  return (
    <div 
      className="flex-shrink-0 w-36 sm:w-40 flex flex-col cursor-pointer snap-start group" 
      onClick={() => {
        if (onShowClick && show.id) {
          onShowClick(show.id, 'movie');
        }
      }}
    >
      <div className="w-full aspect-[2/3] rounded-2xl overflow-hidden relative mb-2 bg-zinc-900 shadow-lg">
        {/* OVERLAY PREMIUM */}
        <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/10 group-hover:ring-white/20 shadow-[inset_0_1px_1px_rgba(255,255,255,0.12)] transition-all z-20" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/[0.04] to-transparent opacity-0 group-hover:opacity-100 transition-opacity z-10" />

        {/* Diffuseur / Provider logo */}
        {(() => {
          const networkLogo = getFormattedProviderLogo(
            providerLogo || (show.networks && show.networks.length > 0 ? show.networks[0].logo_path : null),
            providerName || (show.networks && show.networks.length > 0 ? show.networks[0].name : (show as any).network || (show as any).platform)
          );
          if (!networkLogo) return null;
          return (
            <div className="absolute top-0 right-0 bg-white/95 backdrop-blur-md w-7 h-7 rounded-bl-xl p-1 shadow-sm flex items-center justify-center z-20 pointer-events-none">
              <img 
                loading="lazy" 
                decoding="async" 
                src={networkLogo} 
                alt="Diffuseur" 
                className="w-5 h-5 object-contain rounded-[3px]" 
              />
            </div>
          );
        })()}

        {/* Cinema / Release Badge */}
        {cinemaBadge}

        {imgSrc ? (
          <img 
            loading="lazy" 
            decoding="async" 
            src={imgSrc}
            alt={show.title}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-zinc-600 p-2 text-center font-bold">
            {show.title}
          </div>
        )}
      </div>

      <div className="flex justify-between items-center w-full">
        <div className="flex flex-col min-w-0 flex-1 pr-1.5">
          <button 
            className="text-[#E5A93D] font-extrabold text-xs sm:text-[13px] uppercase tracking-wider mb-0.5 line-clamp-2 text-left hover:underline leading-tight cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              if (onShowClick && show.id) {
                onShowClick(show.id, 'movie');
              }
            }}
          >
            {show.title}
          </button>
          
          <span className="text-indigo-400 text-xs font-medium truncate">
            {metaStr}
          </span>
        </div>
        
        <SeenItCheckButton 
          onClick={(e) => {
            e.stopPropagation();
            onMarkAsSeen(show);
          }}
          className="flex-shrink-0"
          title="Marquer comme vu"
        />
      </div>
    </div>
  );
}
