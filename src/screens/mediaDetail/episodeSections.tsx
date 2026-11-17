import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import { DetailCard } from './detailUi';
import { SeenItCheckButton } from '../../components/SeenItCheckButton';
import { CompositorCelebration } from '../../components/SeenItCheckCelebration';
import { absoluteRatingHeight, formatRating, ratingTone, settleSeenToggle, type RatingTone } from '../../features/shows/detailPlanning';

/** SEENIT-UX-019 — Sections de la fiche épisode du prototype (« Pellicule + courbe »). */
export function EpisodeHeaderBlock({ code, title, airLabel, meta, isSeen, isFuture, futureLabel, onToggle }: { code: string; title: string; airLabel: string; meta: string; isSeen: boolean; isFuture: boolean; futureLabel: string; onToggle: () => unknown }) {
  const state = isSeen ? '✓ Vu' : isFuture ? futureLabel : 'À voir';
  return <div className="flex items-end gap-3">
    <div className="flex-1 min-w-0 flex flex-col gap-1"><span className="text-[13px] font-extrabold text-[#E5A93D]">{code}</span><h1 className="text-[30px] font-extrabold leading-[1.08] tracking-[-0.03em] text-white">{title}</h1><span className="text-[13px] text-zinc-300">{airLabel}</span>{meta && <span className="text-[13px] text-zinc-400">{meta}</span>}</div>
    {/* #857 : même bouton Vu que l'Accueil (anneau SeenIt animé), plus de pictogramme TV. Un épisode à venir
        ouvre d'abord la confirmation : pas d'animation tant qu'il n'est pas réellement marqué. */}
    <div className="w-[68px] shrink-0 flex flex-col items-center gap-1">
      <SeenItCheckButton {...(isFuture && !isSeen ? {} : { className: 'seenit-check--compositor', celebrationLayer: <CompositorCelebration /> })} isWatched={isSeen} title={isSeen ? 'Vu · toucher pour annuler' : isFuture ? `Pas encore diffusé · ${futureLabel}` : 'Marquer vu'} onClick={() => (isFuture && !isSeen ? (void onToggle(), false) : settleSeenToggle(onToggle()))} />
      <span className={cn('text-[11px] font-extrabold whitespace-nowrap', isSeen ? 'text-[#F2C36B]' : 'text-zinc-400')}>{state}</span>
    </div>
  </div>;
}

export interface PlannerBlock { key: string; label: string; runtime: number; end: string; onPick: () => void }

/** « Si tu lances maintenant · Fin à » : trois épisodes enchaînés, largeur proportionnelle à leur durée. */
export function EpisodePlannerCard({ heading, end, blocks, text }: { heading: string; end: string; blocks: readonly PlannerBlock[]; text: string }) {
  if (!blocks.length) return null;
  const tone = (index: number) => index === 0 ? { background: '#E5A93D', color: '#1a1206', boxShadow: 'none' } : index === 1 ? { background: 'rgba(229,169,61,0.18)', color: '#F2C36B', boxShadow: 'inset 0 0 0 1px rgba(229,169,61,0.5)' } : { background: '#27272a', color: '#a1a1aa', boxShadow: 'none' };
  return <DetailCard accent className="p-4 flex flex-col gap-3">
    <div className="flex justify-between items-end"><div className="flex flex-col gap-0.5"><span className="text-[13px] text-zinc-400">{heading}</span><span className="text-[34px] font-extrabold leading-none tracking-[-0.04em] text-[#E5A93D]">Fin à {end}</span></div></div>
    <div className="flex gap-[3px] h-7">{blocks.map((block, index) => <button type="button" key={block.key} onClick={block.onPick} aria-label={`Ouvrir ${block.label}, fin à ${block.end}`} className="rounded-[7px] flex items-center pl-2 text-[11px] font-extrabold" style={{ flex: block.runtime, ...tone(index) }}>{block.label}</button>)}</div>
    <div className="flex gap-[3px]" aria-hidden="true">{blocks.map(block => <span key={`end-${block.key}`} className="text-[11px] text-zinc-400 text-right pr-1" style={{ flex: block.runtime }}>{block.end}</span>)}</div>
    <span className="text-[13px] text-zinc-300">{text}</span>
  </DetailCard>;
}

export interface CurveCell { n: number; rating: number | null; aired: boolean; seen: boolean; current: boolean; onPick: () => void }

const BAR_MAX = 52;
const TONE_COLOR: Record<RatingTone, string> = { top: '#F2C36B', good: '#E5A93D', fair: '#8a6a2b', poor: 'rgba(251,113,133,0.75)' };
/** Chiffre au-dessus de la barre : même famille de couleur, assez claire pour être lue sur le fond sombre. */
const TONE_TEXT: Record<RatingTone, string> = { top: '#F2C36B', good: '#E5A93D', fair: '#bfa06a', poor: '#FB7185' };

