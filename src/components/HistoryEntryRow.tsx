import './cards/seriesEpisodeCard.css';
import { SeenItCheckButton } from './SeenItCheckButton';
import { Capacitor } from '@capacitor/core';
import { dominantPosterHue, POSTER_HUE_FALLBACK, readPosterHue, rememberPosterHue } from '../features/watchlist/posterHue';
import { seriesCardPosterCrossOrigin } from '../features/watchlist/seriesCardPresentation';
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, Minus, Plus } from 'lucide-react';
import { historyDateInputValue, historyLocalDayKey, historyTimeInputValue } from '../features/history/historyPresentation';
import { DialogLayer } from './ui/DialogLayer';
import { imageUrl } from '../features/watchlist/seriesCardPresentation';
import './historyEntryRow.css';

/** #9 Historique : actions (maquette validée le 07/11) — remplace la feuille du bas et la confirmation rouge. */
export interface HistoryRowMenu {
  /** « Aujourd’hui à 07:41 », « Hier à 21:10 », « 4 nov. » si l'heure est inconnue. */
  whenLabel: string;
  watchedAt: number;
  timeKnown: boolean;
  onSaveDate: (date: string, time: string) => void | Promise<void>;
  onRewatch: () => void | Promise<void>;
  onOpenSeries?: () => void;
  onUnseen: () => void | Promise<void>;
}

