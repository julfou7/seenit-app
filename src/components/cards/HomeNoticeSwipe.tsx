import { useRef, useState, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';

export function HomeNoticeSwipe({ children, onDismiss }: { children: ReactNode; onDismiss: () => void }) {
  const origin = useRef<{ x: number; y: number; axis: 'pending' | 'x' | 'y'; dx: number } | null>(null);
  const consumed = useRef(false);
  const [offset, setOffset] = useState(0);
  return <div className="home-notice-swipe" onPointerDown={event => {
    if (event.button !== 0 || (event.target as Element).closest('[data-notice-action]')) return;
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
    start.dx = Math.min(0, dx);
    setOffset(Math.max(-120, start.dx));
  }} onPointerUp={event => {
    const start = origin.current;
    origin.current = null; setOffset(0);
    if (start?.axis === 'x') { event.preventDefault(); if (start.dx <= -72) onDismiss(); }
  }} onPointerCancel={() => { origin.current = null; setOffset(0); }} onClickCapture={event => {
    if (consumed.current) { event.preventDefault(); event.stopPropagation(); consumed.current = false; }
  }}>
    <span className="home-notice-swipe__back" aria-hidden="true" style={{ opacity: offset < 0 ? 1 : 0 }}><Trash2 size={20} /></span>
    <div className="home-notice-swipe__front" style={{ transform: `translateX(${offset}px)`, transition: offset ? 'none' : undefined }}>{children}</div>
  </div>;
}
