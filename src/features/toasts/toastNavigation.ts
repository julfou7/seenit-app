import type { ToastItem } from '../../store/toastStore';

export interface ToastMediaNavigationTarget {
  showId: string;
  tmdbId: number;
  mediaType: 'tv' | 'movie';
}

const NAVIGABLE_MEDIA_TOAST_TYPES = new Set<ToastItem['type']>(['follow', 'success']);

export function resolveToastMediaNavigationTarget(
  toast: Pick<ToastItem, 'type' | 'show'> | null | undefined,
): ToastMediaNavigationTarget | null {
  if (!toast?.show || !NAVIGABLE_MEDIA_TOAST_TYPES.has(toast.type)) return null;

  const { show } = toast;
  const tmdbId = Number(show.tmdbId);
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) return null;
  if (show.mediaType !== 'tv' && show.mediaType !== 'movie') return null;

  return {
    showId: String(show.id || ''),
    tmdbId,
    mediaType: show.mediaType,
  };
}

export function dispatchToastMediaNavigation(target: ToastMediaNavigationTarget): void {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(new CustomEvent('capacitor-notification-action', {
    detail: {
      type: 'NAVIGATE_SHOW',
      showId: target.showId || undefined,
      tmdbId: target.tmdbId,
      mediaType: target.mediaType,
    },
  }));
}
