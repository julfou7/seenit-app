import { Capacitor } from '@capacitor/core';
import { dominantPosterHue, POSTER_HUE_FALLBACK, readPosterHue, rememberPosterHue } from '../features/watchlist/posterHue';
import { seriesCardPosterCrossOrigin } from '../features/watchlist/seriesCardPresentation';
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { DialogLayer } from './ui/DialogLayer';
import type { SeriesCardAction } from './cards/SeriesEpisodeCard';
import { imageUrl } from '../features/watchlist/seriesCardPresentation';
import './historyEntryRow.css';

export function HistoryEntryRow({ title, episodeTitle, code, date, today, timestamp, images, label, onOpen, actions, groupCount = 1, actionGroups }: {
  title: string; episodeTitle?: string; code?: string; date: string; today: boolean;
  timestamp: number; images: Array<string | null | undefined>; label: string;
  onOpen: () => void; actions: SeriesCardAction[]; groupCount?: number; actionGroups?: Array<{ label: string; actions: SeriesCardAction[] }>;
}) {
  const [menu, setMenu] = useState(false);
  const [pending, setPending] = useState(false);
  const [imageIndex, setImageIndex] = useState(0);
  const candidates = [...new Set(images.filter((value): value is string => Boolean(value)))];
  const [hue, setHue] = useState(POSTER_HUE_FALLBACK);
  const imageKey = candidates.join('|');
  useEffect(() => setImageIndex(0), [imageKey]);
  useEffect(() => setHue(readPosterHue(candidates[imageIndex]) ?? POSTER_HUE_FALLBACK), [imageKey, imageIndex]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const moved = useRef(false);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const cancel = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; origin.current = null; };
  useEffect(() => cancel, []);
  return <>
    <article className={`history-entry${today ? ' history-entry--today' : ''}`} data-history-row style={{ '--history-hue': hue } as React.CSSProperties}>
      <button type="button" className="history-entry__open" aria-label={label} aria-haspopup="dialog" onClick={event => {
        const ignore = event.detail > 0 && (held.current || moved.current);
        held.current = false; moved.current = false; if (!ignore) onOpen();
      }} onPointerDown={event => {
        if (event.button !== 0) return; cancel(); held.current = false; moved.current = false;
        origin.current = { x: event.clientX, y: event.clientY };
        timer.current = setTimeout(() => { held.current = true; setMenu(true); }, 480);
      }} onPointerMove={event => {
        if (origin.current && Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > 8) { moved.current = true; cancel(); }
      }} onPointerUp={cancel} onPointerCancel={cancel} onPointerLeave={cancel}
      onContextMenu={event => { event.preventDefault(); cancel(); setMenu(true); }}
      onKeyDown={event => { if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { event.preventDefault(); setMenu(true); } }} />
      <div className="history-entry__image" aria-hidden="true"><span>{title.split(/\s+/).slice(0, 2).map(word => word[0]).join('')}</span>
        {candidates[imageIndex] && <img src={imageUrl(candidates[imageIndex], 'w300')!} alt="" loading="lazy" crossOrigin={seriesCardPosterCrossOrigin(imageUrl(candidates[imageIndex], 'w300'), Capacitor.isNativePlatform())} onLoad={event => { try { const canvas = document.createElement('canvas'); canvas.width = 8; canvas.height = 8; const context = canvas.getContext('2d', { willReadFrequently: true }); if (context) { context.drawImage(event.currentTarget, 0, 0, 8, 8); const value = dominantPosterHue(context.getImageData(0, 0, 8, 8).data); rememberPosterHue(candidates[imageIndex], value); setHue(value); } } catch { /* Le poster sans CORS garde la teinte de secours. */ } }} onError={() => setImageIndex(index => index + 1)} />}
        {groupCount > 1 && <b className="history-entry__group">×{groupCount}</b>}
      </div>
      <div className="history-entry__text"><h3>{title}</h3><div>{code && <><strong>{code}</strong><span> · </span></>}<time dateTime={new Date(timestamp).toISOString()}>{date}</time></div>{episodeTitle && <p>{episodeTitle}</p>}</div>
      <button type="button" className="history-entry__actions" aria-label={`Actions de ${title}`} aria-haspopup="dialog" onClick={() => setMenu(true)}>
        <span aria-hidden="true"><svg viewBox="0 0 100 74" fill="none"><rect x="6" y="4" width="88" height="56" rx="16" /><path d="M33 32 45 44 67 21M36 70H64" /></svg></span>
      </button>
    </article>
    {menu && <DialogLayer label={`Actions de ${title}`} onDismiss={() => setMenu(false)} className="fixed inset-0 flex items-end sm:items-center justify-center bg-black/65 p-4 pb-nav">
      <section className="w-full max-w-md rounded-3xl border border-white/10 bg-zinc-950 p-4 shadow-2xl">
        <div className="flex items-center justify-between gap-3 mb-2"><h2 className="font-bold text-white">{title}</h2><button type="button" aria-label="Fermer les actions" data-dialog-initial-focus className="min-h-11 min-w-11 grid place-items-center text-zinc-300" onClick={() => setMenu(false)}><X size={20} /></button></div>
        {actions.map(action => <button key={action.label} type="button" disabled={pending} className={`w-full min-h-11 text-left px-3 py-3 rounded-xl hover:bg-white/5 disabled:opacity-50 ${action.destructive ? 'text-rose-300' : 'text-zinc-100'}`} onClick={async () => { if (pending) return; setPending(true); try { setMenu(false); await action.onSelect(); } finally { setPending(false); } }}>{action.label}</button>)}
        {actionGroups?.map(group => <details key={group.label} className="history-entry__action-group"><summary>{group.label}</summary>{group.actions.map(action => <button key={action.label} type="button" disabled={pending} onClick={async () => { if (pending) return; setPending(true); try { setMenu(false); await action.onSelect(); } finally { setPending(false); } }}>{action.label}</button>)}</details>)}
      </section>
    </DialogLayer>}
  </>;
}
