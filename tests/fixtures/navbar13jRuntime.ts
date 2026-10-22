import { create } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { useSyncExternalStore } from 'react';
import type { NavigationDownload } from '../../src/features/navigation/downloadNavState';
export const telemetry = { liveSubscriptions: 0, mutations: 0, resets: [] as string[], shortcuts: [] as string[], vibrations: [] as number[] };
export const useDownloadConfigStore = create(() => ({
  scopeUid: 'nav-a', isHydrated: true, downloadsEnabled: true, isSaving: false, saveError: null,
  setConfig: (patch: Record<string, unknown>) => useDownloadConfigStore.setState(patch),
  saveConfig: async (patch: Record<string, unknown>) => { useDownloadConfigStore.setState(patch); return true; },
}));
const live = createStore(() => ({ downloads: [] as NavigationDownload[], error: null as string | null }));
const subscribe = (listener: () => void) => { telemetry.liveSubscriptions++; const remove = live.subscribe(listener); return () => { telemetry.liveSubscriptions--; remove(); }; };
export function useLiveDownloadStore<T>(select: (state: ReturnType<typeof live.getState>) => T): T {
  return select(useSyncExternalStore(subscribe, live.getState, live.getState));
}
export const useShows = () => ({ updateShow: async () => { telemetry.mutations++; } });
export const useShowsStore = { getState: () => ({ shows: [] }) };
export const useLogStore = { getState: () => ({ addLog() {} }) };
export const appLogger = { info() {}, warn() {}, error() {}, debug() {} };
export const api = {
  telemetry,
  downloads: (downloads: NavigationDownload[], error: string | null = null) => live.setState({ downloads, error }),
  enabled: (downloadsEnabled: boolean) => useDownloadConfigStore.setState({ downloadsEnabled }),
  account: (scopeUid: string) => useDownloadConfigStore.setState({ scopeUid }),
};
