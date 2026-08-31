import React, { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Ban, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  describeSwipeKeyboardActions,
  resolveSwipeKeyboardAction
} from '../../features/ui/swipeActionPolicy';

interface SwipeActionPresentation {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  tone?: 'amber' | 'rose';
}

interface SwipeableCardProps {
  children: ReactNode;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  leftAction?: SwipeActionPresentation;
  rightAction?: SwipeActionPresentation;
  className?: string;
}

const DEFAULT_RIGHT_ACTION: SwipeActionPresentation = {
  title: 'Abandonner',
  subtitle: 'Ne plus suivre',
  tone: 'amber'
};

const DEFAULT_LEFT_ACTION: SwipeActionPresentation = {
  title: 'Supprimer',
  subtitle: 'Retirer la série',
  tone: 'rose'
};

export const SwipeableCard = React.memo(({
  children,
  onSwipeLeft,
  onSwipeRight,
  leftAction = DEFAULT_LEFT_ACTION,
  rightAction = DEFAULT_RIGHT_ACTION,
  className
}: SwipeableCardProps) => {
  const [translateX, setTranslateX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const startXRef = useRef<number | null>(null);
  const startYRef = useRef<number | null>(null);
  const latestDiffXRef = useRef(0);
  const startTimeRef = useRef(0);
  const isScrollingRef = useRef<boolean | null>(null);
  const isMouseDownRef = useRef(false);
  const wasSwipingRef = useRef(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const pendingTimersRef = useRef<Set<number>>(new Set());
  const actionDescriptionId = useId();

  const scheduleTimer = (callback: () => void, delay: number) => {
    const timerId = window.setTimeout(() => {
      pendingTimersRef.current.delete(timerId);
      callback();
    }, delay);
    pendingTimersRef.current.add(timerId);
  };

  useEffect(() => () => {
    pendingTimersRef.current.forEach(timerId => window.clearTimeout(timerId));
    pendingTimersRef.current.clear();
  }, []);

  const clampToAvailableDirection = (diffX: number, cardWidth: number) => {
    if (diffX > 0 && !onSwipeRight) return 0;
    if (diffX < 0 && !onSwipeLeft) return 0;
    if (diffX > cardWidth) return cardWidth + (diffX - cardWidth) * 0.25;
    if (diffX < -cardWidth) return -cardWidth + (diffX + cardWidth) * 0.25;
    return diffX;
  };

  const resetGesture = () => {
    latestDiffXRef.current = 0;
    setTranslateX(0);
  };

  const completeGesture = (wasHorizontal: boolean) => {
    setIsDragging(false);
    const finalDiffX = latestDiffXRef.current;
    const duration = Date.now() - startTimeRef.current;

    startXRef.current = null;
    startYRef.current = null;
    isScrollingRef.current = null;
    isMouseDownRef.current = false;

    if (wasSwipingRef.current) {
      scheduleTimer(() => {
        wasSwipingRef.current = false;
      }, 200);
    }

    if (!cardRef.current || !wasHorizontal) {
      resetGesture();
      return;
    }

    const cardWidth = cardRef.current.offsetWidth || 350;
    const triggerThreshold = cardWidth * 0.20;
    const isFastFlick = Math.abs(finalDiffX) > 30 && duration < 320;
    const isPastThreshold = Math.abs(finalDiffX) > triggerThreshold;

    if (!(isFastFlick || isPastThreshold)) {
      resetGesture();
      return;
    }

    if (finalDiffX > 0 && onSwipeRight) {
      setTranslateX(cardWidth + 100);
      scheduleTimer(resetGesture, 1040);
      scheduleTimer(onSwipeRight, 240);
      return;
    }

    if (finalDiffX < 0 && onSwipeLeft) {
      setTranslateX(-cardWidth - 100);
      scheduleTimer(resetGesture, 1040);
      scheduleTimer(onSwipeLeft, 240);
      return;
    }

    resetGesture();
  };

  const handleTouchStart = (event: React.TouchEvent) => {
    wasSwipingRef.current = false;
    startXRef.current = event.touches[0].clientX;
    startYRef.current = event.touches[0].clientY;
    latestDiffXRef.current = 0;
    startTimeRef.current = Date.now();
    isScrollingRef.current = null;
    setIsDragging(true);
  };

  const handleTouchMove = (event: React.TouchEvent) => {
    if (startXRef.current === null || startYRef.current === null) return;

    const diffX = event.touches[0].clientX - startXRef.current;
    const diffY = event.touches[0].clientY - startYRef.current;

    if (isScrollingRef.current === null) {
      if (Math.abs(diffY) > Math.abs(diffX) && Math.abs(diffY) > 6) {
        isScrollingRef.current = true;
      } else if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 6) {
        isScrollingRef.current = false;
      }
    }

    if (isScrollingRef.current === true) {
      resetGesture();
      return;
    }

    if (isScrollingRef.current === false) {
      if (Math.abs(diffX) > 8) wasSwipingRef.current = true;
      const cardWidth = cardRef.current?.offsetWidth || 350;
      const calculatedX = clampToAvailableDirection(diffX, cardWidth);
      latestDiffXRef.current = calculatedX;
      setTranslateX(calculatedX);
    }
  };

  const handleTouchEnd = () => completeGesture(isScrollingRef.current === false);
  const handleTouchCancel = () => completeGesture(false);

  const handleMouseDown = (event: React.MouseEvent) => {
    wasSwipingRef.current = false;
    isMouseDownRef.current = true;
    startXRef.current = event.clientX;
    startYRef.current = event.clientY;
    latestDiffXRef.current = 0;
    startTimeRef.current = Date.now();
    isScrollingRef.current = false;
    setIsDragging(true);
  };

  const handleMouseMove = (event: React.MouseEvent) => {
    if (!isMouseDownRef.current || startXRef.current === null) return;
    const diffX = event.clientX - startXRef.current;
    if (Math.abs(diffX) > 8) wasSwipingRef.current = true;
    const cardWidth = cardRef.current?.offsetWidth || 350;
    const calculatedX = clampToAvailableDirection(diffX, cardWidth);
    latestDiffXRef.current = calculatedX;
    setTranslateX(calculatedX);
  };

  const handleMouseUp = () => {
    if (!isMouseDownRef.current) return;
    completeGesture(true);
  };

  const handleClickCapture = (event: React.MouseEvent) => {
    if (!wasSwipingRef.current) return;
    event.stopPropagation();
    event.preventDefault();
    wasSwipingRef.current = false;
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target !== event.currentTarget && target.closest('button, a, input, select, textarea')) return;

    const direction = resolveSwipeKeyboardAction(
      event.key,
      Boolean(onSwipeLeft),
      Boolean(onSwipeRight)
    );
    if (!direction) return;

    event.preventDefault();
    event.stopPropagation();
    if (direction === 'left') onSwipeLeft?.();
    else onSwipeRight?.();
  };

  const keyboardDescription = describeSwipeKeyboardActions(
    onSwipeLeft ? leftAction.title : undefined,
    onSwipeRight ? rightAction.title : undefined
  );

  const rightTone = rightAction.tone === 'rose'
    ? 'from-rose-600 via-red-600 to-pink-600'
    : 'from-amber-600 via-amber-500 to-orange-500';
  const leftTone = leftAction.tone === 'amber'
    ? 'from-amber-600 via-amber-500 to-orange-500'
    : 'from-rose-600 via-red-600 to-pink-600';

  return (
    <div
      ref={cardRef}
      onClickCapture={handleClickCapture}
      onKeyDown={handleKeyDown}
      role="group"
      tabIndex={onSwipeLeft || onSwipeRight ? 0 : undefined}
      aria-describedby={keyboardDescription ? actionDescriptionId : undefined}
      aria-keyshortcuts={onSwipeLeft || onSwipeRight ? 'ArrowLeft ArrowRight Delete Backspace' : undefined}
      className={cn(
        'relative w-full rounded-2xl touch-pan-y select-none outline-none focus-visible:ring-2 focus-visible:ring-[#E5A93D] focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950',
        className
      )}
    >
      {keyboardDescription && (
        <span id={actionDescriptionId} className="sr-only">{keyboardDescription}</span>
      )}
      <div className="absolute inset-0 overflow-hidden rounded-2xl bg-zinc-950">
        {onSwipeRight && (
          <div
            className={cn(
              'absolute inset-y-0 left-0 flex items-center justify-start bg-gradient-to-r pl-6 transition-opacity duration-150 sm:pl-10',
              rightTone,
              translateX > 0 ? 'opacity-100' : 'pointer-events-none opacity-0'
            )}
            style={{ width: translateX > 0 ? '100%' : '0%' }}
          >
            <div
              className="flex items-center gap-3 text-white transition-transform duration-150"
              style={{
                transform: `scale(${Math.min(1.1, Math.max(0.85, translateX / 120))})`,
                opacity: Math.min(1, translateX / 30)
              }}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/30 bg-black/20 shadow-md backdrop-blur-md">
                {rightAction.icon || <Ban className="shrink-0 text-white drop-shadow" size={20} />}
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-black uppercase tracking-wider drop-shadow-sm">{rightAction.title}</span>
                {rightAction.subtitle && <span className="text-[10px] font-medium leading-tight text-white/80">{rightAction.subtitle}</span>}
              </div>
            </div>
          </div>
        )}

        {onSwipeLeft && (
          <div
            className={cn(
              'absolute inset-y-0 right-0 flex items-center justify-end bg-gradient-to-l pr-6 transition-opacity duration-150 sm:pr-10',
              leftTone,
              translateX < 0 ? 'opacity-100' : 'pointer-events-none opacity-0'
            )}
            style={{ width: translateX < 0 ? '100%' : '0%' }}
          >
            <div
              className="flex items-center gap-3 text-right text-white transition-transform duration-150"
              style={{
                transform: `scale(${Math.min(1.1, Math.max(0.85, Math.abs(translateX) / 120))})`,
                opacity: Math.min(1, Math.abs(translateX) / 30)
              }}
            >
              <div className="flex flex-col">
                <span className="text-xs font-black uppercase tracking-wider drop-shadow-sm">{leftAction.title}</span>
                {leftAction.subtitle && <span className="text-[10px] font-medium leading-tight text-white/80">{leftAction.subtitle}</span>}
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/30 bg-black/20 shadow-md backdrop-blur-md">
                {leftAction.icon || <Trash2 className="shrink-0 text-white drop-shadow" size={20} />}
              </div>
            </div>
          </div>
        )}
      </div>

      <div
        className={cn(
          'relative z-10 w-full will-change-transform',
          isDragging ? 'transition-none' : 'transition-transform duration-300 ease-[cubic-bezier(0.175,0.885,0.32,1.275)]'
        )}
        style={{
          transform: `translateX(${translateX}px)`,
          willChange: 'transform',
          transition: isDragging ? 'none' : 'transform 300ms cubic-bezier(0.175, 0.885, 0.32, 1.275)'
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
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
