import { resolveRootNavigationTab, type RootNavigationTab } from './tabPresentation.ts';
export interface NavigationShortcutActions {
  changeTab: (tab: RootNavigationTab) => void;
  request: (tab: RootNavigationTab) => void;
  quickAccount: () => void;
}
export function activateNavigationShortcut(currentTab: string, target: RootNavigationTab, actions: NavigationShortcutActions) {
  if (target === 'profile') { actions.quickAccount(); return; }
  if (resolveRootNavigationTab(currentTab) !== target) actions.changeTab(target);
  actions.request(target);
}
