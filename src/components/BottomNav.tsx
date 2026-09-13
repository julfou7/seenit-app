import React, { lazy, Suspense, useRef } from 'react';
import { SeenItGlyph, type SeenItSymbolType } from './SeenItLogo';
import { cn } from '../lib/utils';
import { useDownloadConfigStore } from '../store/downloadConfigStore';
import { isDownloadFeatureEnabled } from '../features/downloads/downloadFeatureVisibility';
import { resolveActiveTabTap, type ActiveTabTapState } from '../features/navigation/activeTabTap';

const DownloadNavBadge = lazy(() => import('./DownloadNavBadge').then(module => ({ default: module.DownloadNavBadge })));

interface Props {
  currentTab: string;
  onTabChange: (tab: 'watchlist' | 'library' | 'discover' | 'downloads' | 'profile') => void;
  onActiveTabClick?: () => void;
  onActiveTabDoubleClick?: () => void;
}

interface TabItem {
  id: 'watchlist' | 'discover' | 'downloads' | 'profile';
  label: string;
  symbol: SeenItSymbolType;
}

export function BottomNav({ currentTab, onTabChange, onActiveTabClick, onActiveTabDoubleClick }: Props) {
  const lastActiveTapRef = useRef<ActiveTabTapState | null>(null);
  const downloadsEnabled = useDownloadConfigStore(isDownloadFeatureEnabled);

  const tabs: readonly TabItem[] = [
    { id: 'watchlist', label: 'À Voir', symbol: 'watch' },
    { id: 'discover', label: 'Explorer', symbol: 'discover' },
    { id: 'downloads', label: 'Télécharger', symbol: 'download' },
    { id: 'profile', label: 'Profil', symbol: 'profile' },
  ] as const;

  const visibleTabs = downloadsEnabled ? tabs : tabs.filter(tab => tab.id !== 'downloads');

  const handleTabClick = (e: React.MouseEvent, tabId: string) => {
    e.preventDefault();

    const resolution = resolveActiveTabTap(
      currentTab,
      tabId,
      lastActiveTapRef.current,
      Date.now(),
    );
    lastActiveTapRef.current = resolution.nextTap;

    if (resolution.action === 'change-tab') {
      onTabChange(tabId as any);
      return;
    }

    if (resolution.action === 'active-double') {
      if (tabId === 'downloads') {
        window.dispatchEvent(new CustomEvent('downloads-scroll-top'));
        return;
      }
      onActiveTabDoubleClick?.();
      return;
    }

    onActiveTabClick?.();
  };

  return (
    <div className="absolute bottom-0 inset-x-0 bg-zinc-950/95 backdrop-blur-2xl border-t border-white/10 pt-1.5 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] px-2 sm:px-4 flex items-center gap-1 z-[160]">
      {visibleTabs.map((tab) => {
        const isActive = currentTab === tab.id;
        const isDownloadTab = tab.id === 'downloads';

        return (
          <button
            key={tab.id}
            type="button"
            aria-current={isActive ? 'page' : undefined}
            onClick={(e) => handleTabClick(e, tab.id)}
            className={cn(
              "flex flex-col items-center justify-center gap-0.5 transition-all duration-200 py-1 px-1 min-h-[52px] min-w-[44px] flex-1 rounded-xl touch-manipulation active:scale-95 cursor-pointer relative",
              isActive ? "text-[#E5A93D]" : "text-zinc-500 hover:text-zinc-400"
            )}
          >
            <div className={cn("p-1 rounded-xl transition-all flex items-center justify-center relative", isActive ? "bg-[#E5A93D]/12" : "bg-transparent")}>
              <SeenItGlyph
                size={28}
                symbol={tab.symbol}
                active={isActive}
                glow={isActive}
                idPrefix={`bnav-${tab.id}`}
                color="gold"
              />
              {isDownloadTab && downloadsEnabled && (
                <Suspense fallback={null}>
                  <DownloadNavBadge />
                </Suspense>
              )}
            </div>
            <span className={cn(
              "text-[10px] sm:text-[11px] font-bold tracking-tight truncate max-w-full text-center block", 
              isActive ? "text-[#E5A93D]" : "text-zinc-500"
            )}>
              {tab.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