/**
 * Notes TMDB de la saison et cases d'épisode (or = vu, contour or = épisode affiché). Retour terrain du 17/11 (« je ne
 * différencie pas un 8 d'un 3 ; sur un épisode pas encore sorti je n'ai aucune idée des précédents ») : une colonne par
 * épisode, alignée sur sa case, avec la note écrite et une barre sur l'échelle fixe 0–10 colorée par niveau ; un épisode
 * à venir garde une barre pointillée ; la moyenne de la saison est toujours dite.
 */
export function SeasonCurveCard({ label, summary, rankLabel, cells }: { label: string; summary: string | null; rankLabel: string | null; cells: readonly CurveCell[] }) {
  const strip = React.useRef<HTMLDivElement>(null);
  const currentN = cells.find(cell => cell.current)?.n;
  // Une longue saison défile au lieu de serrer les notes (30 px au moins par colonne) ; elle s'ouvre sur l'épisode affiché.
  React.useEffect(() => {
    const row = strip.current;
    const target = row?.querySelector<HTMLElement>(`[data-rating-cell="${currentN}"]`);
    if (row && target && row.scrollWidth > row.clientWidth) row.scrollLeft = Math.max(0, target.offsetLeft - (row.clientWidth - target.offsetWidth) / 2);
  }, [currentN, cells.length]);
  if (!cells.length) return null;
  const rated = cells.some(cell => cell.rating !== null);
  return <DetailCard className="px-3.5 pt-3.5 pb-1.5 flex flex-col gap-1.5" data-season-ratings>
    <div className="flex justify-between items-baseline gap-2"><span className="text-[13px] font-bold text-white">{label}</span>{summary && <span className="shrink-0 text-[12px] font-bold text-zinc-300">{summary}</span>}</div>
    {rankLabel && <span className="text-[12px] font-bold text-[#F2C36B]">{rankLabel}</span>}
    <div ref={strip} className="flex gap-0.5 overflow-x-auto hide-scrollbar">{cells.map(cell => {
      const tone = cell.rating !== null ? ratingTone(cell.rating) : null;
      const value = cell.rating !== null ? formatRating(cell.rating) : cell.aired ? '–' : '';
      return <button type="button" key={`cell-${cell.n}`} onClick={cell.onPick} data-rating-cell={cell.n}
        aria-label={`Épisode ${cell.n}${cell.rating !== null ? `, note ${formatRating(cell.rating)}` : cell.aired ? ', note inconnue' : ', pas encore diffusé'}${cell.seen ? ', vu' : ''}`}
        aria-current={cell.current ? 'true' : undefined} className="flex-1 shrink-0 min-w-[30px] flex flex-col items-center gap-1 pb-1.5">
        {rated && <span aria-hidden="true" className={cn('text-[10.5px] font-extrabold leading-none tabular-nums h-3', cell.current ? 'text-white' : 'text-zinc-300')} style={tone && !cell.current ? { color: TONE_TEXT[tone] } : undefined}>{value}</span>}
        {rated && <span aria-hidden="true" className="w-full flex items-end justify-center" style={{ height: BAR_MAX }}>
          {cell.rating !== null
            ? <i data-rating-bar className="block w-[70%] rounded-t-[4px]" style={{ height: absoluteRatingHeight(cell.rating, BAR_MAX), background: TONE_COLOR[tone!], boxShadow: cell.current ? '0 0 0 1.5px #fff' : 'none' }} />
            : <i className="block w-[70%] h-[3px] border-t-2 border-dashed border-zinc-600" />}
        </span>}
        <span className="w-full h-[26px] rounded-[5px] flex items-center justify-center text-[10px] font-extrabold" style={{ background: cell.current ? 'rgba(229,169,61,0.14)' : cell.seen ? '#E5A93D' : '#27272a', boxShadow: cell.current ? 'inset 0 0 0 2px #E5A93D' : 'none', color: cell.current ? '#F2C36B' : cell.seen ? '#1a1206' : '#a1a1aa' }}>{cell.n}</span>
      </button>;
    })}</div>
  </DetailCard>;
}

/** Résumé masqué tant que l'épisode précédent n'est pas vu (anti-spoiler du prototype), révélable au toucher. */
export function SpoilerSynopsis({ text, hidden, why, onReveal, expanded, onToggle }: { text?: string | null; hidden: boolean; why: string; onReveal: () => void; expanded: boolean; onToggle: () => unknown }) {
  if (!text) return null;
  if (hidden) return <button type="button" onClick={onReveal} className="flex items-center gap-3 p-3.5 rounded-2xl bg-[rgba(24,24,27,0.7)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] text-left"><span className="text-[20px]" aria-hidden="true">🙈</span><span className="flex-1 flex flex-col gap-0.5"><span className="text-[14px] font-bold text-white">Résumé masqué</span><span className="text-[12px] text-zinc-400">{why} · toucher pour afficher</span></span></button>;
  const long = text.length > 220;
  return <div><p className={cn('m-0 text-[14px] leading-[1.6] text-zinc-300 [text-wrap:pretty]', !expanded && long && 'line-clamp-4')}>{text}</p>{long && <button type="button" onClick={onToggle} aria-expanded={expanded} className="mt-1 min-h-11 text-[13px] font-bold text-[#F2C36B]">{expanded ? 'Réduire' : 'Lire la suite'}</button>}</div>;
}

