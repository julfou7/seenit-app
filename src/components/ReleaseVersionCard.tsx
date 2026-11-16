import React, { useState } from 'react';
import { ChevronDown, ChevronLeft } from 'lucide-react';
import { formatReleaseSize, hasFrenchAudio, VERSION_FILTERS, type DescribedRelease, type ReleaseLike, type VersionFilter } from '../features/downloads/releaseVersions';
import { frenchVariant } from '../features/downloads/releaseAudio';
import { releaseBadges, releaseReadableTitle } from '../features/downloads/releaseBadges';
import { cn } from '../lib/utils';


/**
 * En-tête commun de « Version précise » et « Autre version ». Retour terrain du 16/11 (« place perdue en haut, ça me
 * gêne sur les deux ») : collé à la barre d'état, titre et média sur 2 lignes serrées. Cause racine (retour du 16/11 sur
 * la v1.4.330, « l'espace vide n'est pas supprimé ») : la page (`seenit-dialog-layer`) réserve déjà la barre d'état en
 * haut ; l'en-tête l'ajoutait une seconde fois. Il n'ajoute donc plus aucune marge haute.
 */
export function VersionPageHeader({ label, title, scope, onBack, disabled = false }: { label: string; title: string; scope: string; onBack: () => void; disabled?: boolean }) {
  return <header data-version-header className="shrink-0 flex items-center gap-1 px-2 pt-0 pb-1">
    <button type="button" onClick={onBack} disabled={disabled} aria-label="Retour" className="w-11 h-11 shrink-0 grid place-items-center rounded-full text-zinc-100 active:bg-white/10"><ChevronLeft size={24} /></button>
    <div className="min-w-0 leading-[1.15]">
      <h2 className="text-[17px] font-extrabold">{label}</h2>
      <p className="truncate text-[13px] text-zinc-400"><span className="seenit-media-title font-bold">{title}</span> · {scope}</p>
    </div>
  </header>;
}

/** Filtres de versions (maquette DlVersion) : une seule rangée de pastilles de 44 px. */
export function VersionFilterChips({ value, onChange }: { value: VersionFilter; onChange: (filter: VersionFilter) => void }) {
  return <div role="group" aria-label="Filtrer les versions" className="shrink-0 flex gap-2 overflow-x-auto hide-scrollbar">
    {VERSION_FILTERS.map(label => <button key={label} type="button" aria-pressed={value === label} onClick={() => onChange(label)}
      className={cn('h-11 shrink-0 px-4 rounded-full text-[14px] font-bold', value === label ? 'bg-zinc-100 text-black' : 'bg-[#1F1F23] text-zinc-300')}>{label}</button>)}
  </div>;
}

// La langue est déjà dans la ligne repliée (« Multi », « Français », « VO sous-titrée ») : ces badges la
// répéteraient. VFF et VFQ restent, ils précisent la version française.
// #661 (16/11) : VFF/VFQ passent dans la ligne de langue (« Multi VFF ») ; ils ne sont retirés des badges que
// lorsque cette ligne les affiche réellement (revue Codex #1080 : « MULTI.VFQ.VOSTFR » reste « VO sous-titrée »).
const LANGUAGE_REPEATS = new Set(['MULTI', 'VF', 'VOSTFR']);
const VARIANT_BADGES = new Set(['VFF', 'VFQ']);

/**
 * Carte d'une version (maquette DlVersion), partagée par « Version précise » et la recherche avancée :
 * qualité, langue, taille et vitesse repliées ; dépliée, le type de release en badges (IMAX, HDR10…), sa
 * provenance et les actions. Le nom technique du fichier reste masqué derrière « Nom du fichier »
 * (retour terrain du 08/11). En recherche avancée (`technical`), la carte montre d'emblée le titre lisible
 * de la release (pour reconnaître le bon torrent) et ↑ seeders en vert, ↓ leechers en rouge au lieu de
 * la vitesse.
 */
