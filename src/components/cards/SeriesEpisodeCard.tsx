import React, { useEffect, useId, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Bell, X } from 'lucide-react';
import type { Show } from '../../types';
import { SeenItCheckButton } from '../SeenItCheckButton';
import { DialogLayer } from '../ui/DialogLayer';
import { buildSeriesSeasonProgress, imageUrl, seriesCardPosterCandidates, seriesCardPosterCrossOrigin, seriesEpisodeCode, upcomingCardTone, type SeriesCardEpisode, type SeasonSegmentState } from '../../features/watchlist/seriesCardPresentation';
import { dominantPosterHue, POSTER_HUE_FALLBACK, readPosterHue, rememberPosterHue } from '../../features/watchlist/posterHue';
import './seriesEpisodeCard.css';

export interface SeriesCardAction { label: string; onSelect: () => void | Promise<void>; destructive?: boolean }
type Context =
  | { kind: 'watch'; onMarkSeen?: () => void | Promise<void>; upToDate?: boolean }
  | { kind: 'upcoming'; days: number; reminder: boolean; pending: boolean; onToggleReminder: (event: React.MouseEvent) => void | Promise<void> }
  | { kind: 'history'; watchedAt: number; onUnseen: () => void };

interface Props {
  show: Show;
  episode: SeriesCardEpisode | null;
  context: Context;
  detail?: string;
  providerLogo?: string | null;
  providerName?: string | null;
  onOpen: () => void;
  onOpenSeries?: () => void;
  onOpenEpisode?: () => void;
  actions?: SeriesCardAction[];
  layout?: 'rail' | 'list';
}

const segmentNames: Record<SeasonSegmentState, string> = {
  seen: 'Vu', current: 'Prochain épisode', unseen: 'Diffusé, non vu', future: 'À venir', history: 'Épisode de cet historique', unknown: 'Diffusion à confirmer',
};

const BADGE_DETAIL = /^(?:🔥|🌟|🆕|🏁|⏳)/u;
const REMAINING_DETAIL = /\brestant(?:s)?\b/i;