export const EPISODE_REACTIONS = [['👎', 'bof', 'Bof'], ['👍', 'bien', 'Bien'], ['❤️', 'adore', 'J’adore']] as const;

export function ReactionRow({ value, onPick }: { value?: string; onPick: (emotion: string) => void }) {
  return <div className="flex items-center gap-2" role="group" aria-label="Ta réaction"><span className="text-[13px] text-zinc-400 flex-1">Ta réaction</span>{EPISODE_REACTIONS.map(([emoji, key, label]) => <button type="button" key={key} onClick={() => onPick(key)} aria-label={label} aria-pressed={value === key} className="w-[52px] h-11 rounded-xl flex items-center justify-center text-[20px]" style={{ background: value === key ? 'rgba(229,169,61,0.2)' : 'rgba(24,24,27,0.7)', boxShadow: `inset 0 0 0 1px ${value === key ? '#E5A93D' : 'rgba(255,255,255,0.1)'}` }}>{emoji}</button>)}</div>;
}

/** Précédent / Suivant explicites (SEENIT-UX-008), en plus du swipe et des flèches clavier. */
export function EpisodeNavRow({ prevLabel, nextLabel, hasPrevious, hasNext, disabled, onPrevious, onNext }: { prevLabel: string; nextLabel: string; hasPrevious: boolean; hasNext: boolean; disabled: boolean; onPrevious: () => void; onNext: () => void }) {
  const base = 'min-h-[44px] px-3 rounded-xl flex items-center gap-1.5 text-[13px] font-bold bg-[rgba(24,24,27,0.7)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] disabled:opacity-35 disabled:cursor-not-allowed';
  return <nav aria-label="Navigation entre épisodes" className="flex items-center justify-between gap-2">
    <button type="button" aria-label="Épisode précédent" disabled={!hasPrevious || disabled} onClick={event => { event.stopPropagation(); onPrevious(); }} className={cn(base, 'text-zinc-200')}><ChevronLeft size={18} aria-hidden="true" />{prevLabel}</button>
    <span className="text-[12px] font-semibold text-zinc-500 text-center">glisse pour changer d’épisode</span>
    <button type="button" aria-label="Épisode suivant" disabled={!hasNext || disabled} onClick={event => { event.stopPropagation(); onNext(); }} className={cn(base, 'text-zinc-200')}>{nextLabel}<ChevronRight size={18} aria-hidden="true" /></button>
  </nav>;
}

/**
 * #857 — Squelette de la fiche épisode au gabarit actuel (image, en-tête avec l'anneau Vu, « Fin à », courbe de
 * saison, résumé), affiché pendant l'hydratation au lieu de l'ancienne page.
 */
export function EpisodeDetailSkeleton({ code, title }: { code: string; title?: string | null }) {
  const bar = 'rounded bg-zinc-800/80 animate-pulse';
  return <div className="w-full" data-episode-skeleton="">
    <div className="relative w-full h-[250px] bg-zinc-900 overflow-hidden"><div className="absolute inset-0" style={{ background: 'linear-gradient(0deg,#09090b 0%,rgba(9,9,11,0.35) 50%,rgba(9,9,11,0.3) 100%)' }} /></div>
    <div className="px-[18px] -mt-11 relative z-10 flex flex-col gap-3.5 pb-nav" aria-hidden="true">
      <div className="flex items-end gap-3">
        <div className="flex-1 min-w-0 flex flex-col gap-1.5"><span className="text-[13px] font-extrabold text-[#E5A93D]">{code}</span>{title ? <span className="text-[30px] font-extrabold leading-[1.08] tracking-[-0.03em] text-white line-clamp-2">{title}</span> : <div className={cn(bar, 'h-8 w-4/5 rounded-lg')} />}<div className={cn(bar, 'h-3.5 w-40')} /></div>
        <div className="w-[68px] shrink-0 flex flex-col items-center gap-1"><div className="w-12 h-12 rounded-full bg-zinc-800/80 animate-pulse" /><div className={cn(bar, 'h-3 w-10')} /></div>
      </div>
      <DetailCard accent className="p-4 flex flex-col gap-3"><div className={cn(bar, 'h-3.5 w-36')} /><div className={cn(bar, 'h-8 w-44 rounded-lg')} /><div className={cn(bar, 'h-7 w-full rounded-[7px]')} /></DetailCard>
      <DetailCard className="p-3.5 flex flex-col gap-2.5"><div className={cn(bar, 'h-3.5 w-32')} /><div className={cn(bar, 'h-[62px] w-full rounded-lg')} /></DetailCard>
      <div className="flex flex-col gap-2"><div className={cn(bar, 'h-3.5 w-full')} /><div className={cn(bar, 'h-3.5 w-11/12')} /><div className={cn(bar, 'h-3.5 w-4/5')} /></div>
    </div>
  </div>;
}
