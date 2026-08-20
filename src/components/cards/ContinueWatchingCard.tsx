import React, { useState, useEffect } from 'react';
import { SeenItCheckButton } from '../SeenItCheckButton';
import { type Show } from '../../types';
import { getAiredProgress, cn, getTodayStr } from '../../lib/utils';
import { tmdb } from '../../features/shows/tmdb';
import { getFormattedProviderLogo, extractOfficialStreamingProvider, PLEX_LOGO_SVG } from '../../utils/providerLogos';
import { checkPlexAvailability } from '../../features/plex/plexAvailability';

interface Props {
  key?: React.Key;
  show: Show;
  onShowClick?: (id: string, mediaType?: 'tv' | 'movie') => void;
  onEpisodeClick?: (show: Show, seasonNumber: number, episodeNumber: number) => void;
  onMarkAsSeen: (show: Show) => void;
}

function timeAgo(ms: number) {
  if (!ms || isNaN(ms)) return "";
  const diff = Date.now() - ms;
  const h = Math.floor(diff / (1000 * 60 * 60));
  if (h < 1) return "Il y a moins d'une heure";
  if (h < 24) return `Il y a ${h} heure${h > 1 ? 's' : ''}`;
  const d = Math.floor(h / 24);
  return `Il y a ${d} jour${d > 1 ? 's' : ''}`;
}

