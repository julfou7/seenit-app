import React from 'react';
import { ChevronDown } from 'lucide-react';
import { formatReleaseSize, VERSION_FILTERS, type DescribedRelease, type ReleaseLike, type VersionFilter } from '../features/downloads/releaseVersions';
import { cn } from '../lib/utils';

const SPEED_COLOR = { 3: '#86EFAC', 2: '#FCD34D', 1: '#FB7185' } as const;

/** Filtres de versions (maquette DlVersion) : une seule rangée de pastilles de 44 px. */
export function VersionFilterChips({ value, onChange }: { value: VersionFilter; onChange: (filter: VersionFilter) => void }) {
  return <div role="group" aria-label="Filtrer les versions" className="shrink-0 flex gap-2 overflow-x-auto hide-scrollbar">
    {VERSION_FILTERS.map(label => <button key={label} type="button" aria-pressed={value === label} onClick={() => onChange(label)}
      className={cn('h-11 shrink-0 px-4 rounded-full text-[14px] font-bold', value === label ? 'bg-zinc-100 text-black' : 'bg-[#1F1F23] text-zinc-300')}>{label}</button>)}
  </div>;
}

/**
 * Carte d'une version (maquette DlVersion), partagée par « Version précise » et la recherche avancée :
 * qualité, langue, taille et vitesse repliées ; dépliée, le nom du fichier, sa provenance et les actions.
 */
export function ReleaseVersionCard<T extends ReleaseLike>({ entry, open, onToggle, details, children }: { entry: DescribedRelease<T>; open: boolean; onToggle: () => void; details: string; children: React.ReactNode }) {
  const { release } = entry;
  return <article data-version-card={release.id} className={cn('rounded-[18px] bg-[#161619] overflow-hidden', open && 'bg-[#1E1A12] shadow-[inset_0_0_0_1.5px_rgba(229,169,61,0.6)]')}>
    <button type="button" aria-expanded={open} onClick={onToggle} className="w-full min-h-[64px] flex items-center gap-3 px-3 py-2.5 text-left">
      <span className={cn('w-[58px] h-11 shrink-0 rounded-xl grid place-items-center text-[15px] font-extrabold', entry.quality === '4K' ? 'bg-zinc-100 text-black' : 'bg-[#2A2A2F] text-zinc-100')}>{entry.quality}</span>
      <span className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="flex items-center gap-2 min-w-0"><strong className="truncate text-[15px] font-extrabold">{entry.language}{entry.light ? ' · Light' : ''}</strong>{entry.recommended && <span className="shrink-0 rounded-md bg-[#E5A93D] px-1.5 text-[11.5px] font-extrabold leading-[1.6] text-black">Conseillée</span>}</span>
        <span className="text-[13px] text-zinc-400">{formatReleaseSize(release.size)} · <span className="font-bold" style={{ color: SPEED_COLOR[entry.speedLevel] }}>{'●'.repeat(entry.speedLevel)}{'○'.repeat(3 - entry.speedLevel)} {entry.speedLabel}</span></span>
      </span>
      <ChevronDown size={20} aria-hidden="true" className={cn('shrink-0 text-zinc-500 transition-transform motion-reduce:transition-none', open && 'rotate-180')} />
    </button>
    {open && <div className="px-3 pb-3 flex flex-col gap-2">
      <span className="text-[11px] font-extrabold tracking-[0.08em] text-zinc-500">NOM DU FICHIER</span>
      <span className="text-[13px] leading-[1.4] text-zinc-200 break-all">{release.name}</span>
      <span className="text-[12.5px] text-zinc-500">{details}</span>
      {children}
    </div>}
  </article>;
}
