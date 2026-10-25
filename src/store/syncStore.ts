import { create } from 'zustand';

export interface PlexSyncProgress {
  uid: string; mode: 'delta' | 'full'; phase: 'collect' | 'resolve' | 'watched' | 'watchlist' | 'save' | 'done' | 'error';
  processed: number; total?: number; historyTotal?: number; watchlistTotal?: number;
  changed?: number; alreadyWatched?: number; unresolved?: number; complete?: boolean;
  servers: Array<{ id?: string; name: string; watchedItems?: number; inventoryItems?: number; reason?: string; owned?: boolean }>;
}
export interface PlexSyncStatus { message: string; progress?: PlexSyncProgress }
interface SyncState {
  syncStatus: { current: string; total: number; pending: number } | null;
  setSyncStatus: (status: { current: string; total: number; pending: number } | null) => void;
  plexSyncStatus: PlexSyncStatus | null;
  plexPauseUid: string | null;
  setPlexPauseUid: (uid: string | null) => void;
  setPlexSyncStatus: (status: PlexSyncStatus | null) => void;
  isQuotaExceeded: boolean;
  setQuotaExceeded: (exceeded: boolean) => void;
  resetQuotaError: () => void;
}

export const useSyncStore = create<SyncState>((set) => ({
  syncStatus: null,
  setSyncStatus: (syncStatus) => set({ syncStatus }),
  plexSyncStatus: null,
  plexPauseUid: null,
  setPlexPauseUid: plexPauseUid => set({ plexPauseUid }),
  setPlexSyncStatus: (plexSyncStatus) => set({ plexSyncStatus }),
  isQuotaExceeded: false,
  setQuotaExceeded: (isQuotaExceeded) => set({ isQuotaExceeded }),
  resetQuotaError: () => set({ isQuotaExceeded: false }),
}));
