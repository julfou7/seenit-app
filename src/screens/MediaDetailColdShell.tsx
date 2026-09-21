import React from 'react';

interface MediaDetailColdShellProps {
  onBack: () => void;
  mediaType: 'tv' | 'movie';
  knownTitle?: string | null;
}

export function MediaDetailColdShell({ onBack, mediaType, knownTitle }: MediaDetailColdShellProps) {
  const isSeries = mediaType === 'tv';
  return (
    <div data-seenit-detail-warmup="cold" data-seenit-cold-shell="calm" aria-busy="true" className="flex-1 overflow-y-auto bg-black text-white relative w-full h-full pb-nav">
      <div className="relative min-h-[420px]">
        <div className="absolute top-0 inset-x-0 h-96 bg-zinc-900/60" />
        <div className="relative z-10 pt-10 px-4">
          <button type="button" onClick={onBack} className="w-10 h-10 bg-black/60 backdrop-blur-md rounded-full flex items-center justify-center border border-white/10 text-white text-xl" aria-label="Retour">‹</button>
          <div className="flex gap-4 mt-8">
            <div className="w-[120px] shrink-0 aspect-[2/3] bg-zinc-800/80 rounded-xl border border-white/10" />
            <div className="flex-1 min-w-0 flex flex-col justify-end gap-3 pb-1">
              <div className="flex gap-2">
                <span className="inline-flex items-center px-2 py-1 bg-[#E5A93D]/20 text-[10px] font-bold tracking-widest text-[#E5A93D] uppercase rounded-md border border-[#E5A93D]/30">{isSeries ? '📺 SÉRIE' : '🎬 FILM'}</span>
                <div className="h-5 w-16 bg-zinc-800/80 rounded-md" />
              </div>
              {knownTitle ? <h1 className="text-xl sm:text-2xl font-extrabold leading-tight text-white line-clamp-2">{knownTitle}</h1> : <div className="h-9 w-4/5 max-w-56 bg-zinc-800/80 rounded-lg" />}
              <div className="h-4 w-32 bg-zinc-800/80 rounded" />
              <div className="flex gap-2 min-h-[26px]"><div className="h-6 w-16 bg-zinc-800/80 rounded-lg" /></div>
            </div>
          </div>
          <div className="h-12 w-full bg-zinc-800/80 rounded-2xl mt-5" />
        </div>
      </div>
      <div className="px-4 mt-4">
        <div className="h-10 bg-zinc-900 rounded-full border border-white/5 p-1 flex items-center gap-1">
          <span className="flex-1 py-2 text-center text-xs font-bold tracking-wider uppercase rounded-full bg-zinc-800 text-[#E5A93D]">À propos</span>
          {isSeries && <span className="flex-1 py-2 text-center text-xs font-bold tracking-wider uppercase text-zinc-500">Épisodes</span>}
          <span className="flex-1 py-2 text-center text-xs font-bold tracking-wider uppercase text-zinc-500">Casting</span>
        </div>
      </div>
      <div className="p-4 space-y-6">
        <section><h3 className="text-xs font-bold uppercase text-zinc-500 tracking-wider mb-3">Synopsis</h3><div className="space-y-2"><div className="h-3.5 bg-zinc-800/80 rounded w-full" /><div className="h-3.5 bg-zinc-800/80 rounded w-11/12" /><div className="h-3.5 bg-zinc-800/80 rounded w-4/5" /></div></section>
        <section className="bg-zinc-900/40 border border-white/5 p-4 rounded-2xl"><h3 className="text-xs font-bold uppercase text-zinc-500 tracking-wider mb-3">Catégories & Thèmes</h3><div className="flex flex-wrap gap-2"><div className="h-7 w-20 bg-zinc-800/80 rounded-full" /><div className="h-7 w-24 bg-zinc-800/80 rounded-full" /><div className="h-7 w-16 bg-zinc-800/80 rounded-full" /></div></section>
        <section><h3 className="text-xs font-bold uppercase text-zinc-500 tracking-wider mb-3">Où regarder</h3><div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-white/10 bg-zinc-900/80 text-zinc-400 text-xs font-medium"><span className="w-4 h-4 rounded bg-zinc-700/80" aria-hidden="true" /><span>Recherche Plex & streaming…</span></div></section>
      </div>
    </div>
  );
}
