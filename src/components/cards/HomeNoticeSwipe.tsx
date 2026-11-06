import { useRef, useState, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';

const DISMISS_DISTANCE = 72;
const EXIT_MS = 220;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

/** #876 — Glisser à droite retire : la carte suit le doigt, sort de l'écran (220 ms) puis la notification est retirée. */
export function HomeNoticeSwipe({ children, onDismiss }: { children: ReactNode; onDismiss: () => void }) {
  const origin = useRef<{ x: number; y: number; axis: 'pending' | 'x' | 'y'; dx: number } | null>(null);
  const consumed = useRef(false);
  const leavingRef = useRef(false);
  const [offset, setOffset] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const leave = () => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    if (prefersReducedMotion()) { onDismiss(); return; }
    setLeaving(true);
    setTimeout(onDismiss, EXIT_MS);
  };
  // Un glissement qui part d'une carte ne doit pas aussi déclencher le retour par le bord gauche de la page.
  return <div className="home-notice-swipe" onTouchStart={event => event.stopPropagation()} onPointerDown={event => {
    if (event.button !== 0 || leavingRef.current || (event.target as Element).closest('[data-notice-action]')) return;
    consumed.current = false;
    origin.current = { x: event.clientX, y: event.clientY, axis: 'pending', dx: 0 };
  }} onPointerMove={event => {
    const start = origin.current;
    if (!start) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    if (start.axis === 'pending' && Math.max(Math.abs(dx), Math.abs(dy)) > 8) start.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
    if (start.axis !== 'x') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    consumed.current = true;
    start.dx = Math.max(0, dx);
    setOffset(Math.min(120, start.dx));
  }} onPointerUp={event => {
    const start = origin.current;
    origin.current = null; setOffset(0);
    if (start?.axis === 'x') { event.preventDefault(); if (start.dx >= DISMISS_DISTANCE) leave(); }
  }} onPointerCancel={() => { origin.current = null; setOffset(0); }} onClickCapture={event => {
    if (consumed.current) { event.preventDefault(); event.stopPropagation(); consumed.current = false; }
  }}>
    <span className="home-notice-swipe__back" aria-hidden="true" style={{ opacity: leaving || offset > 0 ? 1 : 0 }}><Trash2 size={20} />Retirer</span>
    <div className="home-notice-swipe__front" style={leaving
      ? { transform: 'translateX(110%)', transition: `transform ${EXIT_MS}ms cubic-bezier(.32,.72,0,1)` }
      : { transform: `translateX(${offset}px)`, transition: offset ? 'none' : undefined }}>{children}</div>
  </div>;
}
