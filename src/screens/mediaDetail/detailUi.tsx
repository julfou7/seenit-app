import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { cn, openExternalUrl } from '../../lib/utils';
import { getFormattedProviderLogo, PLEX_LOGO_SVG } from '../../utils/providerLogos';
import { getProviderLinkPresentation } from '../../features/providers/providerLink';
import { minutesOfDay } from '../../features/shows/detailPlanning';

/**
 * SEENIT-UX-019 — Briques communes des fiches série, film et épisode, reprises du prototype
 * (« SeenIt Prototype », 24/10) : cartes zinc translucides, liseré or, titres 15–18 px, cibles 44 px.
 */
/** Heure courante en minutes, rafraîchie toutes les 30 s pour que « Fin à » reste juste. */
export function useClockMinutes(): number {
  const [now, setNow] = useState(() => minutesOfDay(new Date()));
  useEffect(() => {
    const timer = window.setInterval(() => setNow(minutesOfDay(new Date())), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

export const DETAIL_GOLD = '#E5A93D';
export const DETAIL_GOLD_TEXT = '#F2C36B';

export function DetailCard({ accent = false, className, children, ...rest }: React.HTMLAttributes<HTMLDivElement> & { accent?: boolean }) {
  return <div {...rest} className={cn('rounded-[20px] bg-[rgba(24,24,27,0.7)]', accent ? 'shadow-[inset_0_0_0_1px_rgba(229,169,61,0.3)]' : 'shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]', className)}>{children}</div>;
}

export function DetailSectionTitle({ children, aside, id }: { children: React.ReactNode; aside?: React.ReactNode; id?: string }) {
  return <div className="flex items-baseline justify-between gap-3"><h3 id={id} className="text-[18px] font-bold leading-tight text-white">{children}</h3>{aside}</div>;
}

export function DetailChip({ children, className, ...rest }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span {...rest} className={cn('inline-flex h-7 items-center gap-1 rounded-lg bg-[#18181b] px-2.5 text-[12px] font-bold text-zinc-200 whitespace-nowrap shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]', className)}>{children}</span>;
}

/** Bouton principal pleine largeur des fiches (or, « fait » ou neutre). */
export function GoldCta({ label, sub, onClick, tone = 'gold', disabled, ariaLabel, className }: { label: React.ReactNode; sub?: React.ReactNode; onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void; tone?: 'gold' | 'done' | 'neutral'; disabled?: boolean; ariaLabel?: string; className?: string }) {
  const toneClass = tone === 'gold' ? 'bg-[#E5A93D] text-black' : tone === 'done' ? 'bg-[rgba(229,169,61,0.14)] text-[#F2C36B] shadow-[inset_0_0_0_1px_rgba(229,169,61,0.5)]' : 'bg-[#18181b] text-zinc-100 shadow-[inset_0_0_0_1px_#3f3f46]';
  return <button type="button" onClick={onClick} disabled={disabled} aria-label={ariaLabel} className={cn('flex-1 min-w-0 h-[52px] rounded-[15px] px-3 flex flex-col items-center justify-center leading-tight active:scale-[0.98] transition-transform touch-manipulation disabled:opacity-60', toneClass, className)}><span className="text-[14px] font-extrabold truncate max-w-full inline-flex items-center">{label}</span>{sub && <span className="text-[11px] font-semibold opacity-75 truncate max-w-full">{sub}</span>}</button>;
}

export function RoundHeaderButton({ label, onClick, children, expanded }: { label: string; onClick: (event: React.MouseEvent<HTMLButtonElement>) => void; children: React.ReactNode; expanded?: boolean }) {
  return <button type="button" onClick={onClick} aria-label={label} aria-expanded={expanded} className="w-11 h-11 rounded-full bg-[rgba(9,9,11,0.7)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)] flex items-center justify-center text-white active:scale-95 transition-transform touch-manipulation">{children}</button>;
}

export function DetailHero({ imageUrl, title, meta, height = 300, children }: { imageUrl?: string | null; title: string; meta?: React.ReactNode; height?: number; children?: React.ReactNode }) {
  return <div className="relative w-full bg-zinc-900" style={{ height }}>
    {imageUrl && <img src={imageUrl} alt="" loading="eager" decoding="async" fetchPriority="high" className="absolute inset-0 w-full h-full object-cover" style={{ objectPosition: 'center 25%' }} />}
    <div className="absolute inset-0" style={{ background: 'linear-gradient(0deg,#09090b 2%,rgba(9,9,11,0.5) 45%,rgba(9,9,11,0.25) 100%)' }} />
    <div className="absolute left-5 right-5 bottom-3 flex flex-col gap-1.5">
      {title && title !== 'Chargement...' ? <h1 className="text-[32px] font-extrabold leading-[1.05] tracking-[-0.03em] text-[#F2C36B] [filter:drop-shadow(0_2px_10px_rgba(0,0,0,0.8))] line-clamp-3">{title}</h1> : <div className="h-8 w-48 rounded-lg bg-zinc-800/80 animate-pulse" />}
      {meta && <p className="text-[13px] text-zinc-300">{meta}</p>}
      {children}
    </div>
  </div>;
}

export interface WhereToWatchProvider {
  provider_id: number;
  provider_name: string;
  logo_path?: string | null;
  isPlex?: boolean;
  serverName?: string;
}

/**
 * « Où regarder » en lignes du prototype (logo 44 px, nom, mention, action). Le titre reste affiché
 * pendant le chargement et l'actualisation Plex garde sa cible de 44 px (SEENIT-PERF-001).
 */
export function WhereToWatchCard({ providers, loading, userPlatforms, title, fallbackLink, onOpenPlex, onRefreshPlex, refreshing, canRefresh, emptyLabel }: { providers: readonly WhereToWatchProvider[]; loading: boolean; userPlatforms: readonly number[]; title: string; fallbackLink?: string; onOpenPlex: (provider: WhereToWatchProvider) => void; onRefreshPlex?: () => void; refreshing?: boolean; canRefresh?: boolean; emptyLabel: string }) {
  return <DetailCard className="flex flex-col">
    <div className="flex items-center justify-between pl-3.5 pr-1 pt-1.5"><h3 className="text-[15px] font-bold text-white">Où regarder</h3>{onRefreshPlex && <button type="button" onClick={onRefreshPlex} disabled={!canRefresh || refreshing} aria-label="Actualiser Plex" title="Actualiser Plex" className="w-11 h-11 inline-flex items-center justify-center rounded-full text-zinc-500 hover:text-white disabled:opacity-60 active:scale-95"><RefreshCw size={16} className={cn(refreshing && 'animate-spin')} /></button>}</div>
    {providers.map((provider, index) => {
      if (provider.isPlex) return <button type="button" key={`plex-${index}`} onClick={() => onOpenPlex(provider)} className="flex items-center gap-3 min-h-[60px] pl-2.5 pr-3.5 py-2 border-t border-white/[0.06] text-left active:bg-white/5">
        <span className="w-11 h-11 rounded-[11px] overflow-hidden bg-[#1F2326] shrink-0 flex items-center justify-center"><img src={PLEX_LOGO_SVG} alt="" className="w-full h-full object-cover" /></span>
        <span className="flex-1 min-w-0 flex flex-col gap-0.5"><span className="text-[15px] font-bold text-white">Plex</span><span className="text-[12px] text-zinc-400 truncate">{provider.serverName ? `Sur ${provider.serverName}` : 'Sur ton serveur'}</span></span>
        <span className="text-[12px] font-bold text-[#E5A93D]">Lire</span>
      </button>;
      const subscribed = userPlatforms.includes(provider.provider_id);
      const link = getProviderLinkPresentation({ providerId: provider.provider_id, providerName: provider.provider_name, title, fallbackLink: fallbackLink || '#' });
      const directLink = link.url;
      const logoUrl = getFormattedProviderLogo(provider.logo_path, provider.provider_name);
      const body = <>
        <span className="w-11 h-11 rounded-[11px] overflow-hidden bg-zinc-800 shrink-0 flex items-center justify-center">{logoUrl ? <img src={logoUrl} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" /> : <span className="text-[13px] font-bold text-zinc-300">{provider.provider_name.slice(0, 2)}</span>}</span>
        <span className="flex-1 min-w-0 flex flex-col gap-0.5"><span className="text-[15px] font-bold text-white truncate">{link.label}</span><span className={cn('text-[12px] truncate', subscribed ? 'text-[#F2C36B]' : 'text-zinc-400')}>{subscribed ? 'Inclus dans ton abonnement' : 'Disponible en France'}</span></span>
        {directLink && <span className="text-[12px] font-bold text-[#E5A93D]">Ouvrir</span>}
      </>;
      if (!directLink) return <div key={`provider-${provider.provider_id}-${index}`} title={link.title} aria-label={link.title} className="flex items-center gap-3 min-h-[60px] pl-2.5 pr-3.5 py-2 border-t border-white/[0.06]">{body}</div>;
      return <a key={`provider-${provider.provider_id}-${index}`} href={directLink} target="_blank" rel="noopener noreferrer" title={link.title} onClick={event => { if (directLink !== '#') { event.preventDefault(); openExternalUrl(directLink); } }} className="flex items-center gap-3 min-h-[60px] pl-2.5 pr-3.5 py-2 border-t border-white/[0.06] active:bg-white/5">{body}</a>;
    })}
    {loading && <div className="flex items-center gap-3 min-h-[60px] pl-2.5 pr-3.5 py-2 border-t border-white/[0.06] text-zinc-400 text-[13px] animate-pulse"><span className="w-11 h-11 rounded-[11px] bg-[#1F2326] flex items-center justify-center"><img src={PLEX_LOGO_SVG} alt="" className="w-6 h-6" /></span><span>Recherche Plex & streaming…</span></div>}
    {!loading && providers.length === 0 && <p className="px-3.5 py-3 border-t border-white/[0.06] text-[13px] text-zinc-400">{emptyLabel}</p>}
  </DetailCard>;
}

/** Synopsis du prototype : 14 px, interligne 1,6, replié au-delà de quatre lignes. */
export function DetailSynopsis({ text, expanded, onToggle }: { text?: string | null; expanded: boolean; onToggle: () => void }) {
  if (!text) return null;
  const long = text.length > 220;
  return <div><p className={cn('m-0 text-[14px] leading-[1.6] text-zinc-300 [text-wrap:pretty]', !expanded && long && 'line-clamp-4')}>{text}</p>{long && <button type="button" onClick={onToggle} aria-expanded={expanded} className="mt-1 min-h-11 text-[13px] font-bold text-[#F2C36B]">{expanded ? 'Réduire' : 'Lire la suite'}</button>}</div>;
}
