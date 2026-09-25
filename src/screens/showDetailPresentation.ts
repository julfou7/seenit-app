import React, { useState, useEffect, useRef, useMemo } from 'react';
import { type Show } from '../types';
import { tmdb, isMovieAtCinema, isMovieUpcoming } from '../features/shows/tmdb';
import { ChevronLeft, Star, Heart, CheckCircle2, Circle, Tv, Zap, X, EyeOff, Archive, Trash2, MoreVertical, Plus, Check, Share, Share2, Play, Calendar, ArchiveRestore, Ban, RotateCcw, MonitorPlay, Ticket, Youtube, Clapperboard, ExternalLink, Clock, RefreshCw, Download } from 'lucide-react';
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
import { resolveCanalProviderTarget } from '../features/shows/canalProviderLink';


export interface ShowDetailScreenProps {
  key?: string;
  showId?: string;
  tmdbId?: number;
  mediaType?: 'tv' | 'movie';
  initialSeason?: number;
  initialEpisode?: number;
  onBack: () => void;
  onShowClick?: (tmdbId: number, mediaType?: 'tv' | 'movie') => void;
}

export const getSeasonReleaseDateText = (airDate?: string): string | null => {
  if (!airDate || !airDate.trim()) return null;
  const str = airDate.trim();
  const parts = str.split('-');

  if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const day = parseInt(parts[2], 10);
    if (!isNaN(year) && !isNaN(month) && !isNaN(day) && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const d = new Date(year, month - 1, day);
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
      }
    }
    if (!isNaN(year) && year > 1900) {
      return year.toString();
    }
  }

  if (parts[0] && parts[0].length === 4) {
    const year = parseInt(parts[0], 10);
    if (!isNaN(year) && year > 1900) {
      return year.toString();
    }
  }

  return null;
};

export const getEpisodeAirDateLabel = (airDate?: string | null) => {
  if (!airDate) return 'Bientôt';

  const diffDays = getCalendarDaysDiff(airDate);
  if (diffDays < 0) return null;
  if (diffDays === 0) return "Aujourd'hui";
  if (diffDays === 1) return 'Demain';
  if (diffDays <= 7) return `Dans ${diffDays} jours`;

  return `Le ${formatAirDateSafe(airDate, 'short')}`;
};

interface ProviderNameInput {
  provider_name?: string | null;
}

export const getCleanProviderName = (provider: ProviderNameInput) => {
  const providerName = provider.provider_name || '';
  const name = providerName.toLowerCase();
  if (name.includes('netflix')) return 'Netflix';
  if (name.includes('prime') || name.includes('amazon')) return 'Prime Video';
  if (name.includes('disney')) return 'Disney+';
  if (name.includes('canal') || name.includes('mycanal')) return 'Canal+';
  if (name.includes('apple tv') || name.includes('apple')) return 'Apple TV+';
  if (name.includes('paramount')) return 'Paramount+';
  if (name.includes('max') || name.includes('hbo')) return 'Max';
  if (name.includes('france') || name.includes('ftv')) return 'France TV';
  if (name.includes('arte')) return 'Arte';
  return providerName
    .replace(/ à la demande/gi, '')
    .replace(/ Plus/gi, '+')
    .replace(/ Channel/gi, '')
    .trim();
};

export const getProviderDirectLink = (providerId: number, title: string, fallbackLink: string) => {
  const query = encodeURIComponent(title);
  switch (providerId) {
    case 8: return `https://www.netflix.com/search?q=${query}`;
    case 119: return `https://www.primevideo.com/search/ref=atv_sr_sug_1?phrase=${query}`;
    case 337: return `https://www.disneyplus.com/search?q=${query}`;
    case 381: return 'https://www.canalplus.com/';
    case 350: return `https://tv.apple.com/fr/search?q=${query}`;
    case 531: return `https://www.paramountplus.com/search/?q=${query}`;
    case 1899: return `https://www.max.com/search?q=${query}`;
    case 234: return `https://www.france.tv/recherche/?q=${query}`;
    case 239: return `https://www.arte.tv/fr/search/?q=${query}`;
    default: return fallbackLink || '#';
  }
};

export type ProviderLinkKind = 'provider-link' | 'provider-app-home';

export interface ProviderLinkPresentation {
  url: string | null;
  label: string;
  title: string;
  kind: ProviderLinkKind;
}

export const getProviderLinkPresentation = ({
  providerId,
  providerName,
  title,
  fallbackLink,
}: {
  providerId: number;
  providerName: string;
  title: string;
  fallbackLink: string;
}): ProviderLinkPresentation => {
  if (providerId === 381) {
    const canalTarget = resolveCanalProviderTarget();
    return {
      url: canalTarget.url,
      label: 'Canal',
      title: 'Ouvrir Canal',
      kind: canalTarget.kind,
    };
  }

  return {
    url: getProviderDirectLink(providerId, title, fallbackLink),
    label: providerName,
    title: `Ouvrir ${providerName}`,
    kind: 'provider-link',
  };
};

interface KeywordDetails {
  keywords?: {
    results?: Array<{ name?: string | null }>;
    keywords?: Array<{ name?: string | null }>;
  };
}

export const getKeywordsFromDetails = (details: KeywordDetails | null | undefined, mediaType: 'tv' | 'movie'): string[] => {
  const raw = mediaType === 'tv' ? details?.keywords?.results : details?.keywords?.keywords;
  const blacklist = [
    'aftercreditsstinger', 'duringcreditsstinger', 'post-credits scene',
    'mid-credits scene', '3d', 'imax', 'marvel cinematic universe',
    'dc extended universe', 'cinematic universe', 'anime',
  ];
  return (Array.isArray(raw) ? raw : [])
    .map(keyword => String(keyword?.name || ''))
    .filter((keyword: string) => keyword.length > 0 && keyword.length < 25)
    .filter((keyword: string) => !blacklist.some(blocked => keyword.toLowerCase().includes(blocked)))
    .slice(0, 5);
};

export const getSmartDefaultSeason = (show: any, tmdbDetails: any): number => {
  if (show?.nextEpisodeToWatch?.season_number) return show.nextEpisodeToWatch.season_number;
  if (show?.nextEpisodeToAir?.season_number) return show.nextEpisodeToAir.season_number;
  if (show?.seenEpisodes && show.seenEpisodes.length > 0) {
    const watchedSeasons = show.seenEpisodes
      .map((epKey: string) => parseInt(epKey.split('x')[0], 10))
      .filter((s: number) => !isNaN(s) && s > 0);
    if (watchedSeasons.length > 0) return Math.max(...watchedSeasons);
  }
  const validSeasons = tmdbDetails?.seasons?.filter((s: { season_number?: number }) => Number(s.season_number) > 0) || [];
  return validSeasons.length > 0 ? validSeasons[0].season_number : 1;
};
