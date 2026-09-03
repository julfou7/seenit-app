import { create } from 'zustand';
import { Show } from '../types';
import {
  buildPlexCompletionMessage,
  filterQueuedToastsByScope,
  type ToastQueueScope
} from './toastQueuePolicy';

export type ToastType = 'archive' | 'unfollow' | 'dropped' | 'success' | 'info' | 'follow' | 'error' | 'reminder' | 'favorite' | 'download';
export type ToastScope = ToastQueueScope;

export interface ToastMessageObj {
  title?: string;
  subtitle?: string;
  action: string;
  posterPath?: string | null;
}

export interface ToastItem {
  id: string;
  message: string | ToastMessageObj;
  type: ToastType;
  show?: Show;
  onUndo?: (() => void | Promise<void>) | null;
  duration?: number;
  scope?: ToastScope;
  retainOnScopeClear?: boolean;
}

interface ToastState {
  currentToast: ToastItem | null;
  queue: ToastItem[];
  message: string | ToastMessageObj;
  type: ToastType;
  show?: Show;
  onUndo?: (() => void | Promise<void>) | null;
  visible: boolean;
  showToast: (
    message: string | ToastMessageObj,
    type?: ToastType,
    show?: any,
    onUndo?: (() => void | Promise<void>) | null,
    duration?: number,
    scope?: ToastScope
  ) => void;
  hideToast: () => void;
  processNext: () => void;
  clearQueue: () => void;
  clearQueuedScope: (scope: ToastScope) => void;
}

let dequeueTimer: any = null;
let plexBatchStats = { watched: 0, unwatched: 0 };

function getToastSearchText(message: string | ToastMessageObj): string {
  if (typeof message === 'string') return message;
  return [message.title, message.subtitle, message.action].filter(Boolean).join(' • ');
}

function isPlexToastMessage(message: string | ToastMessageObj): boolean {
  return /plex/i.test(getToastSearchText(message));
}

function isPlexCompletionMessage(message: string | ToastMessageObj): boolean {
  return typeof message === 'string' && /^Synchronisation Plex terminée\b/i.test(message.trim());
}

function enrichPlexCompletionMessage(message: string): string {
  return buildPlexCompletionMessage(message, plexBatchStats.watched, plexBatchStats.unwatched);
}

export const useToastStore = create<ToastState>((set, get) => ({
  currentToast: null,
  queue: [],
  message: '',
  type: 'info',
  visible: false,
  onUndo: null,

  showToast: (message, type = 'info', show, onUndo, duration = 5000, scope) => {
    let finalShow: Show | undefined = undefined;
    let finalUndo: (() => void | Promise<void>) | null = null;
    const finalDuration = typeof duration === 'number' ? duration : 5000;

    if (typeof show === 'function') {
      finalUndo = show as any;
    } else if (typeof show === 'string') {
      if (typeof onUndo === 'function') {
        finalUndo = onUndo;
      }
    } else if (show && typeof show === 'object' && ('id' in show || 'tmdbId' in show || 'title' in show)) {
      finalShow = show as Show;
      if (typeof onUndo === 'function') {
        finalUndo = onUndo;
      }
    } else if (typeof onUndo === 'function') {
      finalUndo = onUndo;
    }

    const inferredScope: ToastScope | undefined = scope || (isPlexToastMessage(message) ? 'plex' : undefined);
    const searchText = getToastSearchText(message);
    const isCompletion = inferredScope === 'plex' && isPlexCompletionMessage(message);
    let finalMessage = message;

    if (inferredScope === 'plex' && !isCompletion) {
      if (/dé-vu\s+sur\s+plex/i.test(searchText)) {
        plexBatchStats.unwatched += 1;
      } else if (/\bvu\s+sur\s+plex\b/i.test(searchText) && !/watchlist/i.test(searchText)) {
        plexBatchStats.watched += 1;
      }
    }

    if (isCompletion && typeof message === 'string') {
      finalMessage = enrichPlexCompletionMessage(message);
      plexBatchStats = { watched: 0, unwatched: 0 };
    } else if (
      inferredScope === 'plex' &&
      /Plex sera retenté|Erreur de synchronisation Plex|Synchronisation Plex incomplète/i.test(searchText)
    ) {
      plexBatchStats = { watched: 0, unwatched: 0 };
    }

    const newItem: ToastItem = {
      id: Math.random().toString(36).substring(2, 9) + Date.now().toString(36),
      message: finalMessage,
      type,
      show: finalShow,
      onUndo: finalUndo,
      duration: finalDuration,
      scope: inferredScope,
      retainOnScopeClear: isCompletion
    };

    const state = get();

    if (!state.visible && !state.currentToast) {
      if (dequeueTimer) clearTimeout(dequeueTimer);
      set({
        currentToast: newItem,
        message: newItem.message,
        type: newItem.type,
        show: newItem.show,
        onUndo: newItem.onUndo,
        visible: true
      });
    } else {
      set((prev) => ({
        queue: [...prev.queue, newItem]
      }));
    }
  },

  hideToast: () => {
    if (dequeueTimer) clearTimeout(dequeueTimer);
    set({ visible: false });
    dequeueTimer = setTimeout(() => {
      get().processNext();
    }, 320);
  },

  processNext: () => {
    const { queue } = get();
    if (queue.length > 0) {
      const nextToast = queue[0];
      const remainingQueue = queue.slice(1);

      set({
        currentToast: nextToast,
        queue: remainingQueue,
        message: nextToast.message,
        type: nextToast.type,
        show: nextToast.show,
        onUndo: nextToast.onUndo,
        visible: true
      });
    } else {
      set({
        currentToast: null,
        visible: false,
        onUndo: null,
        message: ''
      });
    }
  },

  clearQueue: () => {
    if (dequeueTimer) clearTimeout(dequeueTimer);
    plexBatchStats = { watched: 0, unwatched: 0 };
    set({ queue: [], visible: false, currentToast: null, onUndo: null });
  },

  clearQueuedScope: (scope) => {
    set((state) => ({
      queue: filterQueuedToastsByScope(state.queue, scope)
    }));
  }
}));
