import React, { useRef } from 'react';
import { Tv, PlayCircle, Compass, User } from 'lucide-react';
import { cn } from '../lib/utils';

interface Props {
  currentTab: string;
  onTabChange: (tab: 'watchlist' | 'library' | 'discover' | 'profile') => void;
  onActiveTabClick?: () => void;
  onActiveTabDoubleClick?: () => void;
}

export function BottomNav({ currentTab, onTabChange, onActiveTabClick, onActiveTabDoubleClick }: Props) {
  const lastTapRef = useRef<number>(0);

  const tabs = [
    { id: 'watchlist', label: 'À Voir', icon: PlayCircle },
    { id: 'library', label: 'Ma Liste', icon: Tv },
    { id: 'discover', label: 'Explorer', icon: ExplorerIcon },
    { id: 'profile', label: 'Profil', icon: User },
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
    <div className="absolute bottom-0 inset-x-0 bg-zinc-950/95 backdrop-blur-2xl border-t border-white/10 pt-1.5 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] px-6 flex justify-between items-center z-[120]">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = currentTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={(e) => handleTabClick(e, tab.id)}
            className={cn(
              "flex flex-col items-center gap-0.5 transition-all duration-300 p-1 min-w-[64px] rounded-xl touch-manipulation active:scale-95",
              isActive ? "text-[#E5A93D]" : "text-zinc-500 hover:text-zinc-400"
            )}
          >
            <div className={cn("p-1.5 rounded-xl transition-all", isActive ? "bg-[#E5A93D]/10" : "bg-transparent")}>
              <Icon size={22} strokeWidth={isActive ? 2.5 : 2} />
            </div>
            <span className={cn("text-[9px] font-bold uppercase tracking-wider", isActive ? "text-[#E5A93D]" : "text-zinc-500")}>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
