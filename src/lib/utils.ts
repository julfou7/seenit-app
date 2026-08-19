import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Opens external URLs safely on both Web and Native Android/iOS Capacitor apps using Chrome Custom Tabs
 */
export async function openExternalUrl(url: string) {
  if (!url) return;
  if (Capacitor.isNativePlatform()) {
    try {
      await Browser.open({ url, windowName: '_system' });
      return;
    } catch (e) {
      console.warn('Browser.open failed, falling back to window.open', e);
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Throttle helper to avoid spamming UI thread
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean;
  return function (this: any, ...args: Parameters<T>) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

export function checkIsUpToDate(show: any): boolean {
  if (!show || show.status === 'dropped') return false;
  if (show.isArchived) return true;
  if (show.mediaType === 'movie') {
    return show.status === 'completed' || show.seenEpisodes?.includes('movie');
  }
  if (show.status === 'up_to_date' || show.status === 'completed') return true;
  
  const watchedCount = show.seenEpisodes ? show.seenEpisodes.length : 0;
  if (watchedCount > 0) {
    if (!show.nextEpisodeToWatch) return true;
    if (show.nextEpisodeToWatch.air_date) {
      const airMs = new Date(show.nextEpisodeToWatch.air_date).getTime();
      if (!isNaN(airMs) && airMs > Date.now()) {
        return true;
      }
    }
    if (show.totalEpisodes && show.totalEpisodes > 0 && watchedCount >= show.totalEpisodes) {
      return true;
    }
  }
  return false;
}

export function getNextEpisodeNumber(seasons: any[], seenEpisodes: string[]) {
  if (!seasons || seasons.length === 0) return null;
  for (const s of seasons) {
    if (s.season_number === 0) continue; // Skip specials
    for (const ep of s.episodes) {
      const epKey = `${s.season_number}x${ep.episode_number}`;
      if (!seenEpisodes.includes(epKey)) {
        return { season: s.season_number, episode: ep.episode_number, episodeData: ep };
      }
    }
  }
  return null;
}

export function getTodayStr(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getAiredProgress(show: any) {
  if (!show) return 0;

  const seenEpisodesCount = show.seenEpisodes?.length || 0;
  if (seenEpisodesCount === 0) {
    return 0;
  }

  if (show.status === 'completed' || show.isArchived) {
    return 100;
  }

  // 1. Explicit totalAiredEpisodes
  if (typeof show.totalAiredEpisodes === 'number' && show.totalAiredEpisodes > 0) {
    return Math.min(100, Math.max(0, Math.round((seenEpisodesCount / show.totalAiredEpisodes) * 100)));
  }

  // 2. Seasons cache aired episodes
  if (show.seasonsCache && show.seasonsCache.length > 0) {
    const episodes = show.seasonsCache
      .filter((s: any) => s.season_number > 0)
      .flatMap((s: any) => s.episodes || []);
    
    if (episodes.length > 0) {
      const todayStr = getTodayStr();
      const airedEpisodes = episodes.filter((ep: any) => ep.air_date && ep.air_date <= todayStr);
      const totalAiredCount = airedEpisodes.length;
      
      if (totalAiredCount > 0) {
        return Math.min(100, Math.max(0, Math.round((seenEpisodesCount / totalAiredCount) * 100)));
      }
    }
  }

  // 3. Total episodes
  if (typeof show.totalEpisodes === 'number' && show.totalEpisodes > 0) {
    return Math.min(100, Math.max(0, Math.round((seenEpisodesCount / show.totalEpisodes) * 100)));
  }

  // 4. Fallback when total count is unknown: return 0 so progress bar starts empty and completes smoothly once data is loaded
  return 0;
}

export function computeAutoArchiveStatus(show: {
  mediaType?: string;
  status?: string;
  tmdbStatus?: string;
  seriesEnded?: boolean;
  nextEpisodeToWatch?: any;
  nextEpisodeToAir?: any;
  seenEpisodes?: string[];
  totalAiredEpisodes?: number;
  totalEpisodes?: number;
  isArchived?: boolean;
}): boolean {
  if (show.mediaType !== 'tv') return Boolean(show.isArchived);

  const seenCount = show.seenEpisodes?.length || 0;
  const totalCount = show.totalAiredEpisodes || show.totalEpisodes || 0;

  // 1. Est considérée comme entièrement vue si aucun épisode suivant OU nombre vus >= total d'épisodes
  const isFinishedByCount = totalCount > 0 && seenCount >= totalCount;
  const isFinishedWatching = !show.nextEpisodeToWatch || isFinishedByCount;

  // 2. Est officiellement terminée ou annulée par la chaîne/TMDB
  const isEnded = Boolean(
    show.seriesEnded ||
    show.status === 'Ended' ||
    show.status === 'Canceled' ||
    show.tmdbStatus === 'Ended' ||
    show.tmdbStatus === 'Canceled' ||
    show.nextEpisodeToWatch?.series_ended ||
    show.nextEpisodeToAir?.series_ended
  );

  // 3. Aucun épisode futur annoncé
  const hasNoUpcomingAir = !show.nextEpisodeToAir;

  // Auto-archivage si 100% vue + finie/annulée + aucun épisode à venir
  if (isFinishedWatching && isEnded && hasNoUpcomingAir) {
    return true;
  }

  return false;
}

export function formatAirDateSafe(dateStr?: string | null, format: 'short' | 'long' = 'short') {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length < 3) return dateStr;

  const [year, month, day] = parts.map(p => parseInt(p, 10));

  if (format === 'long') {
    // Force UTC pour éviter que la date locale n'enlève des heures et ne recule d'un jour
    const utcDate = new Date(Date.UTC(year, month - 1, day));
    return utcDate.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC'
    }).toUpperCase();
  }

  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
}

export function formatVoteCount(votes: number | string | undefined | null): string {
  if (votes === undefined || votes === null || votes === '') return '';
  let num: number;
  if (typeof votes === 'number') {
    num = votes;
  } else {
    num = parseInt(String(votes).replace(/,/g, '').replace(/\s/g, ''), 10);
  }
  if (isNaN(num) || num <= 0) return '';
  if (num >= 1_000_000) {
    const val = (num / 1_000_000).toFixed(1).replace(/\.0$/, '');
    return `${val}M`;
  }
  if (num >= 1_000) {
    const val = (num / 1_000).toFixed(num >= 10_000 ? 0 : 1).replace(/\.0$/, '');
    return `${val}k`;
  }
  return num.toString();
}

export function sanitizeSearchQuery(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Supprime les accents
    .replace(/['’\-_]/g, " ")       // Remplace apostrophes et tirets par des espaces
    .toLowerCase()
    .trim();
}

export function getBestLogoPath(images: any): string | null {
  if (!images?.logos || !Array.isArray(images.logos) || images.logos.length === 0) {
    return null;
  }
  // Priorité 1 : Logo français
  const frLogo = images.logos.find((l: any) => l.iso_639_1 === 'fr');
  if (frLogo) return frLogo.file_path;

  // Priorité 2 : Logo anglais
  const enLogo = images.logos.find((l: any) => l.iso_639_1 === 'en');
  if (enLogo) return enLogo.file_path;

  // Priorité 3 : Logo sans langue (null / undefined / empty)
  const nullLogo = images.logos.find((l: any) => !l.iso_639_1);
  if (nullLogo) return nullLogo.file_path;

  // Priorité 4 : Premier logo disponible
  return images.logos[0]?.file_path || null;
}

export function scrollAllCarouselsToStart() {
  const scroll = () => {
    const ids = [
      'continue-watching-carousel',
      'nouveautes-carousel',
      'pas-vu-depuis-un-moment-carousel'
    ];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollTo({ left: 0, behavior: 'smooth' });
      }
    });
  };
  scroll();
  setTimeout(scroll, 40);
  setTimeout(scroll, 120);
  setTimeout(scroll, 250);
  setTimeout(scroll, 500);
}



