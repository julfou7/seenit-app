import type { ToastItem } from '../../store/toastStore';

export interface ToastMediaNavigationTarget {
  showId: string;
  tmdbId: number;
  mediaType: 'tv' | 'movie';
}

const NAVIGABLE_MEDIA_TOAST_TYPES = new Set<ToastItem['type']>(['follow', 'success']);

export function resolveToastMediaNavigationTarget(
  toast: (Pick<ToastItem, 'type' | 'show'> & { message?: ToastItem['message'] }) | null | undefined,
): ToastMediaNavigationTarget | null {
  // Cible déclarée par l'appelant (Téléchargés, Programmés, fiche épisode) : valable pour tout type de toast, sauf
  // le retrait d'« À voir » (`unfollow`) qui reste non navigable (SEENIT-UX-006).
  const media = toast?.message && typeof toast.message === 'object' ? toast.message.media : null;
  if (media) {
    if (toast?.type === 'unfollow') return null;
    const tmdbId = Number(media.tmdbId);
    if (!Number.isInteger(tmdbId) || tmdbId <= 0 || (media.mediaType !== 'tv' && media.mediaType !== 'movie')) return null;
    return { showId: '', tmdbId, mediaType: media.mediaType };
  }
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
