import { useRef, useState, type ReactNode } from 'react';
import { Archive, Trash2 } from 'lucide-react';

export function HomeSwipeCard({ children, onArchive, onRemove }: { children: ReactNode; onArchive: () => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);
  return <div className={`home-swipe${open ? ' home-swipe--open' : ''}`} onTouchStart={event => {
    if ((event.target as HTMLElement).closest('button:not(.series-8f__open),a,input')) return;
    start.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }; moved.current = false;
  }} onTouchMove={event => {
    if (!start.current) return;
    const dx = event.touches[0].clientX - start.current.x, dy = event.touches[0].clientY - start.current.y;
    if (Math.abs(dy) > 16 && Math.abs(dy) > Math.abs(dx)) { start.current = null; return; }
    if (Math.abs(dx) > 52 && Math.abs(dx) > Math.abs(dy) * 1.5) { moved.current = true; setOpen(dx < 0); }
  }} onTouchEnd={() => { start.current = null; }} onTouchCancel={() => { start.current = null; moved.current = false; }}
    onClickCapture={event => { if (moved.current) { event.preventDefault(); event.stopPropagation(); moved.current = false; } }}>
    {open && <div className="home-swipe__actions"><button type="button" onClick={() => { setOpen(false); onArchive(); }}><Archive size={18} />Archiver</button><button type="button" onClick={() => { setOpen(false); onRemove(); }}><Trash2 size={18} />Supprimer</button></div>}
    <div className="home-swipe__card">{children}</div>
    {open && <button className="home-swipe__close" type="button" onClick={() => setOpen(false)}>Fermer les actions</button>}
  </div>;
}
