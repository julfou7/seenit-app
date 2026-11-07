import React, { useState } from 'react';
import { type Show } from '../../types';
import { cn, getTodayStr } from '../../lib/utils';
import { mediaKeyFrom } from '../../features/shows/mediaRelations';
import { frenchCharacterName } from '../../features/shows/frenchLabels';
import { DetailCard, DetailChip, DetailSectionTitle } from './detailUi';
import { LoadMore, useRevealFocus } from '../../components/cards/HomeLoadMore';
import { SeenItWatchedStamp } from '../../components/cards/SeenItWatchedStamp';

type CastMember = { id: number; name: string; gender?: number | null; profile_path?: string | null; character?: string; roles?: Array<{ character?: string; episode_count?: number }>; total_episode_count?: number; episode_count?: number };

const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();

/**
 * Personnages (série) ou Casting (film) en lignes du prototype : portrait rond 48 px, personnage,
 * nombre d'épisodes et barre de présence pour une série, interprète en gris. Six lignes, puis tout.
 */
export function CastRows({ cast, isSeries, totalEpisodes, loading, onOpenPerson }: { cast: readonly CastMember[]; isSeries: boolean; totalEpisodes: number; loading: boolean; onOpenPerson: (personId: number) => void }) {
  const [showAll, setShowAll] = useState(false);
  const reveal = useRevealFocus<HTMLElement>('[data-cast-row]');
  const title = isSeries ? 'Personnages' : 'Casting';
  if (loading) return <section className="flex flex-col gap-2.5" aria-hidden="true" data-seenit-casting-loading="true"><DetailSectionTitle>{title}</DetailSectionTitle>{[0, 1, 2].map(index => <div key={index} className="flex items-center gap-3 animate-pulse"><div className="w-12 h-12 rounded-full bg-zinc-800/80" /><div className="flex-1 space-y-2"><div className="h-3.5 w-1/2 rounded bg-zinc-800/80" /><div className="h-1 w-full rounded bg-zinc-800/60" /></div></div>)}</section>;
  if (cast.length === 0) return null;
  const visible = showAll ? cast : cast.slice(0, 6);
  return <section ref={reveal.containerRef} className="flex flex-col gap-2.5" aria-labelledby="detail-cast-title">
    <DetailSectionTitle id="detail-cast-title">{title}</DetailSectionTitle>
    {visible.map((actor, index) => {
      const character = frenchCharacterName(actor.roles?.length ? actor.roles.map(role => role.character).filter(Boolean).join(' / ') : actor.character, actor.gender);
      const episodes = Number(actor.total_episode_count || actor.episode_count || 0);
      const presence = isSeries && totalEpisodes > 0 ? Math.min(100, Math.round((episodes / totalEpisodes) * 100)) : 0;
      return <button type="button" data-cast-row key={`cast-${actor.id}-${index}`} onClick={() => onOpenPerson(actor.id)} aria-label={`Ouvrir la fiche de ${actor.name}`} className="min-h-11 flex items-center gap-3 text-left active:opacity-80">
        <span className="w-12 h-12 rounded-full overflow-hidden bg-zinc-800 shrink-0 flex items-center justify-center text-[14px] font-extrabold text-white/45">{actor.profile_path ? <img src={`https://image.tmdb.org/t/p/w185${actor.profile_path}`} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover object-[50%_25%]" /> : initialsOf(character || actor.name)}</span>
        <span className="flex-1 min-w-0 flex flex-col gap-[3px]">
          <span className="flex justify-between gap-2"><span className="text-[15px] font-bold text-white line-clamp-2 min-h-[1.1em]">{character || 'Rôle inconnu'}</span>{isSeries && episodes > 0 && <span className="text-[12px] text-zinc-400 shrink-0">{episodes} ép.</span>}</span>
          {isSeries && presence > 0 && <span className="h-1 rounded-sm bg-zinc-800 overflow-hidden"><span className="block h-1 rounded-sm bg-[#E5A93D]" style={{ width: `${presence}%` }} /></span>}
          <span className="text-[12px] text-zinc-500 truncate">{actor.name}</span>
        </span>
      </button>;
    })}
    {/* #873 : le seul « Afficher plus » de l'app (portraits des suivants) ; « Réduire » reste une action secondaire. */}
    {cast.length > 6 && !showAll && <LoadMore round previews={cast.slice(6, 9).map((actor, index) => ({ key: `cast-more-${actor.id}-${index}`, initial: initialsOf(actor.name || '?'), imagePath: actor.profile_path }))} remainingCount={cast.length - 6} step={cast.length} onLoad={() => { setShowAll(true); reveal.focusItem(6); }} />}
    {cast.length > 6 && showAll && <button type="button" onClick={() => { setShowAll(false); reveal.focusLoadMore(); }} aria-expanded className="self-center min-h-11 px-4 text-[13px] font-bold text-zinc-400">Réduire</button>}
  </section>;
}

/**
 * Genres et thèmes juste sous le synopsis, en une rangée de pastilles de même hauteur (32 px) alignées ;
 * « +N thèmes » a l'allure d'une pastille et garde une cible de 44 px (SEENIT-UX-009).
 */
export function ThemesCard({ genres, keywords, expanded, onToggle, loading }: { genres: ReadonlyArray<{ id: number; name: string }>; keywords: readonly string[]; expanded: boolean; onToggle: () => void; loading: boolean }) {
  if (loading) return <div className="flex flex-wrap gap-1.5" aria-hidden="true"><div className="h-8 w-20 rounded-lg bg-zinc-800/80 animate-pulse" /><div className="h-8 w-24 rounded-lg bg-zinc-800/80 animate-pulse" /></div>;
  if (!genres.length && !keywords.length) return null;
  const chip = 'inline-flex h-8 items-center rounded-lg px-3 text-[12px] font-bold whitespace-nowrap';
  return <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Genres et thèmes">
    {genres.map((genre, index) => <span key={`genre-${genre.id}-${index}`} className={cn(chip, 'bg-[#18181b] text-zinc-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]')}>{genre.name}</span>)}
    <span id="series-theme-keywords" className="contents">{expanded && keywords.map((keyword, index) => <span key={`kw-${index}`} className={cn(chip, 'bg-transparent text-zinc-300 font-semibold shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] first-letter:uppercase')}>{keyword}</span>)}</span>
    {keywords.length > 0 && <button type="button" onClick={onToggle} aria-expanded={expanded} aria-controls="series-theme-keywords" className="relative inline-flex h-8 items-center rounded-lg px-3 text-[12px] font-bold text-[#F2C36B] shadow-[inset_0_0_0_1px_rgba(229,169,61,0.4)] before:absolute before:-inset-y-1.5 before:inset-x-0 before:content-['']">{expanded ? 'Masquer les thèmes' : `+${keywords.length} thèmes`}</button>}
  </div>;
}

type RelationPart = { id: number; title?: string; name?: string; poster_path?: string | null; release_date?: string; first_air_date?: string; media_type?: string; seenitRelationKind?: string; runtime?: number | null };

function libraryState(part: RelationPart, shows: readonly Show[]): { label: string; seen: boolean; inLibrary: boolean } {
  const mediaType = part.media_type || (part.title ? 'movie' : 'tv');
  const match = shows.find(show => Number(show.tmdbId) === Number(part.id) && (show.mediaType || 'tv') === mediaType);
  const date = part.release_date || part.first_air_date || '';
  const upcoming = Boolean(date) && date > getTodayStr();
  if (!match) return { label: upcoming ? 'À venir' : 'Pas encore suivi', seen: false, inLibrary: false };
  if (mediaType === 'movie') {
    const seen = match.seenEpisodes?.includes('movie') || match.status === 'completed';
    return { label: seen ? 'Vu' : upcoming ? 'À venir · dans ta liste' : 'À voir', seen: Boolean(seen), inLibrary: true };
  }
  const seenCount = match.seenEpisodes?.length || 0;
  const total = match.totalEpisodes || match.totalAiredEpisodes || 0;
  return { label: total ? `${seenCount}/${total} vus` : seenCount ? `${seenCount} épisodes vus` : 'Dans ta liste', seen: total > 0 && seenCount >= total, inLibrary: true };
}

/**
 * Ordre de visionnage (collection TMDB) en frise v2 (`SagaTimeline`), ou franchise/univers TVDB en lignes : affiche 44×66,
 * titre, année, état dans ta bibliothèque. L'identité de chaque membre reste `type:tmdbId` (SEENIT-RELATION-001).
 */
const formatRuntime = (minutes?: number | null) => {
  const total = Number(minutes) || 0;
  if (total <= 0) return '';
  return total >= 60 ? `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, '0')}` : `${total} min`;
};

/** Repère numéroté, trait et affiche sur la même ligne : centre du repère à 20 px du bord de la ligne. */
const SAGA_AXIS = 20;

/**
 * #871 — Saga v2 (maquette validée « c'est plus fun ») : ordre de visionnage de la collection TMDB, sans
 * changer de source (§5.2). Repères numérotés 1…N (or plein si vu, contour gris sinon, creux or avec halo
 * pour le film affiché), trait or entre deux films vus, en-tête « X / N vus » et barre segmentée, ligne du
 * film affiché encadrée d'or avec « TU ES ICI », statut vu = tampon VU de l'accueil sur l'affiche, annoncé.
 */
export function SagaTimeline({ title, parts, currentKey, shows, onOpen }: { title: string; parts: readonly RelationPart[]; currentKey: string | null; shows: readonly Show[]; onOpen: (part: RelationPart) => void }) {
  const rows = parts.map(part => ({ part, here: mediaKeyFrom(part as Parameters<typeof mediaKeyFrom>[0]) === currentKey, ...libraryState(part, shows) }));
  const seenCount = rows.filter(row => row.seen).length;
  return <DetailCard className="p-4 pb-2 flex flex-col" data-saga-timeline>
    <h3 className="m-0 text-[20px] font-extrabold tracking-[-0.02em] text-white">{title}</h3>
    <div className="mt-1 flex items-baseline justify-between gap-3"><span className="text-[13.5px] text-zinc-400">Ordre de visionnage</span><span className="text-[13.5px] font-bold text-zinc-300"><strong className="font-extrabold text-[#F2C36B]">{seenCount}</strong> / {rows.length} vus</span></div>
    <div role="img" aria-label={`${seenCount} film${seenCount > 1 ? 's' : ''} vu${seenCount > 1 ? 's' : ''} sur ${rows.length}`} className="mt-2.5 mb-1.5 flex gap-[3px]">
      {rows.map((row, index) => <span key={`saga-seg-${row.part.id}-${index}`} data-saga-segment className="h-[5px] flex-1 rounded-[3px]" style={row.here ? { boxShadow: 'inset 0 0 0 1.5px #fff', background: row.seen ? '#E5A93D' : 'transparent' } : { background: row.seen ? '#E5A93D' : '#3F3F46' }} />)}
    </div>
    <ol className="m-0 list-none p-0">
      {rows.map((row, index) => {
        const { part, here, seen } = row;
        const previousSeen = index > 0 && rows[index - 1].seen;
        const nextSeen = index < rows.length - 1 && rows[index + 1].seen;
        const year = (part.release_date || part.first_air_date || '').slice(0, 4);
        const meta = [year, formatRuntime(part.runtime)].filter(Boolean).join(' · ');
        return <li key={`saga-${part.media_type || 'media'}-${part.id}-${index}`} className="relative">
          <button type="button" onClick={() => { if (!here) onOpen(part); }} aria-current={here ? 'page' : undefined} data-saga-row={index + 1}
            className={cn('relative my-0.5 flex w-full min-h-[104px] items-center gap-3 rounded-2xl py-2.5 pr-2.5 pl-1.5 text-left', here && 'bg-[#1E1A12] shadow-[inset_0_0_0_1.5px_rgba(229,169,61,0.8)]')}>
            {index > 0 && <span aria-hidden="true" className="absolute top-[-2px] w-0.5 -ml-px" style={{ left: SAGA_AXIS, height: 'calc(50% + 2px)', background: previousSeen && seen ? '#E5A93D' : '#3F3F46' }} />}
            {index < rows.length - 1 && <span aria-hidden="true" className="absolute top-1/2 bottom-[-2px] w-0.5 -ml-px" style={{ left: SAGA_AXIS, background: seen && nextSeen ? '#E5A93D' : '#3F3F46' }} />}
            <span aria-hidden="true" data-saga-marker className={cn('relative z-[1] grid h-7 w-7 shrink-0 place-items-center rounded-full text-[13px] font-extrabold tabular-nums', here ? 'bg-[#141417] text-[#F2C36B] shadow-[inset_0_0_0_3px_#E5A93D,0_0_0_4px_rgba(229,169,61,0.2)]' : seen ? 'bg-[#E5A93D] text-[#1A1206]' : 'bg-[#141417] text-zinc-400 shadow-[inset_0_0_0_2px_#52525B]')}>{index + 1}</span>
            <span data-saga-poster className="relative h-[84px] w-14 shrink-0 overflow-hidden rounded-[10px] bg-zinc-800 shadow-[0_6px_16px_rgba(0,0,0,0.5)]">
              {part.poster_path && <img src={`https://image.tmdb.org/t/p/w154${part.poster_path}`} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />}
              {seen && <><span aria-hidden="true" className="absolute inset-0 bg-[rgba(9,9,11,0.35)]" /><SeenItWatchedStamp className="seenit-watched-stamp--mini" /></>}
            </span>
            <span className="min-w-0 flex-1">
              {here && <span className="mb-1 inline-flex h-5 items-center rounded-md bg-[#E5A93D] px-[7px] text-[10.5px] font-extrabold tracking-[0.04em] text-[#1A1206]">TU ES ICI</span>}
              <strong className="seenit-media-title block text-[15px] font-extrabold leading-[1.28]">{part.title || part.name}</strong>
              <small className="mt-1 flex items-center gap-1.5 text-[12.5px] text-zinc-400">{meta}{seen ? <span className="sr-only">, vu</span> : <>{meta && ' · '}<span className="font-extrabold text-zinc-300">À voir</span></>}</small>
            </span>
          </button>
        </li>;
      })}
    </ol>
  </DetailCard>;
}

export function RelationList({ title, subtitle, parts, currentKey, shows, timeline, onOpen }: { title: string; subtitle?: string; parts: readonly RelationPart[]; currentKey: string | null; shows: readonly Show[]; timeline: boolean; onOpen: (part: RelationPart) => void }) {
  if (!parts.length) return null;
  // L'ordre de visionnage (collection TMDB) prend la frise numérotée v2 (#871) ; la franchise reste en lignes.
  if (timeline) return <SagaTimeline title={title} parts={parts} currentKey={currentKey} shows={shows} onOpen={onOpen} />;
  return <DetailCard className="p-4 flex flex-col gap-1">
    <div className="flex flex-col gap-0.5 mb-2"><span className="text-[18px] font-bold text-white">{title}</span>{subtitle && <span className="text-[12px] text-zinc-400">{subtitle}</span>}</div>
    {parts.map((part, index) => {
      const here = mediaKeyFrom(part as Parameters<typeof mediaKeyFrom>[0]) === currentKey;
      const state = here ? { label: 'Tu es ici', seen: false, inLibrary: true } : libraryState(part, shows);
      const year = (part.release_date || part.first_air_date || '').slice(0, 4);
      const kind = (part.media_type || (part.title ? 'movie' : 'tv')) === 'movie' ? 'Film' : 'Série';
      return <button type="button" key={`relation-${part.media_type || 'media'}-${part.id}-${index}`} onClick={() => { if (!here) onOpen(part); }} aria-current={here ? 'true' : undefined} className="flex gap-3 items-stretch text-left min-h-11">
        <span className="flex-1 min-w-0 flex gap-3 items-center py-1.5">
          <span className="w-11 h-[66px] rounded-lg overflow-hidden bg-zinc-800 shrink-0" style={{ boxShadow: here ? '0 0 0 2px #E5A93D' : 'none' }}>{part.poster_path && <img src={`https://image.tmdb.org/t/p/w154${part.poster_path}`} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />}</span>
          <span className="flex-1 min-w-0 flex flex-col gap-0.5"><span className="seenit-media-title text-[15px] font-bold line-clamp-2">{part.title || part.name}</span><span className="text-[12px] text-zinc-400">{[kind, year].filter(Boolean).join(' · ')}</span><span className={cn('text-[12px] font-bold', here ? 'text-white' : state.seen || state.inLibrary ? 'text-[#F2C36B]' : 'text-zinc-400')}>{state.label}</span></span>
        </span>
      </button>;
    })}
  </DetailCard>;
}

export function RelationsLoading() {
  return <DetailCard className="p-4 flex flex-col gap-3" aria-hidden="true" data-seenit-relation-loading="true"><div className="h-4 w-32 rounded bg-zinc-800/80 animate-pulse" />{[0, 1].map(index => <div key={index} className="flex gap-3 animate-pulse"><div className="w-11 h-[66px] rounded-lg bg-zinc-800/80" /><div className="flex-1 space-y-2 pt-2"><div className="h-3.5 w-3/4 rounded bg-zinc-800/80" /><div className="h-3 w-1/3 rounded bg-zinc-800/60" /></div></div>)}</DetailCard>;
}
