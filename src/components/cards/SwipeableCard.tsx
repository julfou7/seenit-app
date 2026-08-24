import React, { useState, useRef, ReactNode } from 'react';
import { Ban, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';

interface SwipeableCardProps {
  key?: React.Key;
  children: ReactNode;
  onSwipeLeft: () => void;  // Swipe vers la gauche -> Archiver
  onSwipeRight: () => void; // Swipe vers la droite -> Ne plus suivre
  className?: string;
}

export const SwipeableCard = React.memo(({ children, onSwipeLeft, onSwipeRight, className }: SwipeableCardProps) => {
  const [translateX, setTranslateX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  
  const startXRef = useRef<number | null>(null);
  const startYRef = useRef<number | null>(null);
  const latestDiffXRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const isScrollingRef = useRef<boolean | null>(null);
  const isMouseDownRef = useRef<boolean>(false);
  const wasSwipingRef = useRef<boolean>(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    wasSwipingRef.current = false;
    startXRef.current = e.touches[0].clientX;
    startYRef.current = e.touches[0].clientY;
    latestDiffXRef.current = 0;
    startTimeRef.current = Date.now();
    isScrollingRef.current = null;
    setIsDragging(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (startXRef.current === null || startYRef.current === null) return;

    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;

    const diffX = currentX - startXRef.current;
    const diffY = currentY - startYRef.current;

    // Directional lock detection
    if (isScrollingRef.current === null) {
      if (Math.abs(diffY) > Math.abs(diffX) && Math.abs(diffY) > 6) {
        isScrollingRef.current = true; // Vertical scroll
      } else if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 6) {
        isScrollingRef.current = false; // Horizontal swipe
      }
    }

    if (isScrollingRef.current === true) {
      latestDiffXRef.current = 0;
      setTranslateX(0);
      return;
    }

    if (isScrollingRef.current === false) {
      if (Math.abs(diffX) > 8) {
        wasSwipingRef.current = true;
      }
      const cardWidth = cardRef.current?.offsetWidth || 350;
      let calculatedX = diffX;
      
      // Permettre un swipe fluide sans blocage jusqu'au bout de la carte
      if (diffX > cardWidth) {
        calculatedX = cardWidth + (diffX - cardWidth) * 0.25;
      } else if (diffX < -cardWidth) {
        calculatedX = -cardWidth + (diffX + cardWidth) * 0.25;
      }
      
      latestDiffXRef.current = calculatedX;
      setTranslateX(calculatedX);
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    const finalDiffX = latestDiffXRef.current;
    const duration = Date.now() - startTimeRef.current;
    const wasHorizontal = isScrollingRef.current === false;

    // Reset touch refs
    startXRef.current = null;
    startYRef.current = null;
    isScrollingRef.current = null;

    if (wasSwipingRef.current) {
      setTimeout(() => {
        wasSwipingRef.current = false;
      }, 200);
    }

    if (cardRef.current && wasHorizontal) {
      const cardWidth = cardRef.current.offsetWidth || 350;
      const triggerThreshold = cardWidth * 0.20; // 20% drag threshold
      
      const isFastFlick = Math.abs(finalDiffX) > 30 && duration < 320;
      const isPastThreshold = Math.abs(finalDiffX) > triggerThreshold;

      if (isPastThreshold || isFastFlick) {
        if (finalDiffX > 0) {
          setTranslateX(cardWidth + 100);
          setTimeout(() => {
            onSwipeRight();
            setTimeout(() => {
              setTranslateX(0);
              latestDiffXRef.current = 0;
            }, 800);
          }, 240);
          return;
        } else if (finalDiffX < 0) {
          setTranslateX(-cardWidth - 100);
          setTimeout(() => {
            onSwipeLeft();
            setTimeout(() => {
              setTranslateX(0);
              latestDiffXRef.current = 0;
            }, 800);
          }, 240);
          return;
        }
      }
    }

    latestDiffXRef.current = 0;
    setTranslateX(0);
  };

  // Mouse fallback for desktop testing
  const handleMouseDown = (e: React.MouseEvent) => {
    wasSwipingRef.current = false;
    isMouseDownRef.current = true;
    startXRef.current = e.clientX;
    startYRef.current = e.clientY;
    latestDiffXRef.current = 0;
    startTimeRef.current = Date.now();
    isScrollingRef.current = false;
    setIsDragging(true);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isMouseDownRef.current || startXRef.current === null) return;
    const currentX = e.clientX;
    const diffX = currentX - startXRef.current;
    if (Math.abs(diffX) > 8) {
      wasSwipingRef.current = true;
    }
    const cardWidth = cardRef.current?.offsetWidth || 350;
    let calculatedX = diffX;

    if (diffX > cardWidth) {
      calculatedX = cardWidth + (diffX - cardWidth) * 0.25;
    } else if (diffX < -cardWidth) {
      calculatedX = -cardWidth + (diffX + cardWidth) * 0.25;
    }

    latestDiffXRef.current = calculatedX;
    setTranslateX(calculatedX);
  };

  const handleMouseUp = () => {
    if (!isMouseDownRef.current) return;
    isMouseDownRef.current = false;
    setIsDragging(false);

    const finalDiffX = latestDiffXRef.current;
    const duration = Date.now() - startTimeRef.current;

    startXRef.current = null;
    startYRef.current = null;
    isScrollingRef.current = null;

    if (wasSwipingRef.current) {
      setTimeout(() => {
        wasSwipingRef.current = false;
      }, 200);
    }

    if (cardRef.current) {
      const cardWidth = cardRef.current.offsetWidth || 350;
      const triggerThreshold = cardWidth * 0.20;
      const isFastFlick = Math.abs(finalDiffX) > 30 && duration < 320;
      const isPastThreshold = Math.abs(finalDiffX) > triggerThreshold;

      if (isPastThreshold || isFastFlick) {
        if (finalDiffX > 0) {
          setTranslateX(cardWidth + 100);
          setTimeout(() => {
            onSwipeRight();
            setTimeout(() => {
              setTranslateX(0);
              latestDiffXRef.current = 0;
            }, 800);
          }, 240);
          return;
        } else if (finalDiffX < 0) {
          setTranslateX(-cardWidth - 100);
          setTimeout(() => {
            onSwipeLeft();
            setTimeout(() => {
              setTranslateX(0);
              latestDiffXRef.current = 0;
            }, 800);
          }, 240);
          return;
        }
      }
    }

    latestDiffXRef.current = 0;
    setTranslateX(0);
  };

  const handleClickCapture = (e: React.MouseEvent) => {
    if (wasSwipingRef.current) {
      e.stopPropagation();
      e.preventDefault();
      wasSwipingRef.current = false;
    }
  };

  return (
    <div 
      ref={cardRef} 
      onClickCapture={handleClickCapture}
      className={cn("relative w-full rounded-2xl touch-pan-y select-none", className)}
    >
      {/* ARRIÈRE-PLAN DES ACTIONS */}
      <div className="absolute inset-0 bg-zinc-950 rounded-2xl overflow-hidden">
        {/* Dégradé Orange / Amber (Swipe vers la droite -> Abandonner) */}
        <div 
          className={cn(
            "absolute inset-y-0 left-0 bg-gradient-to-r from-amber-600 via-amber-500 to-orange-500 flex items-center justify-start pl-6 sm:pl-10 transition-opacity duration-150",
            translateX > 0 ? "opacity-100" : "opacity-0 pointer-events-none"
          )}
          style={{ width: translateX > 0 ? '100%' : '0%' }}
        >
          <div 
            className="flex items-center gap-3 transition-transform duration-150"
            style={{ 
              transform: `scale(${Math.min(1.1, Math.max(0.85, translateX / 120))})`,
              opacity: Math.min(1, translateX / 30)
            }}
          >
            <div className="w-10 h-10 rounded-full bg-black/20 backdrop-blur-md flex items-center justify-center border border-white/30 shadow-md">
              <Ban className="text-white shrink-0 drop-shadow" size={20} />
            </div>
            <div className="flex flex-col text-white">
              <span className="text-xs font-black uppercase tracking-wider drop-shadow-sm">Abandonner</span>
              <span className="text-[10px] font-medium text-amber-100/90 leading-tight">Ne plus suivre</span>
            </div>
          </div>
        </div>

        {/* Dégradé Rouge / Rose (Swipe vers la gauche -> Supprimer) */}
        <div 
          className={cn(
            "absolute inset-y-0 right-0 bg-gradient-to-l from-rose-600 via-red-600 to-pink-600 flex items-center justify-end pr-6 sm:pr-10 transition-opacity duration-150",
            translateX < 0 ? "opacity-100" : "opacity-0 pointer-events-none"
          )}
          style={{ width: translateX < 0 ? '100%' : '0%' }}
        >
          <div 
            className="flex items-center gap-3 transition-transform duration-150"
            style={{ 
              transform: `scale(${Math.min(1.1, Math.max(0.85, Math.abs(translateX) / 120))})`,
              opacity: Math.min(1, Math.abs(translateX) / 30)
            }}
          >
            <div className="flex flex-col text-white text-right">
              <span className="text-xs font-black uppercase tracking-wider drop-shadow-sm">Supprimer</span>
              <span className="text-[10px] font-medium text-red-100/90 leading-tight">Retirer la série</span>
            </div>
            <div className="w-10 h-10 rounded-full bg-black/20 backdrop-blur-md flex items-center justify-center border border-white/30 shadow-md">
              <Trash2 className="text-white shrink-0 drop-shadow" size={20} />
            </div>
          </div>
        </div>
      </div>

      {/* CARTE SUPERIEURE PRINCIPALE (AVEC ACCÉLÉRATION MATÉRIELLE ET COURBE FLUIDE) */}
      <div 
        className={cn(
          "relative w-full z-10 will-change-transform",
          isDragging ? "transition-none" : "transition-transform duration-300 ease-[cubic-bezier(0.175,0.885,0.32,1.275)]"
        )}
        style={{ 
          transform: `translateX(${translateX}px)`,
          willChange: 'transform',
          transition: isDragging ? 'none' : 'transform 300ms cubic-bezier(0.175, 0.885, 0.32, 1.275)'
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {children}
      </div>
    </div>
  );
});