export function ContinueWatchingCard({ show, onShowClick, onEpisodeClick, onMarkAsSeen }: Props) {
  let nextEpNum = show.nextEpisodeToWatch;

  // 1. Fallback si nextEpisodeToWatch est temporairement null
  if (!nextEpNum) {
    const seen = show.seenEpisodes || [];
    if (seen.length > 0) {
      let maxS = 1;
      let maxE = 0;
      seen.forEach(epKey => {
        const [s, e] = epKey.split('x').map(Number);
        if (!isNaN(s) && !isNaN(e)) {
          if (s > maxS || (s === maxS && e > maxE)) {
            maxS = s;
            maxE = e;
          }
        }
      });
      nextEpNum = {
        season_number: maxS,
        episode_number: maxE + 1,
      };
    } else {
      nextEpNum = {
        season_number: 1,
        episode_number: 1,
      };
    }
  }

  const watched = show.seenEpisodes ? show.seenEpisodes.length : 0;
  const progressPercent = getAiredProgress(show);
  const totalCount = show.totalAiredEpisodes || show.totalEpisodes || (show.seasonsCache ? show.seasonsCache.flatMap((s: any) => s.episodes || []).length : 0);
  const isUpToDate = progressPercent >= 100 || (watched > 0 && totalCount > 0 && watched >= totalCount);

  const parseTimestamp = (val: any): number => {
    if (!val) return 0;
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
    const num = Number(val);
    if (!isNaN(num) && num > 1000000000) return num;
    const parsed = Date.parse(val);
    return isNaN(parsed) ? 0 : parsed;
  };

  let lastWatchedStr = "";
  let lastWatchedTime = "";
  let maxWatchedAt = 0;

  if (show.episodeRecords && Object.keys(show.episodeRecords).length > 0) {
    const entries = Object.entries(show.episodeRecords)
      .map(([key, val]) => ({
        key,
        val,
        time: val && val.watchedAt ? parseTimestamp(val.watchedAt) : 0
      }))
      .filter(item => item.time > 0)
      .sort((a, b) => b.time - a.time);

    if (entries.length > 0) {
      const { key, time } = entries[0];
      maxWatchedAt = time;
      let s = '', e = '';
      if (key.includes('x')) {
        const parts = key.split('x');
        s = parts[0];
        e = parts[1];
      } else {
        const match = key.match(/S(\d+)E(\d+)/i);
        if (match) {
          s = match[1];
          e = match[2];
        }
      }
      if (s && e) {
        lastWatchedStr = `S${s.padStart(2, '0')} | E${e.padStart(2, '0')}`;
        lastWatchedTime = timeAgo(time);
      }
    }
  }

  if (show.lastWatchedAt) {
    const lwTime = parseTimestamp(show.lastWatchedAt);
    if (lwTime > maxWatchedAt) {
      maxWatchedAt = lwTime;
      if (!lastWatchedTime) {
        lastWatchedTime = timeAgo(lwTime);
      }
    }
  }

  // 4. Calcul des badges événementiels
  let badge = null;
  if (nextEpNum.air_date) {
    const airMs = parseTimestamp(nextEpNum.air_date);
    if (airMs > 0) {
      const nowMs = Date.now();
      const diffHours = (nowMs - airMs) / (1000 * 60 * 60);
      const diffDays = Math.floor((nowMs - airMs) / (1000 * 60 * 60 * 24));
      if (diffHours >= 0 && diffHours < 24) {
        badge = <div className="absolute bottom-0 left-1/2 -translate-x-1/2 z-20 bg-gradient-to-r from-red-500 to-amber-500 text-white text-[10px] font-extrabold px-2.5 py-0.5 rounded-t-lg shadow-lg uppercase tracking-wider animate-pulse whitespace-nowrap">SORTI AUJOURD'HUI 🔥</div>;
      } else if (diffDays === 1 || (diffHours >= 24 && diffHours < 48)) {
        badge = <div className="absolute bottom-0 left-1/2 -translate-x-1/2 z-20 bg-blue-600 text-white text-[10px] font-extrabold px-2.5 py-0.5 rounded-t-lg shadow-lg uppercase tracking-wider shadow-blue-500/20 whitespace-nowrap">SORTI HIER 🌟</div>;
      } else if (diffDays > 1 && diffDays <= 7) {
        badge = <div className="absolute bottom-0 left-1/2 -translate-x-1/2 z-20 bg-indigo-600 text-white text-[10px] font-extrabold px-2.5 py-0.5 rounded-t-lg shadow-lg uppercase tracking-wider whitespace-nowrap">SORTI IL Y A {diffDays}J 🆕</div>;
      }
    }
  }

  const cachedSeason = show.seasonsCache?.find((s: any) => s.season_number === nextEpNum.season_number);
  let totalSeasonEpisodes = nextEpNum.episode_count || 
    cachedSeason?.episode_count || 
    cachedSeason?.episodes?.length || 
    (show.nextEpisodeToAir?.season_number === nextEpNum.season_number ? show.nextEpisodeToAir?.episode_count : null) || 
    1;
  let airedInSeason = totalSeasonEpisodes;

  // Logique infaillible pour connaître les épisodes sortis dans la saison
  const nextEpToAir = show.nextEpisodeToAir || (show as any).next_episode_to_air;
  let isAiringSeason = false;
  const todayStr = getTodayStr();
  
  if (nextEpToAir && nextEpToAir.season_number === nextEpNum.season_number) {
    airedInSeason = Math.max(0, nextEpToAir.episode_number - 1);
    isAiringSeason = true;
  } else if (nextEpNum.air_date) {
    if (nextEpNum.air_date > todayStr) {
      airedInSeason = Math.max(0, nextEpNum.episode_number - 1);
      isAiringSeason = true;
    }
  }

  if (isAiringSeason && totalSeasonEpisodes <= airedInSeason) {
      totalSeasonEpisodes = Math.max(totalSeasonEpisodes, airedInSeason + 1);
  } else if (!isAiringSeason) {
      isAiringSeason = airedInSeason < totalSeasonEpisodes;
  }

  const seasonTotal = nextEpNum.episode_count || cachedSeason?.episode_count || cachedSeason?.episodes?.length || (show.nextEpisodeToAir?.season_number === nextEpNum.season_number ? show.nextEpisodeToAir?.episode_count : null);
  const knownTotal = (seasonTotal && seasonTotal >= airedInSeason && seasonTotal > 1) ? seasonTotal : null;

  if (!badge) {
    const remainingToWatch = totalSeasonEpisodes - nextEpNum.episode_number + 1;
    const isLastEpisodeOfSeason = remainingToWatch === 1 && nextEpNum.episode_number > 1;
    const isLastEpisodeOfSeries = isLastEpisodeOfSeason && (nextEpNum.series_ended || show.seriesEnded);
    const isFirstEpisodeOfSeason = nextEpNum.episode_number === 1;

    if (isLastEpisodeOfSeries) {
      badge = <div className="absolute bottom-0 left-1/2 -translate-x-1/2 z-20 bg-gradient-to-r from-red-600 to-purple-600 text-white text-[10px] font-extrabold px-2.5 py-0.5 rounded-t-lg shadow-lg uppercase tracking-wider whitespace-nowrap">FINAL ABSOLU 🏁</div>;
    } else if (isLastEpisodeOfSeason && !isAiringSeason) {
      badge = <div className="absolute bottom-0 left-1/2 -translate-x-1/2 z-20 bg-orange-500 text-white text-[10px] font-extrabold px-2.5 py-0.5 rounded-t-lg shadow-lg uppercase tracking-wider whitespace-nowrap">FIN DE SAISON 🎬</div>;
    } else if (isAiringSeason) {
      if (airedInSeason > 0) {
        const badgeText = knownTotal ? `${airedInSeason}/${knownTotal} ÉP. DISPOS 🍿` : `${airedInSeason} ÉP. DISPOS 🍿`;
        badge = <div className="absolute bottom-0 left-1/2 -translate-x-1/2 z-20 bg-emerald-600 text-white text-[10px] font-extrabold px-2.5 py-0.5 rounded-t-lg shadow-lg uppercase tracking-wider whitespace-nowrap">{badgeText}</div>;
      } else {
        badge = <div className="absolute bottom-0 left-1/2 -translate-x-1/2 z-20 bg-blue-600 text-white text-[10px] font-extrabold px-2.5 py-0.5 rounded-t-lg shadow-lg uppercase tracking-wider whitespace-nowrap">BIENTÔT DISPO ⏳</div>;
      }
    } else if (remainingToWatch > 1 && remainingToWatch <= 3 && !isAiringSeason) {
      badge = <div className="absolute bottom-0 left-1/2 -translate-x-1/2 z-20 bg-[#E5A93D] text-black text-[10px] font-extrabold px-2.5 py-0.5 rounded-t-lg shadow-lg uppercase tracking-wider whitespace-nowrap">PLUS QUE {remainingToWatch} ⚡</div>;
    } else if (isFirstEpisodeOfSeason) {
      badge = <div className="absolute bottom-0 left-1/2 -translate-x-1/2 z-20 bg-emerald-500 text-white text-[10px] font-extrabold px-2.5 py-0.5 rounded-t-lg shadow-lg uppercase tracking-wider whitespace-nowrap">SAISON DISPO 🍿</div>;
    }
  }

  // Calcul du nombre d'autres épisodes disponibles restant à voir AU-DELÀ de l'épisode courant
  // Exemple: 7 épisodes sortis, on est sur E05 (Continuer S03 | E05) -> il reste E06 et E07 disponibles, soit "+ 2"
  // Si on est sur le dernier épisode disponible (ex: E10 sur 10), extraAvailableEpisodes = 0 -> pas de "+ X" affiché
  let extraAvailableEpisodes = 0;
  const sNum = nextEpNum?.season_number ?? 1;
  const eNum = nextEpNum?.episode_number ?? 1;

  if (show.seasonsCache && Array.isArray(show.seasonsCache) && show.seasonsCache.length > 0) {
    const seenSet = new Set(show.seenEpisodes || []);
    let totalUnwatchedAired = 0;
    for (const s of show.seasonsCache) {
      if (s.season_number > 0 && Array.isArray(s.episodes)) {
        for (const ep of s.episodes) {
          if (ep.air_date && ep.air_date <= todayStr) {
            const key = `${s.season_number}x${ep.episode_number}`;
            if (!seenSet.has(key)) {
              totalUnwatchedAired++;
            }
          }
        }
      }
    }
    extraAvailableEpisodes = Math.max(0, totalUnwatchedAired - 1);
  } else {
    extraAvailableEpisodes = Math.max(0, airedInSeason - eNum);
  }

  const [fetchedStillMap, setFetchedStillMap] = useState<Record<string, string>>({});

  const currentEpKey = `${sNum}x${eNum}`;
  let episodeStill: string | null = fetchedStillMap[currentEpKey] || null;

  if (!episodeStill) {
    if (nextEpNum && nextEpNum.season_number === sNum && nextEpNum.episode_number === eNum && nextEpNum.still_path) {
      episodeStill = nextEpNum.still_path;
    } else if (show.nextEpisodeToWatch && show.nextEpisodeToWatch.season_number === sNum && show.nextEpisodeToWatch.episode_number === eNum && show.nextEpisodeToWatch.still_path) {
      episodeStill = show.nextEpisodeToWatch.still_path;
    } else if (show.nextEpisodeToAir && show.nextEpisodeToAir.season_number === sNum && show.nextEpisodeToAir.episode_number === eNum && show.nextEpisodeToAir.still_path) {
      episodeStill = show.nextEpisodeToAir.still_path;
    }
  }

  if (!episodeStill && show.seasonsCache && Array.isArray(show.seasonsCache)) {
    const s = show.seasonsCache.find((sc: any) => sc.season_number === sNum);
    if (s && Array.isArray(s.episodes)) {
      const ep = s.episodes.find((e: any) => e.episode_number === eNum);
      if (ep?.still_path) {
        episodeStill = ep.still_path;
      }
    }
  }

  const [providerLogo, setProviderLogo] = useState<string | null>(null);
  const [providerName, setProviderName] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    if (show.tmdbId) {
      tmdb.getWatchProviders(show.tmdbId, show.mediaType === 'movie' ? 'movie' : 'tv').then(res => {
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

        if (!officialFound && !show.networks?.length) {
          checkPlexAvailability({
            tmdbId: show.tmdbId,
            title: show.title,
            originalTitle: (show as any).originalTitle || (show as any).original_title,
            year: show.firstAirDate?.slice(0, 4),
            mediaType: show.mediaType === 'movie' ? 'movie' : 'tv'
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
  }, [show.tmdbId, show.mediaType, show.title]);

  useEffect(() => {
    let isMounted = true;
    if (!episodeStill && show.tmdbId) {
      tmdb.getEpisodeDetails(show.tmdbId, sNum, eNum).then(res => {
        if (isMounted && res.ok && res.value?.still_path) {
          setFetchedStillMap(prev => ({ ...prev, [`${sNum}x${eNum}`]: res.value.still_path }));
        }
      });
    }
    return () => { isMounted = false; };
  }, [show.tmdbId, sNum, eNum, episodeStill]);

  const showBackdrop = show.backdropPath;
  const showPoster = show.posterPath;

  const rawPath = episodeStill || showBackdrop || showPoster;
  const imgSrc = rawPath ? (rawPath.startsWith('http') ? rawPath : `https://image.tmdb.org/t/p/w500${rawPath}`) : null;

  const handleCardClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onEpisodeClick && nextEpNum) {
      onEpisodeClick(show, nextEpNum.season_number, nextEpNum.episode_number);
    } else if (onShowClick && show.id) {
      onShowClick(show.id, show.mediaType);
    }
  };

  const networkLogo = getFormattedProviderLogo(
    providerLogo || (show.networks && show.networks.length > 0 ? show.networks[0].logo_path : null),
    providerName || (show.networks && show.networks.length > 0 ? show.networks[0].name : (show as any).network || (show as any).platform)
  );

  return (
    <div className="flex-shrink-0 w-64 flex flex-col cursor-pointer snap-start group" onClick={handleCardClick}>
      <div className="w-full aspect-video rounded-2xl overflow-hidden relative mb-2 bg-zinc-900 shadow-lg">
        {/* OVERLAY PREMIUM */}
        <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/10 group-hover:ring-white/20 shadow-[inset_0_1px_1px_rgba(255,255,255,0.12)] transition-all z-20" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/[0.04] to-transparent opacity-0 group-hover:opacity-100 transition-opacity z-10" />

        {networkLogo && (
          <div className="absolute top-0 right-0 bg-white/95 backdrop-blur-md w-7 h-7 rounded-bl-xl p-1 shadow-sm flex items-center justify-center z-20 pointer-events-none">
            <img loading="lazy" decoding="async" src={networkLogo} alt="" className="w-5 h-5 object-contain rounded-[3px]" />
          </div>
        )}

        {badge}

        {imgSrc ? (
          <img loading="lazy" decoding="async" 
            src={imgSrc}
            alt={show.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-zinc-600 p-2 text-center">{show.title}</div>
        )}
      </div>
      
      <div className="w-full h-1 bg-zinc-800 rounded-full mb-3 overflow-hidden">
        {watched > 0 && progressPercent === 0 && !totalCount ? (
          <div className="h-full w-full bg-zinc-700/50 animate-pulse rounded-full" />
        ) : (
          <div className={cn("h-full rounded-full transition-all duration-500 ease-out", isUpToDate ? "bg-emerald-500" : "bg-[#E5A93D]")} style={{ width: `${progressPercent}%` }} />
        )}
      </div>

      <div className="flex justify-between items-center w-full">
        <div className="flex flex-col min-w-0 flex-1 pr-2">
          <button 
            className="text-[#E5A93D] font-extrabold text-xs sm:text-[13px] uppercase tracking-wider mb-1 line-clamp-2 text-left hover:underline leading-tight"
            onClick={(e) => {
              e.stopPropagation();
              if (onShowClick && show.id) {
                onShowClick(show.id, show.mediaType);
              }
            }}
          >
            {show.title}
          </button>
          <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
            <span className="text-white font-semibold text-sm">
              {watched === 0 ? 'Commencer' : 'Continuer'} S{(nextEpNum?.season_number ?? 1).toString().padStart(2, '0')} | E{(nextEpNum?.episode_number ?? 1).toString().padStart(2, '0')}
            </span>
            {extraAvailableEpisodes > 0 && (
              <span className="text-zinc-400 font-medium text-xs sm:text-[13px]">
                + {extraAvailableEpisodes}
              </span>
            )}
          </div>
          <span className="text-indigo-400 text-xs font-medium">
            {lastWatchedStr ? `Vu ${lastWatchedStr}${lastWatchedTime ? ` - ${lastWatchedTime}` : ''}` : 'Jamais regardé'}
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