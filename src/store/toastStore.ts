import { create } from 'zustand';
import { Show } from '../types';

export type ToastType = 'archive' | 'unfollow' | 'dropped' | 'success' | 'info' | 'follow' | 'error';

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
    show?: Show, 
    onUndo?: (() => void | Promise<void>) | null,
    duration?: number
  ) => void;
  hideToast: () => void;
  processNext: () => void;
  clearQueue: () => void;
}

let dequeueTimer: any = null;

export const useToastStore = create<ToastState>((set, get) => ({
  currentToast: null,
  queue: [],
  message: '',
  type: 'info',
  visible: false,
  onUndo: null,

  showToast: (message, type = 'info', show, onUndo, duration = 5000) => {
    const newItem: ToastItem = {
      id: Math.random().toString(36).substring(2, 9) + Date.now().toString(36),
      message,
      type,
      show,
      onUndo: onUndo || null,
      duration
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
      // Add to queue to display sequentially
      set((prev) => ({
        queue: [...prev.queue, newItem]
      }));
    }
  },

  hideToast: () => {
    if (dequeueTimer) clearTimeout(dequeueTimer);

    // Trigger exit animation
    set({ visible: false });

    // Wait for exit animation (300ms) before popping next item
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
    set({ queue: [], visible: false, currentToast: null, onUndo: null });
  }
}));
