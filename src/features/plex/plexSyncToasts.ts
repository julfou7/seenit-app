import { useToastStore } from '../../store/toastStore';
import type { Show } from '../../types';

/**
 * SEENIT-PLEX-012 — Après une synchro, au plus trois toasts par titre ; au-delà, un seul toast de bilan
 * (une synchro complète de 2 000 titres produisait des heures de toasts en file).
 */
export const PLEX_ITEM_TOAST_LIMIT = 3;

export interface PlexSyncedToastItem { title: string; subtitle?: string; isWatchlist?: boolean; isWatchlistRemoval?: boolean; posterPath?: string | null; show: Show }

export function summarizePlexSyncedItems(items: readonly PlexSyncedToastItem[]): string {
  const removed = items.filter(item => item.isWatchlistRemoval).length;
  const added = items.filter(item => item.isWatchlist && !item.isWatchlistRemoval).length;
  const watched = items.length - removed - added;
  return [watched ? `${watched} vu${watched > 1 ? 's' : ''}` : '', added ? `${added} ajouté${added > 1 ? 's' : ''} à voir` : '', removed ? `${removed} retiré${removed > 1 ? 's' : ''} du suivi` : ''].filter(Boolean).join(' · ');
}

export function announcePlexSyncedItems(items: readonly PlexSyncedToastItem[]): void {
  const { showToast } = useToastStore.getState();
  if (items.length > PLEX_ITEM_TOAST_LIMIT) {
    showToast({ title: 'Plex', subtitle: summarizePlexSyncedItems(items), action: 'Synchronisation Plex • Bilan' }, 'success', undefined, undefined, 6000);
    return;
  }
  for (const item of items) {
    const action = item.isWatchlistRemoval ? 'Watchlist Plex • Retiré du suivi' : item.isWatchlist ? 'Watchlist Plex • Ajouté à voir' : 'Vu sur Plex • Synchronisé';
    showToast({ title: item.title, subtitle: item.subtitle, action, posterPath: item.posterPath }, 'success', item.show, undefined, 5000);
  }
}
