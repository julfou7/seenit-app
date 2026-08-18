import { create } from 'zustand';

interface SyncState {
  syncStatus: { current: string; total: number; pending: number } | null;
  setSyncStatus: (status: { current: string; total: number; pending: number } | null) => void;
  plexSyncStatus: { message: string } | null;
  setPlexSyncStatus: (status: { message: string } | null) => void;
  isQuotaExceeded: boolean;
  setQuotaExceeded: (exceeded: boolean) => void;
  resetQuotaError: () => void;
}

export const useSyncStore = create<SyncState>((set) => ({
  syncStatus: null,
  setSyncStatus: (syncStatus) => set({ syncStatus }),
  plexSyncStatus: null,
  setPlexSyncStatus: (plexSyncStatus) => set({ plexSyncStatus }),
  isQuotaExceeded: false,
  setQuotaExceeded: (isQuotaExceeded) => set({ isQuotaExceeded }),
  resetQuotaError: () => set({ isQuotaExceeded: false }),
}));
