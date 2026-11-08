import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { formatReleaseSize, VERSION_FILTERS, type DescribedRelease, type ReleaseLike, type VersionFilter } from '../features/downloads/releaseVersions';
import { releaseBadges, releaseReadableTitle } from '../features/downloads/releaseBadges';
import { cn } from '../lib/utils';

const SPEED_COLOR = { 3: '#86EFAC', 2: '#FCD34D', 1: '#FB7185' } as const;

/** Filtres de versions (maquette DlVersion) : une seule rangée de pastilles de 44 px. */
export function VersionFilterChips({ value, onChange }: { value: VersionFilter; onChange: (filter: VersionFilter) => void }) {
  return <div role="group" aria-label="Filtrer les versions" className="shrink-0 flex gap-2 overflow-x-auto hide-scrollbar">
    {VERSION_FILTERS.map(label => <button key={label} type="button" aria-pressed={value === label} onClick={() => onChange(label)}
      className={cn('h-11 shrink-0 px-4 rounded-full text-[14px] font-bold', value === label ? 'bg-zinc-100 text-black' : 'bg-[#1F1F23] text-zinc-300')}>{label}</button>)}
  </div>;
}

// La langue est déjà dans la ligne repliée (« Multi », « Français », « VO sous-titrée ») : ces badges la
// répéteraient. VFF et VFQ restent, ils précisent la version française.
const LANGUAGE_REPEATS = new Set(['MULTI', 'VF', 'VOSTFR']);

/**
 * Carte d'une version (maquette DlVersion), partagée par « Version précise » et la recherche avancée :
 * qualité, langue, taille et vitesse repliées ; dépliée, le type de release en badges (IMAX, HDR10…), sa
 * provenance et les actions. Le nom technique du fichier reste masqué derrière « Nom du fichier »
 * (retour terrain du 08/11). En recherche avancée (`technical`), la carte montre d'emblée le titre lisible
 * de la release (pour reconnaître le bon torrent) et ↑ seeders en vert, ↓ leechers en rouge au lieu de
 * la vitesse.
 */
export function ReleaseVersionCard<T extends ReleaseLike>({ entry, open, onToggle, details, technical = false, children }: { entry: DescribedRelease<T>; open: boolean; onToggle: () => void; details: string; technical?: boolean; children: React.ReactNode }) {
  const { release } = entry;
  const [showName, setShowName] = useState(false);
  // « Light » et la langue sont déjà dans la ligne repliée : pas de badge en double.
  const badges = releaseBadges(release.name).filter(badge => !LANGUAGE_REPEATS.has(badge));
  const seeders = Number(release.seeders) || 0;
  const leechers = Number(release.leechers) || 0;
  const readable = releaseReadableTitle(release.name);
  const readableTitle = [readable.title, readable.episode, readable.year].filter(Boolean).join(' · ');
  return <article data-version-card={release.id} className={cn('rounded-[18px] bg-[#161619] overflow-hidden', open && 'bg-[#1E1A12] shadow-[inset_0_0_0_1.5px_rgba(229,169,61,0.6)]')}>
    <button type="button" aria-expanded={open} onClick={onToggle} className="w-full min-h-[64px] flex items-center gap-3 px-3 py-2.5 text-left">
      <span className={cn('w-16 h-11 shrink-0 rounded-xl grid place-items-center text-[14.5px] font-extrabold', entry.quality === '4K' ? 'bg-zinc-100 text-black' : 'bg-[#2A2A2F] text-zinc-100')}>{entry.quality}</span>
      <span className="flex-1 min-w-0 flex flex-col gap-0.5">
        {technical && <span data-release-title className="text-[14px] font-bold leading-snug text-zinc-100 line-clamp-2 break-words">{readableTitle}</span>}
        <span className="flex items-center gap-2 min-w-0"><strong className="truncate text-[15px] font-extrabold">{entry.language}{entry.light ? ' · Light' : ''}</strong>{entry.recommended && <span className="shrink-0 rounded-md bg-[#E5A93D] px-1.5 text-[11.5px] font-extrabold leading-[1.6] text-black">Conseillée</span>}</span>
        {technical
          ? <span className="text-[13px] text-zinc-400">{formatReleaseSize(release.size)} · <span data-seeders className="font-bold text-[#86EFAC]"><span aria-hidden="true">↑ </span>{seeders.toLocaleString('fr-FR')}<span className="sr-only"> seeders</span></span> · <span data-leechers className="font-bold text-[#FB7185]"><span aria-hidden="true">↓ </span>{leechers.toLocaleString('fr-FR')}<span className="sr-only"> leechers</span></span></span>
          : <span className="text-[13px] text-zinc-400">{formatReleaseSize(release.size)} · <span className="font-bold" style={{ color: SPEED_COLOR[entry.speedLevel] }}>{'●'.repeat(entry.speedLevel)}{'○'.repeat(3 - entry.speedLevel)} {entry.speedLabel}</span></span>}
      </span>
      <ChevronDown size={20} aria-hidden="true" className={cn('shrink-0 text-zinc-500 transition-transform motion-reduce:transition-none', open && 'rotate-180')} />
    </button>
    {open && <div className="px-3 pb-3 flex flex-col gap-2">
      {!technical && <span data-release-title className="text-[13.5px] font-bold text-zinc-200 break-words">{readableTitle}</span>}
      {badges.length > 0 && <ul aria-label="Type de release" data-release-badges className="flex flex-wrap gap-1.5">
        {badges.map(badge => <li key={badge} className="h-7 px-2.5 rounded-lg bg-[#26262B] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] text-[12.5px] font-extrabold text-zinc-100 grid place-items-center">{badge}</li>)}
      </ul>}
      <span className="text-[12.5px] text-zinc-500">{details}</span>
      <button type="button" aria-expanded={showName} onClick={() => setShowName(!showName)} className="self-start min-h-11 -my-1 flex items-center gap-1 text-[12.5px] font-bold text-zinc-400">
        Nom du fichier<ChevronDown size={15} aria-hidden="true" className={cn('transition-transform motion-reduce:transition-none', showName && 'rotate-180')} />
      </button>
      {showName && <span data-release-name className="text-[13px] leading-[1.4] text-zinc-200 break-all">{release.name}</span>}
      {children}
    </div>}
  </article>;
}
