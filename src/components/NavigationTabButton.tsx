import { useEffect, useRef } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import type { NavigationTabPresentation } from '../features/navigation/tabPresentation';
import { SeenItGlyph } from './SeenItLogo';
export interface NavigationTabButtonProps {
  tab: NavigationTabPresentation;
  active: boolean;
  label?: string;
  children?: ReactNode;
  onActivate: (event: MouseEvent<HTMLButtonElement>) => void;
  onLongPress: () => void;
  onCancelGesture: () => void;
}
export function NavigationTabButton({ tab, active, label, children, onActivate, onLongPress, onCancelGesture }: NavigationTabButtonProps) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const consumeClick = useRef(false);
  const longFired = useRef(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const clear = () => { if (timer.current !== null) clearTimeout(timer.current); timer.current = null; origin.current = null; };
  const cancel = () => { clear(); consumeClick.current = true; onCancelGesture(); };
  const trigger = () => {
    if (longFired.current) return;
    longFired.current = true;
    clear(); consumeClick.current = true; onCancelGesture();
    if (!buttonRef.current?.getClientRects().length) return;
    navigator.vibrate?.(12); onLongPress();
  };
  useEffect(() => {
    const stop = () => { if (origin.current) cancel(); };
    window.addEventListener('blur', stop); document.addEventListener('visibilitychange', stop);
    return () => { clear(); window.removeEventListener('blur', stop); document.removeEventListener('visibilitychange', stop); };
  }, []);
  return <button ref={buttonRef} type="button" className="navigation-tab" data-navigation-tab={tab.id}
    aria-current={active ? 'page' : undefined} aria-label={label || tab.label}
    title={`${tab.label} · appui long ou Maj+F10 pour le raccourci`}
    onPointerDown={event => {
      longFired.current = false;
      if (!event.isPrimary || event.button !== 0) return;
      clear(); consumeClick.current = false; origin.current = { x: event.clientX, y: event.clientY };
      timer.current = setTimeout(trigger, 480);
    }}
    onPointerMove={event => { if (origin.current && Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > 8) cancel(); }}
    onPointerUp={clear} onPointerCancel={cancel} onPointerLeave={() => { if (origin.current) cancel(); }}
    onContextMenu={event => { event.preventDefault(); trigger(); }}
    onKeyDown={event => { if (!event.repeat && (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey)) { event.preventDefault(); longFired.current = false; trigger(); } }}
    onClick={event => {
      if (consumeClick.current && event.detail !== 0) { consumeClick.current = false; event.preventDefault(); return; }
      consumeClick.current = false; onActivate(event);
    }}>
    <span className="navigation-tab__icon" aria-hidden="true">
      <SeenItGlyph size={24} symbol={tab.symbol} active={active} glow={false} color="gold" navigation idPrefix={`bnav-${tab.id}`} />
      {children}
    </span>
    <span className="navigation-tab__label">{tab.label}</span>
  </button>;
}