export function SeriesEpisodeCard({ show, episode, context, detail, providerLogo, providerName, onOpen, onOpenSeries, onOpenEpisode, actions = [], layout = 'list' }: Props) {
  const posterCandidates = seriesCardPosterCandidates(show);
  const posterCandidatesKey = posterCandidates.join('\u0000');
  const [posterIndex, setPosterIndex] = useState(0);
  const poster = posterCandidates[posterIndex] ?? null;
  const posterCrossOrigin = seriesCardPosterCrossOrigin(poster, Capacitor.isNativePlatform());
  const [hue, setHue] = useState(() => readPosterHue(poster) ?? POSTER_HUE_FALLBACK);
  const [menuOpen, setMenuOpen] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const titleId = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const moved = useRef(false);
  const pointerActive = useRef(false);
  const origin = useRef({ x: 0, y: 0 });
  const cancel = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; pointerActive.current = false; };
  useEffect(() => { setPosterIndex(0); }, [posterCandidatesKey]);
  useEffect(() => { setHue(readPosterHue(poster) ?? POSTER_HUE_FALLBACK); }, [poster]);
  useEffect(() => cancel, []);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const progress = episode ? buildSeriesSeasonProgress(show, episode, context.kind, today) : {
    label: 'À actualiser', description: 'Épisode de reprise à confirmer', continuous: false, segments: [], totalUnknown: true, unknownTail: false, knownEpisodes: 0, availableUnseen: 0,
  };
  const code = episode ? seriesEpisodeCode(episode) : 'Épisode à confirmer';
  const requestedDetail = detail?.trim() && !REMAINING_DETAIL.test(detail) ? detail.trim() : undefined;
  const visibleDetail = requestedDetail || progress.detail;
  const detailIsBadge = visibleDetail ? BADGE_DETAIL.test(visibleDetail) : false;
  const watchedDate = context.kind === 'history' ? new Date(context.watchedAt) : null;
  const validWatchedDate = watchedDate && Number.isFinite(watchedDate.getTime());
  const watchedTime = validWatchedDate ? watchedDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : 'Heure inconnue';
  const initials = show.title.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase();
  const menuActions: SeriesCardAction[] = [
    { label: 'Ouvrir la série', onSelect: onOpenSeries || onOpen },
    ...(onOpenEpisode ? [{ label: 'Voir l’épisode', onSelect: onOpenEpisode }] : []),
    ...(context.kind === 'watch' && context.onMarkSeen && !context.upToDate ? [{ label: 'Marquer cet épisode comme vu', onSelect: context.onMarkSeen }] : []),
    ...(context.kind === 'history' ? [{ label: 'Marquer comme non vu', onSelect: context.onUnseen }] : []),
    ...actions,
  ];
  const handlePosterLoad = (image: HTMLImageElement) => {
    if (!poster) return;
    const cachedHue = readPosterHue(poster);
    if (cachedHue !== undefined) { setHue(cachedHue); return; }
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 16; canvas.height = 24;
      const drawing = canvas.getContext('2d', { willReadFrequently: true });
      if (!drawing) return;
      drawing.drawImage(image, 0, 0, 16, 24);
      const value = dominantPosterHue(drawing.getImageData(0, 0, 16, 24).data);
      rememberPosterHue(poster, value); setHue(value);
    } catch { /* Une image sans CORS garde sa présentation et la teinte de secours. */ }
  };

  return <>
    <article className={`series-8f series-8f--${layout}`} aria-labelledby={titleId} style={{ '--series-hue': hue } as React.CSSProperties} data-series-card="8f" data-context={context.kind}>
      <div className="series-8f__surface" aria-hidden="true">
        {show.backdropPath && <img className="series-8f__backdrop" src={imageUrl(show.backdropPath, 'w500')!} loading="lazy" decoding="async" alt="" onError={event => { event.currentTarget.style.visibility = 'hidden'; }} />}
        <div className="series-8f__veil" />
      </div>
      <button type="button" className="series-8f__open" aria-label={`Ouvrir ${show.title}, ${code}${episode?.name ? `, ${episode.name}` : ''}`} aria-haspopup="dialog" onClick={event => { const ignore = event.detail > 0 && (held.current || moved.current); held.current = false; moved.current = false; if (!ignore) onOpen(); }}
        onPointerDown={event => { if (event.button !== 0) return; cancel(); pointerActive.current = true; held.current = false; moved.current = false; origin.current = { x: event.clientX, y: event.clientY }; timer.current = setTimeout(() => { held.current = true; setMenuOpen(true); }, 480); }}
        onPointerMove={event => { if (pointerActive.current && Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > 8) { moved.current = true; cancel(); } }}
        onPointerUp={cancel} onPointerCancel={cancel} onPointerLeave={cancel}
        onContextMenu={event => { event.preventDefault(); cancel(); setMenuOpen(true); }}
        onKeyDown={event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); setMenuOpen(true); } }} />
      <div className="series-8f__poster" aria-hidden="true">
        <span>{initials}</span>
        {poster && <img src={poster} crossOrigin={posterCrossOrigin} alt="" loading="lazy" decoding="async" onLoad={event => handlePosterLoad(event.currentTarget)} onError={() => setPosterIndex(index => index + 1)} />}
      </div>
      <div className="series-8f__text">
        <h3 id={titleId}>{show.title}</h3>
        <div className="series-8f__code"><strong>{code}</strong>{visibleDetail && (detailIsBadge ? <span className="series-8f__badge">{visibleDetail}</span> : <span> · {visibleDetail}</span>)}</div>
        <p>{context.kind === 'watch' && context.upToDate ? 'À jour' : episode?.name || (episode ? `Épisode ${episode.episode_number}` : 'Reprise à actualiser')}</p>
      </div>
      <div className="series-8f__season">
        <div className={`series-8f__segments${progress.continuous ? ' series-8f__segments--continuous' : ''}`} role="img" aria-label={progress.description}>
          {progress.segments.map((segment, index) => <span key={index} className={`series-8f__segment series-8f__segment--${segment.state}`} style={{ flexGrow: segment.count }} title={`${segment.episode ? `Épisode ${segment.episode} : ` : ''}${segmentNames[segment.state]}`} />)}
          {progress.unknownTail && <><span className="series-8f__unknown-tail" aria-hidden="true" /><span className="series-8f__unknown-mark" aria-hidden="true" title="Nombre d'épisodes encore inconnu">?</span></>}
        </div>
        {providerLogo && <button type="button" className="series-8f__provider" aria-label={`Où regarder ${show.title} : ${providerName || 'diffuseur'}`} onClick={onOpenSeries || onOpen}><img src={providerLogo} alt="" loading="lazy" onError={event => { event.currentTarget.style.visibility = 'hidden'; }} /></button>}
      </div>
      <div className="series-8f__action">
        {context.kind === 'watch' && !context.upToDate && context.onMarkSeen && <SeenItCheckButton size={34} className="series-8f__check" title={`Marquer ${show.title} ${code} comme vu`} onClick={async () => { await context.onMarkSeen?.(); }} />}
        {context.kind === 'upcoming' && <button type="button" className={`series-8f__days series-8f__days--${upcomingCardTone(context.days)}`} disabled={context.pending} aria-busy={context.pending || undefined} aria-pressed={context.reminder} aria-label={`${context.reminder ? 'Désactiver' : 'Activer'} le rappel de ${show.title} ${code}, ${context.days === 0 ? 'aujourd’hui' : `dans ${context.days} jours`}`} onClick={context.onToggleReminder}>
          <span className={`series-8f__bell${context.reminder ? ' series-8f__bell--active' : ''}`}><Bell size={14} fill={context.reminder ? 'currentColor' : 'none'} /></span>
          <strong>{context.days <= 0 ? '🔥' : context.days}</strong><small>{context.days <= 0 ? 'ce soir' : 'jours'}</small>
        </button>}
        {context.kind === 'history' && <button type="button" className="series-8f__history" aria-label={`Actions de ${show.title} ${code}, vu à ${watchedTime}`} aria-haspopup="dialog" onClick={() => setMenuOpen(true)}><span aria-hidden="true">✓</span><time dateTime={validWatchedDate ? watchedDate.toISOString() : undefined}>{watchedTime}</time></button>}
      </div>
    </article>
    {menuOpen && <DialogLayer label={`Actions de ${show.title}`} onDismiss={() => setMenuOpen(false)} className="fixed inset-0 flex items-end sm:items-center justify-center bg-black/65 p-4 pb-nav">
      <section className="w-full max-w-md rounded-3xl border border-white/10 bg-zinc-950 p-4 shadow-2xl">
        <div className="flex items-center justify-between gap-3 mb-2"><h2 className="font-bold text-white">{show.title}</h2><button type="button" aria-label="Fermer les actions" data-dialog-initial-focus className="min-h-11 min-w-11 grid place-items-center rounded-xl text-zinc-300" onClick={() => setMenuOpen(false)}><X size={20} /></button></div>
        {menuActions.map(action => <button key={action.label} type="button" disabled={actionPending} className={`w-full min-h-11 text-left px-3 py-3 rounded-xl hover:bg-white/5 disabled:opacity-50 ${action.destructive ? 'text-rose-300' : 'text-zinc-100'}`} onClick={async () => { if (actionPending) return; setActionPending(true); try { setMenuOpen(false); await action.onSelect(); } finally { setActionPending(false); } }}>{action.label}</button>)}
      </section>
    </DialogLayer>}
  </>;
}
