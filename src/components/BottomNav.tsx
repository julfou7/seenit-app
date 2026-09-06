import React, { lazy, Suspense, useRef } from 'react';
import { SeenItGlyph, type SeenItSymbolType } from './SeenItLogo';
import { cn } from '../lib/utils';
import { useDownloadConfigStore } from '../store/downloadConfigStore';
import { isDownloadFeatureEnabled } from '../features/downloads/downloadFeatureVisibility';

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
  const lastTapRef = useRef<number>(0);
  const downloadsEnabled = useDownloadConfigStore(isDownloadFeatureEnabled);

  const tabs: readonly TabItem[] = [
    { id: 'watchlist', label: 'À Voir', symbol: 'watch' },
    { id: 'profile', label: 'Profil', symbol: 'profile' },
    { id: 'discover', label: 'Explorer', symbol: 'discover' },
    { id: 'downloads', label: 'Télécharger', symbol: 'download' },
  ] as const;

  const visibleTabs = downloadsEnabled ? tabs : tabs.filter(tab => tab.id !== 'downloads');

  const handleTabClick = (e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    const now = Date.now();
    const timeSinceLastTap = now - lastTapRef.current;
    
    if (currentTab !== tabId) {
      onTabChange(tabId as any);
      lastTapRef.current = now;
      return;
    }

    if (timeSinceLastTap > 0 && timeSinceLastTap < 450) {
      if (onActiveTabDoubleClick) {
        onActiveTabDoubleClick();
      }
      lastTapRef.current = 0;
    } else {
      if (onActiveTabClick) {
        onActiveTabClick();
      }
      lastTapRef.current = now;
    }
  };

  return (
    <div className="absolute bottom-0 inset-x-0 bg-zinc-950/95 backdrop-blur-2xl border-t border-white/10 pt-1.5 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] px-1 sm:px-4 flex justify-around items-center z-[160]">
      {visibleTabs.map((tab) => {
        const isActive = currentTab === tab.id;
        const isDownloadTab = tab.id === 'downloads';

        return (
          <button
            key={tab.id}
            type="button"
            onClick={(e) => handleTabClick(e, tab.id)}
            className={cn(
              "flex flex-col items-center gap-0.5 transition-all duration-200 py-1 px-0.5 flex-1 max-w-[72px] sm:max-w-[80px] rounded-xl touch-manipulation active:scale-95 cursor-pointer relative",
              isActive ? "text-[#E5A93D]" : "text-zinc-500 hover:text-zinc-400"
            )}
          >
            <div className={cn("p-1 rounded-xl transition-all flex items-center justify-center relative", isActive ? "bg-[#E5A93D]/12" : "bg-transparent")}>
              <SeenItGlyph
                size={22}
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
              "text-[8px] sm:text-[9px] font-bold tracking-tight truncate max-w-full text-center block", 
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
