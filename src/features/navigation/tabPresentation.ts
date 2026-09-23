export type RootNavigationTab = 'watchlist' | 'discover' | 'downloads' | 'profile';
export type NavigationTabSymbol = 'watch' | 'discover' | 'download' | 'profile';

export interface NavigationTabPresentation {
  id: RootNavigationTab;
  label: string;
  symbol: NavigationTabSymbol;
}

export const NAVIGATION_TABS: readonly NavigationTabPresentation[] = [
  { id: 'watchlist', label: 'À Voir', symbol: 'watch' },
  { id: 'discover', label: 'Explorer', symbol: 'discover' },
  { id: 'downloads', label: 'Télécharger', symbol: 'download' },
  { id: 'profile', label: 'Profil', symbol: 'profile' },
] as const;

const NAVIGATION_TAB_BY_ID = new Map<RootNavigationTab, NavigationTabPresentation>(
  NAVIGATION_TABS.map(tab => [tab.id, tab]),
);

let activeNavigationResetTab: RootNavigationTab | null = null;

export function resolveRootNavigationTab(tabId: string): RootNavigationTab | null {
  const normalized = tabId === 'library' || tabId === 'settings' ? 'profile' : tabId;
  return NAVIGATION_TAB_BY_ID.has(normalized as RootNavigationTab)
    ? normalized as RootNavigationTab
    : null;
}

export function getNavigationTabPresentation(
  tabId: RootNavigationTab,
): NavigationTabPresentation {
  return NAVIGATION_TAB_BY_ID.get(tabId)!;
}

export function withNavigationResetToastContext(
  tabId: RootNavigationTab,
  callback: () => void,
): void {
  const previousTab = activeNavigationResetTab;
  activeNavigationResetTab = tabId;
  try {
    callback();
  } finally {
    activeNavigationResetTab = previousTab;
  }
}

export function getActiveNavigationResetPresentation(): NavigationTabPresentation | null {
  return activeNavigationResetTab
    ? getNavigationTabPresentation(activeNavigationResetTab)
    : null;
}
