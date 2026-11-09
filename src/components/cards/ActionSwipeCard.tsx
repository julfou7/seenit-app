import { useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import './actionSwipe.css';

export interface SwipeTileAction { label: string; icon: ReactNode; tone: 'gold' | 'rose'; ariaLabel?: string; onSelect: () => void }

/**
 * Le geste de l'accueil (carte de série) rendu réutilisable : glisser à gauche décale la carte et montre des tuiles
 * d'action, ✕ ou Échap referment, un glissement vertical laisse défiler. Retour terrain du 09/11 (onglet Télécharger :
 * « reprends le swipe qu'on a fait sur l'accueil, plus compatible avec ces cartes ») : les cartes de téléchargement
 * l'utilisent au lieu du fond rouge plein. `base` garde les classes historiques de l'accueil (`home-swipe`).
 */
export function ActionSwipeCard({ children, actions, base = 'action-swipe', className = '', ignore = 'button,a,input' }: { children: ReactNode; actions: readonly SwipeTileAction[]; base?: string; className?: string; ignore?: string }) {
  const [open, setOpen] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);
  const ignoreClickUntil = useRef(0);
  return <div className={`${base}${open ? ` ${base}--open` : ''}${className ? ` ${className}` : ''}`} onKeyDown={event => { if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false); } }} onTouchStart={event => {
    if ((event.target as HTMLElement).closest(ignore)) return;
    start.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }; moved.current = false;
  }} onTouchMove={event => {
    if (!start.current) return;
    const dx = event.touches[0].clientX - start.current.x, dy = event.touches[0].clientY - start.current.y;
    if (Math.abs(dy) > 16 && Math.abs(dy) > Math.abs(dx)) { start.current = null; return; }
    if (Math.abs(dx) > 52 && Math.abs(dx) > Math.abs(dy) * 1.5) { moved.current = true; setOpen(dx < 0); }
  }} onTouchEnd={() => { start.current = null; if (moved.current) ignoreClickUntil.current = performance.now() + 400; moved.current = false; }} onTouchCancel={() => { start.current = null; moved.current = false; }}
    onClickCapture={event => { if ((event.target as HTMLElement).closest(`.${base}__card`) && (open || performance.now() < ignoreClickUntil.current)) { event.preventDefault(); event.stopPropagation(); if (performance.now() >= ignoreClickUntil.current) setOpen(false); } }}>
    {open && <div className={`${base}__actions`}>{actions.map(action => <button key={action.label} type="button" data-tone={action.tone} aria-label={action.ariaLabel} onClick={() => { ignoreClickUntil.current = 0; setOpen(false); action.onSelect(); }}>{action.icon}{action.label}</button>)}</div>}
    <div className={`${base}__card`}>{children}</div>
    {open && <button className={`${base}__close`} type="button" aria-label="Fermer les actions" onClick={() => setOpen(false)}><X size={17} /></button>}
  </div>;
}
