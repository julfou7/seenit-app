import React, { useRef } from 'react';
import { SeenItGlyph, type SeenItSymbolType } from './SeenItLogo';
import { cn } from '../lib/utils';
import { useLiveDownloadStore } from '../store/liveDownloadStore';

interface Props {
  currentTab: string;
  onTabChange: (tab: 'watchlist' | 'library' | 'discover' | 'downloads' | 'profile') => void;
  onActiveTabClick?: () => void;
  onActiveTabDoubleClick?: () => void;
}

interface TabItem {
  id: 'watchlist' | 'library' | 'discover' | 'downloads' | 'profile';
  label: string;
  symbol: SeenItSymbolType;
}

export function BottomNav({ currentTab, onTabChange, onActiveTabClick, onActiveTabDoubleClick }: Props) {
  const lastTapRef = useRef<number>(0);
  const activeDownloads = useLiveDownloadStore(state => state.downloads);
  const activeCount = activeDownloads.length;

  const tabs: readonly TabItem[] = [
    { id: 'watchlist', label: 'À Voir', symbol: 'watch' },
    { id: 'library', label: 'Ma Liste', symbol: 'library' },
    { id: 'discover', label: 'Explorer', symbol: 'discover' },
    { id: 'downloads', label: 'Téléchargements', symbol: 'download' },
    { id: 'profile', label: 'Profil', symbol: 'profile' },
  ] as const;

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
      // Double tap : Scroll to top / reset filtres
      if (onActiveTabDoubleClick) {
        onActiveTabDoubleClick();
      }
      lastTapRef.current = 0; // reset
    } else {
      // Single tap : Exécuté IMMÉDIATEMENT (Retour arrière)
      if (onActiveTabClick) {
        onActiveTabClick();
      }
      lastTapRef.current = now;
    }
  };

  return (
    <div className="absolute bottom-0 inset-x-0 bg-zinc-950/95 backdrop-blur-2xl border-t border-white/10 pt-1.5 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] px-2 sm:px-4 flex justify-between items-center z-[160]">
      {tabs.map((tab) => {
        const isActive = currentTab === tab.id;
        const isDownloadTab = tab.id === 'downloads';

        return (
          <button
            key={tab.id}
            type="button"
            onClick={(e) => handleTabClick(e, tab.id)}
            className={cn(
              "flex flex-col items-center gap-0.5 transition-all duration-200 p-1 min-w-[58px] sm:min-w-[64px] rounded-xl touch-manipulation active:scale-95 cursor-pointer relative",
              isActive ? "text-[#E5A93D]" : "text-zinc-500 hover:text-zinc-400"
            )}
          >
            <div className={cn("p-1 rounded-xl transition-all flex items-center justify-center relative", isActive ? "bg-[#E5A93D]/12" : "bg-transparent")}>
              <SeenItGlyph
                size={23}
                symbol={tab.symbol}
                active={isActive}
                glow={isActive}
                idPrefix={`bnav-${tab.id}`}
              />
              {isDownloadTab && activeCount > 0 && (
                <span className="absolute -top-0.5 -right-1 min-w-[15px] h-[15px] px-1 rounded-full bg-blue-500 text-white font-black text-[9px] flex items-center justify-center shadow-lg shadow-blue-500/50 animate-pulse">
                  {activeCount}
                </span>
              )}
            </div>
            <span className={cn("text-[8.5px] sm:text-[9px] font-bold uppercase tracking-tight sm:tracking-wider whitespace-nowrap", isActive ? "text-[#E5A93D]" : "text-zinc-500")}>
              {tab.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