export function ReleaseVersionCard<T extends ReleaseLike>({ entry, open, onToggle, details, technical = false, current = false, spaceWarning, children }: { entry: DescribedRelease<T>; open: boolean; onToggle: () => void; details: string; technical?: boolean; current?: boolean; /** #1076 : version plus grosse que l'espace libre du disque de destination. */ spaceWarning?: string; children: React.ReactNode }) {
  const { release } = entry;
  const [showName, setShowName] = useState(false);
  // « Light » et la langue sont déjà dans la ligne repliée : pas de badge en double.
  // #661 : une version avec piste française dit toujours laquelle (VFF par défaut, VFQ quand le nom le marque).
  const variant = hasFrenchAudio(entry.language) ? frenchVariant(release.name) ?? 'VFF' : null;
  const badges = releaseBadges(release.name).filter(badge => !LANGUAGE_REPEATS.has(badge) && !(variant && VARIANT_BADGES.has(badge)));
  const seeders = Number(release.seeders) || 0;
  const leechers = Number(release.leechers) || 0;
  const readable = releaseReadableTitle(release.name);
  const readableTitle = [readable.title, readable.episode, readable.year].filter(Boolean).join(' · ');
  // Retour terrain du 16/11 (« Autre version » : une fine barre par version) : dans une liste en colonne qui défile,
  // la carte ne rétrécit jamais (`shrink-0`), sinon `overflow-hidden` l'écrase dès qu'il y a beaucoup de versions.
  // Retour terrain du 16/11 (« le fichier actuel n'est pas assez mis en valeur ») : la version actuelle porte un liseré vert.
  return <article data-version-card={release.id} className={cn('shrink-0 rounded-[18px] bg-[#161619] overflow-hidden', current && 'bg-[#10221A] shadow-[inset_0_0_0_1.5px_rgba(134,239,172,0.5)]', open && !current && 'bg-[#1E1A12] shadow-[inset_0_0_0_1.5px_rgba(229,169,61,0.6)]')} data-current={current || undefined}>
    <button type="button" aria-expanded={open} onClick={onToggle} className="w-full min-h-[64px] flex items-center gap-3 px-3 py-2.5 text-left">
      <span className={cn('w-16 h-11 shrink-0 rounded-xl grid place-items-center text-[14.5px] font-extrabold', entry.quality === '4K' ? 'bg-zinc-100 text-black' : 'bg-[#2A2A2F] text-zinc-100')}>{entry.quality}</span>
      <span className="flex-1 min-w-0 flex flex-col gap-0.5">
        {technical && <span data-release-title className="text-[14px] font-bold leading-snug text-zinc-100 line-clamp-2 break-words">{readableTitle}</span>}
        <span className="flex items-center gap-2 min-w-0"><strong className="truncate text-[15px] font-extrabold">{entry.language === 'Français' && variant ? variant : entry.language}{entry.language === 'Multi' && variant ? ` ${variant}` : ''}{entry.light ? ' · Light' : ''}</strong>{current && <span className="shrink-0 rounded-md bg-[#86EFAC] px-1.5 text-[11.5px] font-extrabold leading-[1.6] text-black">Actuelle</span>}{entry.recommended && !current && <span className="shrink-0 rounded-md bg-[#E5A93D] px-1.5 text-[11.5px] font-extrabold leading-[1.6] text-black">Conseillée</span>}</span>
        {technical
          ? <span className="text-[13px] text-zinc-400">{formatReleaseSize(release.size)} · <span data-seeders className="font-bold text-[#86EFAC]"><span aria-hidden="true">↑ </span>{seeders.toLocaleString('fr-FR')}<span className="sr-only"> seeders</span></span> · <span data-leechers className="font-bold text-[#FB7185]"><span aria-hidden="true">↓ </span>{leechers.toLocaleString('fr-FR')}<span className="sr-only"> leechers</span></span></span>
          // Retour terrain du 16/11 (« vire Rapide et Moyen ; c'est trop simple, il faut plus d'éléments pour choisir ») :
          // taille et nombre de sources, puis le type de release (source, codec, HDR, son, plateforme) dès la carte repliée.
          : <>
            <span className="text-[13px] text-zinc-400">{formatReleaseSize(release.size)}{seeders > 0 && <> · <span data-seeders className="font-bold text-zinc-200">{seeders.toLocaleString('fr-FR')} source{seeders > 1 ? 's' : ''}</span></>}</span>
            {spaceWarning && <span data-space-warning className="text-[12.5px] font-bold text-rose-300">{spaceWarning}</span>}
            {badges.length > 0 && <span data-release-badges className="mt-0.5 flex flex-wrap gap-1">
              {/* Revue Codex #1074 : 6 badges repliée, tous une fois dépliée. */}
              {(open ? badges : badges.slice(0, 6)).map(badge => <span key={badge} className="h-6 px-1.5 rounded-md bg-[#26262B] text-[11.5px] font-extrabold leading-6 text-zinc-200">{badge}</span>)}
            </span>}
          </>}
      </span>
      <ChevronDown size={20} aria-hidden="true" className={cn('shrink-0 text-zinc-500 transition-transform motion-reduce:transition-none', open && 'rotate-180')} />
    </button>
    {open && <div className="px-3 pb-3 flex flex-col gap-2">
      {!technical && <span data-release-title className="text-[13.5px] font-bold text-zinc-200 break-words">{readableTitle}</span>}
      {technical && badges.length > 0 && <ul aria-label="Type de release" data-release-badges className="flex flex-wrap gap-1.5">
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
