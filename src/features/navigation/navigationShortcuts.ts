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
export function openNavigationSettings(currentTab: string, actions: Pick<NavigationShortcutActions, 'changeTab' | 'request'>) {
  if (resolveRootNavigationTab(currentTab) !== 'profile') actions.changeTab('profile');
  actions.request('profile');
}
