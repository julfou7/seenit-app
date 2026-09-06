export interface DownloadFeatureVisibilityState {
  downloadsEnabled?: unknown;
  isHydrated?: boolean;
}

/**
 * Fail-closed feature gate for the personal download surfaces.
 * The feature is enabled only after the current UID settings are hydrated
 * and Firestore contains the literal boolean true.
 */
export function isDownloadFeatureEnabled(state: DownloadFeatureVisibilityState): boolean {
  return state.isHydrated === true && state.downloadsEnabled === true;
}

export function resolveDownloadAwareTab<T extends string>(tab: T, downloadsEnabled: boolean): T | 'watchlist' {
  return tab === 'downloads' && !downloadsEnabled ? 'watchlist' : tab;
}
