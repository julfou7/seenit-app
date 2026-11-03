import React from 'react';

interface MediaDetailColdShellProps {
  onBack: () => void;
  mediaType: 'tv' | 'movie';
  knownTitle?: string | null;
}

/**
 * Squelette froid au gabarit des fiches SEENIT-UX-019 : même hero, mêmes cartes et mêmes hauteurs que la
 * fiche finale, si bien qu'elle remplace le squelette sans saut. Aucune pulsation (SEENIT-PERF-001).
 */
export function MediaDetailColdShell({ onBack, mediaType, knownTitle }: MediaDetailColdShellProps) {
  const isSeries = mediaType === 'tv';
  const block = 'rounded-lg bg-zinc-800/80';
  return (
    <div data-seenit-detail-warmup="cold" data-seenit-cold-shell="calm" aria-busy="true" className="flex-1 overflow-y-auto bg-[#09090b] text-white relative w-full h-full pb-nav">
      <div className="sticky top-0 z-40 h-0">
        <div className="seenit-sheet-header absolute inset-x-3.5 flex justify-between">
          <button type="button" onClick={onBack} aria-label="Retour" className="w-11 h-11 rounded-full bg-[rgba(9,9,11,0.7)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)] flex items-center justify-center text-white text-xl">‹</button>
        </div>
      </div>
      <div className="relative w-full bg-zinc-900" style={{ height: isSeries ? 300 : 380 }}>
        <div className="absolute inset-0" style={{ background: 'linear-gradient(0deg,#09090b 2%,rgba(9,9,11,0.5) 45%,rgba(9,9,11,0.25) 100%)' }} />
        <div className="absolute left-5 right-5 bottom-3 flex flex-col gap-2">
          <span className="sr-only">{isSeries ? '📺 SÉRIE' : '🎬 FILM'}</span>
          {knownTitle ? <h1 className="text-[32px] font-extrabold leading-[1.05] tracking-[-0.03em] text-[#F2C36B] line-clamp-3">{knownTitle}</h1> : <div className={`${block} h-8 w-3/4`} />}
          <div className={`${block} h-3.5 w-1/2`} />
        </div>
      </div>
      <div className="px-4 pt-1.5 pb-8 flex flex-col gap-3.5">
        {isSeries
          ? <div className="rounded-[20px] bg-[rgba(24,24,27,0.7)] shadow-[inset_0_0_0_1px_rgba(229,169,61,0.3)] p-3.5 flex flex-col gap-3"><div className={`${block} h-4 w-1/3`} /><div className={`${block} h-1.5 w-full`} /><div className="flex gap-2"><div className="flex-1 h-[52px] rounded-[15px] bg-zinc-800/80" /><div className="w-[52px] h-[52px] rounded-[15px] bg-zinc-800/80" /></div></div>
          : <div className="flex gap-2"><div className="flex-1 h-[52px] rounded-[16px] bg-zinc-800/80" /><div className="w-[52px] h-[52px] rounded-[16px] bg-zinc-800/80" /><div className="w-[52px] h-[52px] rounded-[16px] bg-zinc-800/80" /></div>}
        <div className="flex gap-1.5"><div className={`${block} h-7 w-24`} /><div className={`${block} h-7 w-14`} /></div>
        <section aria-label="Synopsis" className="space-y-2"><div className={`${block} h-3.5 w-full`} /><div className={`${block} h-3.5 w-11/12`} /><div className={`${block} h-3.5 w-4/5`} /></section>
        <div className="flex flex-wrap gap-1.5" aria-label="Genres et thèmes"><div className={`${block} h-8 w-20`} /><div className={`${block} h-8 w-24`} /></div>
        <section className="rounded-[20px] bg-[rgba(24,24,27,0.7)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)] flex flex-col">
          <h3 className="px-3.5 pt-3.5 pb-1 text-[15px] font-bold text-white">Où regarder</h3>
          <div className="flex items-center gap-3 min-h-[60px] pl-2.5 pr-3.5 py-2 border-t border-white/[0.06] text-zinc-400 text-[13px]"><span className="w-11 h-11 rounded-[11px] bg-zinc-800/80" aria-hidden="true" /><span>Recherche Plex & streaming…</span></div>
        </section>
        <section aria-label={isSeries ? 'Personnages' : 'Casting'} className="flex flex-col gap-2.5">{[0, 1, 2].map(index => <div key={index} className="flex items-center gap-3"><div className="w-12 h-12 rounded-full bg-zinc-800/80" /><div className="flex-1 space-y-2"><div className={`${block} h-3.5 w-1/2`} /><div className={`${block} h-1 w-full`} /></div></div>)}</section>
      </div>
    </div>
  );
}
