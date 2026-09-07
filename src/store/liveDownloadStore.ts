export * from './liveDownloadStoreCore';

import { useLiveDownloadStore } from './liveDownloadStoreCore';
import { useDownloadConfigStore } from './downloadConfigStore';
import { isDownloadFeatureEnabled } from '../features/downloads/downloadFeatureVisibility';

const coreFetchDownloads = useLiveDownloadStore.getState().fetchDownloads;
const coreStartPolling = useLiveDownloadStore.getState().startPolling;
const coreStopPolling = useLiveDownloadStore.getState().stopPolling;

async function gatedFetchDownloads(): Promise<void> {
  if (!isDownloadFeatureEnabled(useDownloadConfigStore.getState())) return;
  await coreFetchDownloads();
}

function gatedStartPolling(intervalMs?: number): void {
  if (!isDownloadFeatureEnabled(useDownloadConfigStore.getState())) {
    coreStopPolling();
    return;
  }
  coreStartPolling(intervalMs);
}

function hideDownloadRuntimeState(): void {
  coreStopPolling();
  useLiveDownloadStore.setState({
    downloads: [],
    removedIds: [],
    isLoading: false,
    isPolling: false,
    lastUpdated: null,
    error: null
  });
}

function applyDownloadFeatureGate(): void {
  if (isDownloadFeatureEnabled(useDownloadConfigStore.getState())) {
    coreStartPolling(1000);
    return;
  }
  hideDownloadRuntimeState();
}

useLiveDownloadStore.setState({
  fetchDownloads: gatedFetchDownloads,
  startPolling: gatedStartPolling,
  stopPolling: coreStopPolling
});

applyDownloadFeatureGate();

useDownloadConfigStore.subscribe((state, previousState) => {
  const enabled = isDownloadFeatureEnabled(state);
  const wasEnabled = isDownloadFeatureEnabled(previousState);
  if (enabled !== wasEnabled) applyDownloadFeatureGate();
});

let isClearingHiddenState = false;
useLiveDownloadStore.subscribe(state => {
  if (isClearingHiddenState) return;
  if (isDownloadFeatureEnabled(useDownloadConfigStore.getState())) return;
  if (state.downloads.length === 0 && !state.isPolling && !state.isLoading && state.error === null) return;

  isClearingHiddenState = true;
  hideDownloadRuntimeState();
  isClearingHiddenState = false;
});
