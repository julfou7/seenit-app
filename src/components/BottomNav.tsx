import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { useDownloadConfigStore } from '../store/downloadConfigStore';
import { isDownloadFeatureEnabled } from '../features/downloads/downloadFeatureVisibility';
import { resolveActiveTabTap, type ActiveTabTapState } from '../features/navigation/activeTabTap';
import { NAVIGATION_TABS, resolveRootNavigationTab, type RootNavigationTab } from '../features/navigation/tabPresentation';
import { NavigationTabButton } from './NavigationTabButton';
import './bottomNav.css';
const DownloadNavBadge = lazy(() => import('./DownloadNavBadge').then(module => ({ default: module.DownloadNavBadge })));
interface Props {
  currentTab: string;
  onTabChange: (tab: RootNavigationTab) => void;
  onActiveTabClick?: () => void;
  onActiveTabDoubleClick?: () => void;
  onLongPress: (tab: RootNavigationTab) => void;
}
export function BottomNav({ currentTab, onTabChange, onActiveTabClick, onActiveTabDoubleClick, onLongPress }: Props) {
  const lastActiveTapRef = useRef<ActiveTabTapState | null>(null);
  const downloadsEnabled = useDownloadConfigStore(isDownloadFeatureEnabled);
  const [downloadLabel, setDownloadLabel] = useState('Télécharger');
  const rootTab = resolveRootNavigationTab(currentTab);
  useEffect(() => { lastActiveTapRef.current = null; }, [currentTab, downloadsEnabled]);
  const visibleTabs = downloadsEnabled ? NAVIGATION_TABS : NAVIGATION_TABS.filter(tab => tab.id !== 'downloads');
  const handleTabClick = (event: MouseEvent<HTMLButtonElement>, tabId: RootNavigationTab) => {
    event.preventDefault();
    const resolution = resolveActiveTabTap(rootTab || currentTab, tabId, event.detail === 0 ? null : lastActiveTapRef.current, Date.now());
    lastActiveTapRef.current = event.detail === 0 ? null : resolution.nextTap;
    if (resolution.action === 'change-tab') onTabChange(tabId);
    else if (resolution.action === 'active-double') onActiveTabDoubleClick?.();
    else onActiveTabClick?.();
  };
  return <div className="bottom-nav-shell">
    <div className="bottom-nav-fade" aria-hidden="true" />
    <nav className="bottom-nav-island" aria-label="Navigation principale">
      {visibleTabs.map(tab => <span className="navigation-slot" key={tab.id}>
        {tab.id === 'downloads' && <span className="navigation-separator" aria-hidden="true" />}
        <NavigationTabButton tab={tab} active={rootTab === tab.id}
          label={tab.id === 'downloads' ? downloadLabel : tab.label}
          onActivate={event => handleTabClick(event, tab.id)}
          onCancelGesture={() => { lastActiveTapRef.current = null; }} onLongPress={() => onLongPress(tab.id)}>
          {tab.id === 'downloads' && downloadsEnabled && <Suspense fallback={null}>
            <DownloadNavBadge active={rootTab === 'downloads'} onLabelChange={setDownloadLabel} />
          </Suspense>}
        </NavigationTabButton>
      </span>)}
    </nav>
  </div>;
}
