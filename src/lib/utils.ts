import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Browser } from '@capacitor/browser';
import { AppLauncher } from '@capacitor/app-launcher';
import { Capacitor } from '@capacitor/core';
import { appLogger } from '../store/logStore';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function buildPlexSlug(title?: string, year?: number | string): string {
  if (!title) return '';
  const clean = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return year ? `${clean}-${year}` : clean;
}

export function buildPlexWatchUrl(title?: string, year?: number | string, mediaType?: string): string {
  if (!title) return 'https://watch.plex.tv';
  const typeSlug = (mediaType === 'show' || mediaType === 'tv' || mediaType === 'series') ? 'show' : 'movie';
  const slug = buildPlexSlug(title, year);
  return `https://watch.plex.tv/${typeSlug}/${slug}`;
}

/**
 * Opens external URLs safely on both Web and Native Android/iOS Capacitor apps.
 * For deep-link schemes like plex://, it attempts to launch the native app via AppLauncher.
 * If the app is not installed, it gracefully falls back to Chrome Custom Tabs/Safari View Controller.
 */
export async function openExternalUrl(url: string) {
  if (!url) return;
  
  appLogger.info('plex', `[openExternalUrl] Ouverture demandée pour : ${url}`, {
    isNative: Capacitor.isNativePlatform(),
    platform: Capacitor.getPlatform()
  });

  if (Capacitor.isNativePlatform()) {
    // 1. Gestion Plex : extraction du serveur, du slug et de la clé de média pour deep linking natif
    if ((url.includes('plex.tv') || url.startsWith('plex://')) && !url.includes('/auth')) {
      const candidatePlexUrls: string[] = [];

      // Si l'URL est un lien universel watch.plex.tv (ex: https://watch.plex.tv/movie/dune-2020)
      if (url.includes('watch.plex.tv/')) {
        const watchPath = url.replace(/^https?:\/\/(www\.)?watch\.plex\.tv\//i, '');
        candidatePlexUrls.push(`intent://${watchPath}#Intent;package=com.plexapp.android;scheme=https;host=watch.plex.tv;action=android.intent.action.VIEW;end`);
        candidatePlexUrls.push(url);
        candidatePlexUrls.push(`plex://${watchPath}`);
      }

      const serverMatch = url.match(/\/server\/([a-zA-Z0-9_-]+)/i) || url.match(/server=([a-zA-Z0-9_-]+)/i);
      const serverId = serverMatch ? serverMatch[1] : '';

      const keyMatch = url.match(/[?&]key=([^&#]+)/i);
      let ratingKey = '';
      if (keyMatch) {
        const decodedKey = decodeURIComponent(keyMatch[1]);
        const ratingKeyMatch = decodedKey.match(/\/metadata\/(\d+)/i) || decodedKey.match(/^(\d+)$/);
        if (ratingKeyMatch) {
          ratingKey = ratingKeyMatch[1];
        }
      }

      if (serverId && ratingKey) {
        // Formats Android Intent explicites ciblant l'application native com.plexapp.android
        candidatePlexUrls.push(`intent://server/${serverId}/details?key=${encodeURIComponent(`/library/metadata/${ratingKey}`)}#Intent;package=com.plexapp.android;scheme=plex;end`);
        candidatePlexUrls.push(`intent://preplay/?metadataKey=${encodeURIComponent(`/library/metadata/${ratingKey}`)}&server=${serverId}#Intent;package=com.plexapp.android;scheme=plex;end`);
        candidatePlexUrls.push(`intent://app.plex.tv/desktop/#!/server/${serverId}/details?key=${encodeURIComponent(`/library/metadata/${ratingKey}`)}#Intent;package=com.plexapp.android;scheme=https;end`);
        
        // Schemes personnalisés standard Plex
        candidatePlexUrls.push(`plex://server/${serverId}/details?key=${encodeURIComponent(`/library/metadata/${ratingKey}`)}`);
        candidatePlexUrls.push(`plex://preplay/?metadataKey=${encodeURIComponent(`/library/metadata/${ratingKey}`)}&server=${serverId}`);
      }
      
      // Fallbacks pour ouvrir l'application Android Plex directement (Intent de lancement de package)
      candidatePlexUrls.push(`intent://launch#Intent;package=com.plexapp.android;end`);
      candidatePlexUrls.push(`plex://`);

      appLogger.info('plex', `[Plex DeepLink] Candidate URLs générées (${candidatePlexUrls.length})`, {
        originalUrl: url,
        serverId,
        ratingKey,
        candidates: candidatePlexUrls
      });

      for (const pUrl of candidatePlexUrls) {
        try {
          appLogger.info('plex', `[Plex DeepLink] Essai AppLauncher.openUrl : ${pUrl}`);
          const res = await AppLauncher.openUrl({ url: pUrl });
          if (res && res.completed) {
            appLogger.success('plex', `[Plex DeepLink] ✅ AppLauncher réussi avec URL : ${pUrl}`);
            return;
          } else {
            appLogger.warn('plex', `[Plex DeepLink] ⚠️ AppLauncher non complété (completed=false) pour : ${pUrl}`, res);
          }
        } catch (err: any) {
          appLogger.warn('plex', `[Plex DeepLink] ❌ Échec AppLauncher pour : ${pUrl}`, err?.message || String(err));
        }
      }

      // Si aucune tentative native n'a fonctionné (ex: l'application Plex n'est pas installée)
      const cleanWebPlexUrl = url.includes('watch.plex.tv') ? url : ((serverId && ratingKey)
        ? `https://app.plex.tv/desktop/#!/server/${serverId}/details?key=${encodeURIComponent(`/library/metadata/${ratingKey}`)}`
        : url.replace(/watch\.plex\.tv/g, 'app.plex.tv'));

      try {
        appLogger.info('plex', `[Plex DeepLink] Fallback Browser.open avec : ${cleanWebPlexUrl}`);
        await Browser.open({ url: cleanWebPlexUrl, windowName: '_system' });
        return;
      } catch (e: any) {
        appLogger.error('plex', `[Plex DeepLink] Erreur Browser.open : ${e?.message || String(e)}`);
      }
    }

    // 2. Gestion Reddit : ouverture via l'application native Reddit (Intent Android)
    if (url.includes('reddit.com') || url.startsWith('reddit://')) {
      const redditSchemeUrl = url.startsWith('reddit://')
        ? url
        : url.replace(/^https?:\/\/(www\.)?reddit\.com\//i, 'reddit://');

      const candidateRedditUrls = [
        `intent://${url.replace(/^https?:\/\//i, '')}#Intent;package=com.reddit.frontpage;scheme=https;end`,
        redditSchemeUrl,
        url
      ];
      for (const rUrl of candidateRedditUrls) {
        try {
          const res = await AppLauncher.openUrl({ url: rUrl });
          if (res && res.completed) {
            return;
          }
        } catch (err) {
          console.warn('AppLauncher openUrl failed for Reddit URL:', rUrl, err);
        }
      }

      try {
        await Browser.open({ url, windowName: '_system' });
        return;
      } catch (e) {
        console.warn('Browser.open failed for Reddit URL', e);
      }
    }

    // 3. Autres liens externes : essai préalable AppLauncher pour déclencher les applications natives
    try {
      const res = await AppLauncher.openUrl({ url });
      if (res && res.completed) {
        return;
      }
    } catch (err) {
      // Fallback Chrome Custom Tabs si pas d'application associée
    }

    try {
      await Browser.open({ url, windowName: '_system' });
      return;
    } catch (e) {
      console.warn('Browser.open failed, falling back to window.open', e);
    }
  }

  // Sur le Web, remplacer watch.plex.tv par le domaine officiel de l'application Web Plex app.plex.tv
  const cleanUrl = url.includes('plex.tv') ? url.replace(/watch\.plex\.tv/g, 'app.plex.tv') : url;
  window.open(cleanUrl, '_blank', 'noopener,noreferrer');
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
    // 1. Si la progression de diffusion est à 100%
    const progress = getAiredProgress(show);
    if (progress >= 100) return true;

    // 2. Si pas de prochain épisode à regarder
    if (!show.nextEpisodeToWatch) return true;

    // 3. Si le prochain épisode a une date de diffusion future
    if (show.nextEpisodeToWatch.air_date) {
      const airMs = new Date(show.nextEpisodeToWatch.air_date).getTime();
      if (!isNaN(airMs) && airMs > Date.now()) {
        return true;
      }
    }

    // 4. Si le nombre d'épisodes vus atteint le total d'épisodes diffusés
    if (typeof show.totalAiredEpisodes === 'number' && show.totalAiredEpisodes > 0 && watchedCount >= show.totalAiredEpisodes) {
      return true;
    }

    // 5. Si le nombre d'épisodes vus atteint le total d'épisodes de la série
    if (typeof show.totalEpisodes === 'number' && show.totalEpisodes > 0 && watchedCount >= show.totalEpisodes) {
      return true;
    }

    // 6. Si dans le cache des saisons, tous les épisodes diffusés ont été vus
    if (show.seasonsCache && Array.isArray(show.seasonsCache) && show.seasonsCache.length > 0) {
      const todayStr = getTodayStr();
      const seenSet = new Set(show.seenEpisodes || []);
      const episodes = show.seasonsCache
        .filter((s: any) => s.season_number > 0)
        .flatMap((s: any) => s.episodes || []);
      
      if (episodes.length > 0) {
        const airedUnseen = episodes.filter((ep: any) => (!ep.air_date || ep.air_date <= todayStr) && !seenSet.has(`${ep.season_number}x${ep.episode_number}`));
        if (airedUnseen.length === 0) {
          return true;
        }
      }
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

/**
 * Calcule la différence de jours calendaires stricts entre deux dates au format YYYY-MM-DD
 * en utilisant Date.UTC pour éliminer TOUT décalage lié au fuseau horaire ou à l'heure d'été.
 * > 0 : date future (ex: +1 = demain)
 * === 0 : aujourd'hui
 * < 0 : date passée (ex: -1 = hier)
 */
export function getCalendarDaysDiff(targetDateStr?: string | null, fromDateStr: string = getTodayStr()): number {
  if (!targetDateStr) return 0;
  const tParts = targetDateStr.split('-').map(Number);
  const fParts = fromDateStr.split('-').map(Number);
  if (tParts.length < 3 || fParts.length < 3) return 0;
  const [tY, tM, tD] = tParts;
  const [fY, fM, fD] = fParts;
  if (!tY || !tM || !tD || !fY || !fM || !fD) return 0;

  const utcTarget = Date.UTC(tY, tM - 1, tD);
  const utcFrom = Date.UTC(fY, fM - 1, fD);

  return Math.round((utcTarget - utcFrom) / (24 * 60 * 60 * 1000));
}

/**
 * Retourne le libellé textuel relatif français pour une date de diffusion (ex: "Demain", "Aujourd'hui", "Dans 3 jours")
 */
export function getEpisodeRelativeAirDate(airDateStr?: string | null): string {
  if (!airDateStr) return 'Bientôt';
  const diffDays = getCalendarDaysDiff(airDateStr);
  if (diffDays === 0) return "Aujourd'hui";
  if (diffDays === 1) return 'Demain';
  if (diffDays === -1) return 'Hier';
  if (diffDays > 1 && diffDays <= 7) return `Dans ${diffDays} jours`;
  if (diffDays > 7) return `le ${formatAirDateSafe(airDateStr, 'short')}`;
  return `il y a ${Math.abs(diffDays)} jours`;
}

/**
 * Formate proprement une date YYYY-MM-DD en français sans risque de décalage de fuseau horaire.
 */
export function formatAirDateSafe(dateStr?: string | null, format: 'full' | 'short' | 'long' | 'relative' = 'full'): string {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length < 3) return dateStr;
  const [year, month, day] = parts.map(Number);
  if (!year || !month || !day) return dateStr;

  const dateObj = new Date(year, month - 1, day);

  if (format === 'short') {
    return dateObj.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  }
  if (format === 'long') {
    return dateObj.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    }).toUpperCase();
  }
  if (format === 'relative') {
    return getEpisodeRelativeAirDate(dateStr);
  }
  return dateObj.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
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

const OFFSET_NETWORKS = [
  2552, // Apple TV+
  49,   // HBO
  174,  // AMC
  17,   // FX
  453,  // Hulu
  1024, // Amazon
  67,   // Showtime
  318,  // Starz
  71,   // The CW
  3353, // Peacock
  4330, // Paramount+
];

export function requiresDateOffset(networks?: any[]): boolean {
  if (!networks || !Array.isArray(networks)) return false;
  return networks.some(n => OFFSET_NETWORKS.includes(n.id));
}

export function addOneDayToDateStr(dateStr?: string | null): string | null | undefined {
  if (!dateStr) return dateStr;
  const parts = dateStr.split('-');
  if (parts.length < 3) return dateStr;
  const [y, m, d] = parts.map(Number);
  if (!y || !m || !d) return dateStr;
  
  const dateObj = new Date(Date.UTC(y, m - 1, d + 1));
  return dateObj.toISOString().split('T')[0];
}

export function adjustTMDBShowDataForEurope(showDetails: any) {
  if (!showDetails || !requiresDateOffset(showDetails.networks)) return;

  if (showDetails.first_air_date) showDetails.first_air_date = addOneDayToDateStr(showDetails.first_air_date);
  if (showDetails.last_air_date) showDetails.last_air_date = addOneDayToDateStr(showDetails.last_air_date);
  if (showDetails.next_episode_to_air?.air_date) showDetails.next_episode_to_air.air_date = addOneDayToDateStr(showDetails.next_episode_to_air.air_date);
  if (showDetails.last_episode_to_air?.air_date) showDetails.last_episode_to_air.air_date = addOneDayToDateStr(showDetails.last_episode_to_air.air_date);
  
  if (showDetails.seasons && Array.isArray(showDetails.seasons)) {
    showDetails.seasons.forEach((s: any) => {
      if (s.air_date) s.air_date = addOneDayToDateStr(s.air_date);
    });
  }
}

export function adjustTMDBSeasonDataForEurope(seasonDetails: any, networks?: any[]) {
  if (!seasonDetails || !requiresDateOffset(networks)) return;

  if (seasonDetails.air_date) seasonDetails.air_date = addOneDayToDateStr(seasonDetails.air_date);
  
  if (seasonDetails.episodes && Array.isArray(seasonDetails.episodes)) {
    seasonDetails.episodes.forEach((ep: any) => {
      if (ep.air_date) ep.air_date = addOneDayToDateStr(ep.air_date);
    });
  }
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