const DAY_MS = 86_400_000;
const shiftTime = (time: string, minutes: number) => {
  const [hours, mins] = (time || '20:00').split(':').map(Number);
  const total = (((hours * 60 + mins + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

export function HistoryEntryRow({ title, episodeTitle, code, date, clock, today, timestamp, images, label, onOpen, menu: actions }: {
  title: string; episodeTitle?: string; code?: string; date: string; clock: string; today: boolean;
  timestamp: number; images: Array<string | null | undefined>; label: string;
  onOpen: () => void; menu: HistoryRowMenu;
}) {
  const [menu, setMenu] = useState(false);
  const [view, setView] = useState<'actions' | 'date'>('actions');
  const [anchor, setAnchor] = useState<{ top?: number; bottom?: number }>({});
  const [draftDate, setDraftDate] = useState('');
  const [draftTime, setDraftTime] = useState('');
  const [pending, setPending] = useState(false);
  const rowRef = useRef<HTMLElement>(null);
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
  // Menu ancré sous la ligne (au-dessus si la place manque) : la ligne reste visible, encadrée d'or.
  const openMenu = () => {
    const rect = rowRef.current?.getBoundingClientRect();
    const roomBelow = rect ? window.innerHeight - rect.bottom : Infinity;
    setAnchor(!rect ? { top: 80 } : roomBelow >= 340 ? { top: rect.bottom + 8 } : { bottom: window.innerHeight - rect.top + 8 });
    setView('actions'); setMenu(true);
  };
  const run = async (action: () => void | Promise<void>) => { if (pending) return; setPending(true); try { setMenu(false); await action(); } finally { setPending(false); } };
  const openDate = () => { setDraftDate(historyDateInputValue(actions.watchedAt)); setDraftTime(historyTimeInputValue(actions.watchedAt, actions.timeKnown)); setView('date'); };
  const todayKey = historyLocalDayKey(Date.now());
  const days = [0, 1, 2].map(offset => ({ offset, key: historyLocalDayKey(Date.now() - offset * DAY_MS), label: ['Aujourd’hui', 'Hier', 'Avant-hier'][offset] }));
  const otherDay = Boolean(draftDate) && !days.some(day => day.key === draftDate);
  const item = 'w-full min-h-[52px] px-3.5 py-2 flex flex-col justify-center text-left rounded-xl active:bg-white/5 disabled:opacity-50';
  return <>
    <article ref={rowRef} className={`history-entry${today ? ' history-entry--today' : ''}${menu ? ' history-entry--menu' : ''}`} data-history-row style={{ '--history-hue': hue } as React.CSSProperties}>
      <button type="button" className="history-entry__open" aria-label={label} aria-haspopup="menu" aria-expanded={menu} onClick={event => {
        const ignore = event.detail > 0 && (held.current || moved.current);
        held.current = false; moved.current = false; if (!ignore) onOpen();
      }} onPointerDown={event => {
        if (event.button !== 0) return; cancel(); held.current = false; moved.current = false;
        origin.current = { x: event.clientX, y: event.clientY };
        timer.current = setTimeout(() => { held.current = true; openMenu(); }, 480);
      }} onPointerMove={event => {
        if (origin.current && Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > 8) { moved.current = true; cancel(); }
      }} onPointerUp={cancel} onPointerCancel={cancel} onPointerLeave={cancel}
      onContextMenu={event => { event.preventDefault(); cancel(); openMenu(); }}
      onKeyDown={event => { if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { event.preventDefault(); openMenu(); } }} />
      <div className="history-entry__image" aria-hidden="true"><span>{title.split(/\s+/).slice(0, 2).map(word => word[0]).join('')}</span>
        {candidates[imageIndex] && <img src={imageUrl(candidates[imageIndex], 'w300')!} alt="" loading="lazy" crossOrigin={seriesCardPosterCrossOrigin(imageUrl(candidates[imageIndex], 'w300'), Capacitor.isNativePlatform())} onLoad={event => { try { const canvas = document.createElement('canvas'); canvas.width = 8; canvas.height = 8; const context = canvas.getContext('2d', { willReadFrequently: true }); if (context) { context.drawImage(event.currentTarget, 0, 0, 8, 8); const value = dominantPosterHue(context.getImageData(0, 0, 8, 8).data); rememberPosterHue(candidates[imageIndex], value); setHue(value); } } catch { /* Le poster sans CORS garde la teinte de secours. */ } }} onError={() => setImageIndex(index => index + 1)} />}
      </div>
      <div className="history-entry__text"><h3>{title}</h3>{(code || !today) && <div>{code && <strong>{code}</strong>}{!today && <>{code && <span> · </span>}<time dateTime={new Date(timestamp).toISOString()}>{date}</time></>}</div>}{episodeTitle && <p>{episodeTitle}</p>}</div>
      <div className="history-entry__action-column"><SeenItCheckButton isWatched title={`Vu ${date} à ${clock} · actions de ${title}`} onClick={openMenu} /><time dateTime={new Date(timestamp).toISOString()}>{clock}</time></div>
    </article>
    {menu && <DialogLayer label={`Actions de ${title}`} onDismiss={() => setMenu(false)} className="fixed inset-0 z-[120]" onMouseDown={event => { if (event.target === event.currentTarget) setMenu(false); }}>
      <div role="menu" aria-label={`Actions de ${title}`} data-history-menu style={{ ...anchor, right: 'max(12px, calc((100vw - 28rem) / 2 + 12px))' }}
        className="absolute w-[min(320px,calc(100vw-24px))] rounded-[20px] bg-[#18181C] p-1.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12),0_18px_40px_rgba(0,0,0,0.6)] animate-in fade-in zoom-in-95 duration-150 motion-reduce:animate-none">
        {view === 'actions' ? <>
          <button type="button" role="menuitem" data-dialog-initial-focus disabled={pending} className={item} onClick={openDate}><strong className="text-[15px] font-bold text-zinc-100">Changer la date ou l’heure</strong><small className="text-[12.5px] text-zinc-400">{actions.whenLabel}</small></button>
          <button type="button" role="menuitem" disabled={pending} className={item} onClick={() => void run(actions.onRewatch)}><strong className="text-[15px] font-bold text-zinc-100">Revoir</strong><small className="text-[12.5px] text-zinc-400">Ajoute un nouveau visionnage</small></button>
          {actions.onOpenSeries && <button type="button" role="menuitem" disabled={pending} className={item} onClick={() => void run(actions.onOpenSeries!)}><strong className="text-[15px] font-bold text-zinc-100">Ouvrir la série</strong><small className="seenit-media-title text-[12.5px] font-bold">{title}</small></button>}
          <div role="separator" className="my-1 h-px bg-white/10" />
          {/* Plus de confirmation : le visionnage se retire et le toast propose Annuler (date exacte restaurée). */}
          <button type="button" role="menuitem" disabled={pending} className={item} onClick={() => void run(actions.onUnseen)}><strong className="text-[15px] font-bold text-rose-300">Marquer non vu</strong><small className="text-[12.5px] text-zinc-400">Annulable quelques secondes</small></button>
        </> : <div className="p-2 flex flex-col gap-3" role="group" aria-label="Vu le…">
          <div className="flex items-center gap-1"><button type="button" aria-label="Retour aux actions" className="w-11 h-11 -ml-1 grid place-items-center rounded-full text-zinc-300" onClick={() => setView('actions')}><ChevronLeft size={20} /></button><strong className="text-[15px] font-bold text-zinc-100">Vu le…</strong></div>
          <div className="flex flex-wrap gap-1.5">
            {days.map(day => <button key={day.offset} type="button" aria-pressed={draftDate === day.key} onClick={() => setDraftDate(day.key)} className={`min-h-11 px-3 rounded-xl text-[14px] font-bold ${draftDate === day.key ? 'bg-zinc-100 text-black' : 'bg-zinc-800 text-zinc-200'}`}>{day.label}</button>)}
            <label className={`min-h-11 px-3 rounded-xl text-[14px] font-bold flex items-center gap-2 ${otherDay ? 'bg-zinc-100 text-black' : 'bg-zinc-800 text-zinc-200'}`}><span>Autre jour</span><input type="date" aria-label="Autre jour" value={otherDay ? draftDate : ''} max={todayKey} onChange={event => setDraftDate(event.target.value)} className="w-[8.5rem] bg-transparent text-[13px] outline-none" /></label>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" aria-label="15 minutes plus tôt" onClick={() => setDraftTime(time => shiftTime(time, -15))} className="w-11 h-11 grid place-items-center rounded-xl bg-zinc-800 text-zinc-100"><Minus size={18} /></button>
            <input type="time" aria-label="Heure (facultative)" value={draftTime} onChange={event => setDraftTime(event.target.value)} className="flex-1 min-w-0 min-h-11 rounded-xl bg-zinc-950 px-3 text-center text-[16px] font-bold text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]" />
            <button type="button" aria-label="15 minutes plus tard" onClick={() => setDraftTime(time => shiftTime(time, 15))} className="w-11 h-11 grid place-items-center rounded-xl bg-zinc-800 text-zinc-100"><Plus size={18} /></button>
          </div>
          <p className="text-[12px] text-zinc-500">Heure vide : SeenIt ne l’invente pas.</p>
          <button type="button" disabled={pending || !draftDate} onClick={() => void run(() => actions.onSaveDate(draftDate, draftTime))} className="min-h-12 rounded-[14px] bg-[#E5A93D] text-black text-[15px] font-extrabold disabled:opacity-50">Enregistrer</button>
        </div>}
      </div>
    </DialogLayer>}
  </>;
}
