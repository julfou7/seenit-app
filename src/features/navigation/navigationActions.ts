import { closeTabSubview, closeTopDialog } from './dialogStack';
import { withNavigationResetToastContext, type RootNavigationTab } from './tabPresentation';
export function scrollNavigationRoot(tab: RootNavigationTab) {
  const root = document.querySelector<HTMLElement>(`[data-app-tab="${tab}"]`);
  root?.querySelector<HTMLElement>('.overflow-y-auto')?.scrollTo({ top: 0, behavior: 'smooth' });
}
export function activateCurrentNavigationTab(tab: RootNavigationTab) {
  if (closeTopDialog() || closeTabSubview(tab)) return;
  scrollNavigationRoot(tab);
}
export function resetCurrentNavigationTab(tab: RootNavigationTab) {
  withNavigationResetToastContext(tab, () => {
    window.dispatchEvent(new CustomEvent(`${tab}-reset-all`));
  });
}
