import React from 'react';
import { Play } from 'lucide-react';
import { episodeDownloadPresentation } from '../../features/downloads/episodeDownloadPresentation';
import type { LiveDownloadItem } from '../../services/sonarrRadarr';
import { type Show } from '../../types';
import { cn, formatAirDateSafe, getTodayStr } from '../../lib/utils';
import { averageRating, formatRating, ratingBarHeight, settleSeenToggle, upcomingEpisodeLabel, type SeasonAverage } from '../../features/shows/detailPlanning';
import { DetailCard } from './detailUi';
import { SeenItCheckButton } from '../../components/SeenItCheckButton';
import { CompositorCelebration } from '../../components/SeenItCheckCelebration';
import { SeenItRing } from '../../components/SeenItLogo';
import { EpisodeReminderBell } from '../../components/EpisodeReminderBell';
import { EpisodeModeControl, EpisodePassiveChip, EpisodeProgramControl, isEpisodePickable, type EpisodeModeState } from './downloadMode';

type SeasonMeta = { season_number: number; episode_count?: number; air_date?: string | null; vote_average?: number; name?: string };
type EpisodeData = { id?: number; episode_number: number; name?: string; still_path?: string | null; air_date?: string | null; runtime?: number | null; vote_average?: number };

export const seasonsOf = (tmdbDetails: { seasons?: SeasonMeta[] } | null | undefined): SeasonMeta[] => (tmdbDetails?.seasons || []).filter(season => season.season_number > 0);
export const seenInSeason = (show: Show | null | undefined, season: number) => (show?.seenEpisodes || []).filter(key => key.startsWith(`${season}x`)).length;

export function formatRemaining(minutes: number): string {
  if (!minutes || minutes <= 0) return 'tout est vu';
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return hours > 0 ? `il reste ${hours} h ${String(rest).padStart(2, '0')}` : `il reste ${rest} min`;
}

/** Carte de progression : épisodes vus, temps restant, un segment par saison rempli d'or, puis actions. */
export function SeriesProgressCard({ seenCount, totalEpisodes, remainingMinutes, seasons, show, children }: { seenCount: number; totalEpisodes: number; remainingMinutes: number; seasons: readonly SeasonMeta[]; show: Show | null | undefined; children: React.ReactNode }) {
  const segments = seasons.filter(season => (season.episode_count || 0) > 0);
  return <DetailCard accent className="p-3.5 flex flex-col gap-3">
    {show && totalEpisodes > 0 && <>
      <div className="flex justify-between items-baseline gap-2"><span className="text-[15px] font-bold text-white">{seenCount} / {totalEpisodes} épisodes</span><span className="text-[12px] text-zinc-400">{formatRemaining(remainingMinutes)}</span></div>
      <div className="flex gap-0.5" role="img" aria-label={`${seenCount} épisodes vus sur ${totalEpisodes}`}>{segments.map(season => { const count = season.episode_count || 1; const ratio = Math.min(100, (seenInSeason(show, season.season_number) / count) * 100); return <span key={`seg-${season.season_number}`} className="h-1.5 rounded-[3px]" style={{ flex: count, background: `linear-gradient(90deg,#E5A93D 0 ${ratio}%,#3f3f46 ${ratio}% 100%)` }} />; })}</div>
    </>}
    <div className="flex gap-2">{children}</div>
  </DetailCard>;
}

/** Courbe « Moyenne par saison » (notes TMDB des saisons, SEENIT-RATING-001), masquée sous deux saisons notées. */
export function SeasonAverageChart({ averages }: { averages: readonly SeasonAverage[] }) {
  if (averages.length < 2) return null;
  const values = averages.map(entry => entry.average);
  const low = Math.min(...values) - 0.15, high = Math.max(...values) + 0.15;
  const x = (index: number) => 24 + index * (292 / (averages.length - 1));
  const y = (value: number) => 82 - ((value - low) / (high - low)) * 58;
  return <DetailCard className="px-3.5 pt-3.5 pb-2 flex flex-col gap-1.5">
    <span className="text-[15px] font-bold text-white">Moyenne par saison</span>
    <div className="relative h-[110px]" role="img" aria-label={`Moyennes TMDB par saison : ${averages.map(entry => `saison ${entry.season} ${formatRating(entry.average)}`).join(', ')}`}>
      <svg viewBox="0 0 340 110" preserveAspectRatio="none" className="absolute inset-0 w-full h-full overflow-visible" aria-hidden="true">
        <polyline points={averages.map((entry, index) => `${x(index).toFixed(1)},${y(entry.average).toFixed(1)}`).join(' ')} fill="none" stroke="#E5A93D" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {averages.map((entry, index) => <circle key={entry.season} cx={x(index)} cy={y(entry.average)} r="5" fill="#09090b" stroke="#E5A93D" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />)}
      </svg>
      {averages.map((entry, index) => <React.Fragment key={`label-${entry.season}`}><span className="absolute -translate-x-1/2 text-[12px] font-extrabold leading-none text-white" style={{ left: `${(x(index) / 340) * 100}%`, top: `${y(entry.average) - 21}px` }}>{formatRating(entry.average)}</span><span className="absolute -translate-x-1/2 text-[10px] font-bold leading-none text-zinc-400" style={{ left: `${(x(index) / 340) * 100}%`, top: '96px' }}>S{entry.season}</span></React.Fragment>)}
    </div>
  </DetailCard>;
}

/**
 * Pastilles de saison : numéro, avancement (« 12/20 », anneau Vu de SeenIt pour une saison finie, « Bientôt »
 * en bleu) et, depuis #879, mini-barre « vu » et point blanc quand un téléchargement est actif dans la saison
 * (sous le gate téléchargement). Retour terrain du 08/11 : plus de coche « vue » en texte, le même anneau Vu que
 * le reste de l'app ; la saison choisie est cerclée d'or sur fond sombre, comme le prochain épisode.
 */
export function SeasonPills({ seasons, show, selected, onSelect, downloading }: { seasons: readonly SeasonMeta[]; show: Show | null | undefined; selected: number | null; onSelect: (season: number) => void; downloading?: (season: number) => boolean }) {
  if (seasons.length < 2) return null;
  const today = getTodayStr();
  return <div className="flex gap-1.5 overflow-x-auto hide-scrollbar -mx-4 px-4" role="group" aria-label="Saisons">
    {seasons.map(season => {
      const count = season.episode_count || 0, seen = seenInSeason(show, season.season_number), on = season.season_number === selected;
      const future = count === 0 || Boolean(season.air_date && season.air_date > today);
      const complete = !future && seen >= count;
      const state = future ? 'Bientôt' : complete ? 'vue' : `${seen}/${count}`;
      const active = Boolean(downloading?.(season.season_number));
      const seenPct = count > 0 ? Math.min(100, Math.round((seen / count) * 100)) : 0;
      return <button type="button" key={`pill-${season.season_number}`} onClick={() => onSelect(season.season_number)} aria-pressed={on} aria-label={`Saison ${season.season_number}, ${state}${active ? ', téléchargement en cours' : ''}`} className={cn('min-w-[58px] shrink-0 h-[56px] px-2 rounded-xl flex flex-col items-center justify-center gap-px', on ? 'bg-[#1E1A12] shadow-[inset_0_0_0_1.5px_#E5A93D]' : 'bg-[#18181b] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]')}>
        <span className="flex items-center gap-1"><span className={cn('text-[13px] font-extrabold', on ? 'text-[#F2C36B]' : 'text-white')}>S{season.season_number}</span>{active && <i aria-hidden="true" data-season-downloading className="block h-[7px] w-[7px] rounded-full bg-white" />}</span>
        {complete ? <SeenItRing size={17} className="my-px" /> : <span className={cn('text-[10.5px] font-bold whitespace-nowrap', future ? 'text-sky-300' : on ? 'text-zinc-200' : 'text-zinc-400')}>{state}</span>}
        <span aria-hidden="true" data-season-bar className="mt-0.5 block h-[3px] w-full overflow-hidden rounded-sm bg-zinc-700"><i className="block h-full bg-[#E5A93D]" style={{ width: `${seenPct}%` }} /></span>
      </button>;
    })}
  </div>;
}

/**
 * Saison sélectionnée : barres de notes TMDB par épisode (or = vu, contour blanc = prochain), moyenne,
 * « Tout marquer vu / non vu » et bande-annonce de saison, puis les lignes d'épisode.
 */
export function SeasonPanel({ season, episodes, show, nextKey, runtimeFallback, onToggleSeason, onToggleEpisode, onOpenEpisode, onSeasonTrailer, episodesHasFile, episodesMonitored, getEpisodeDownload, downloadMode }: { season: SeasonMeta; episodes: readonly EpisodeData[] | null; show: Show | null | undefined; nextKey: string | null; runtimeFallback: number; onToggleSeason: (event: React.MouseEvent) => void; onToggleEpisode: (event: React.MouseEvent, episode: number) => unknown; onOpenEpisode: (episode: EpisodeData) => void; onSeasonTrailer?: () => void;  episodesHasFile?: Record<string, boolean>; episodesMonitored?: Record<string, boolean>; getEpisodeDownload?: (episode: number) => LiveDownloadItem | null; downloadMode?: { active: boolean; picked: ReadonlySet<number>; onToggle: (episode: number) => void } | null }) {
  const number = season.season_number, count = season.episode_count || 0, today = getTodayStr();
  const seen = seenInSeason(show, number);
  const future = count === 0 || Boolean(season.air_date && season.air_date > today) || (episodes ? episodes.length > 0 && episodes.every(episode => episode.air_date && episode.air_date > today) : false);
  const ratings = (episodes || []).map(episode => episode.vote_average);
  const mean = averageRating(ratings) ?? (season.vote_average && season.vote_average > 0 ? season.vote_average : null);
  const fullyWatched = count > 0 && seen >= count;
  const isSeen = (episode: number) => Boolean(show?.seenEpisodes?.includes(`${number}x${episode}`));
  return <section id={`season-panel-${number}`} className="flex flex-col gap-1" aria-label={`Saison ${number}`}>
    <DetailCard className="px-3.5 py-3 flex flex-col gap-2.5">
      <div className="flex justify-between items-center gap-2"><span className="text-[16px] font-bold text-white">Saison {number}{count > 0 ? ` · ${seen}/${count}` : ''}</span><div className="flex items-center gap-1">{mean !== null && <span className="text-[13px] text-zinc-400">moyenne <b className="text-white">{formatRating(mean)}</b></span>}</div></div>
      {future ? <p className="text-[13px] text-zinc-400">Saison annoncée{season.air_date ? ` · prochainement, le ${formatAirDateSafe(season.air_date, 'long')}` : ' · les épisodes arrivent bientôt'}</p>
        : episodes ? <div className="h-10 flex items-end gap-0.5" aria-hidden="true">{episodes.map(episode => { const key = `${number}x${episode.episode_number}`; const watched = isSeen(episode.episode_number); const aired = !episode.air_date || episode.air_date <= today; return <span key={`bar-${key}`} className="flex-1 rounded-[2px]" style={{ height: `${ratingBarHeight(episode.vote_average, ratings)}px`, background: watched ? '#E5A93D' : 'transparent', boxShadow: key === nextKey ? 'inset 0 0 0 2px #fff' : watched ? 'none' : `inset 0 0 0 1.5px ${aired ? '#a1a1aa' : '#3f3f46'}` }} />; })}</div>
        : <div className="h-10 rounded bg-zinc-800/60 animate-pulse" aria-hidden="true" />}
      {!future && <div className="flex gap-2">
        {count > 0 && <button type="button" onClick={onToggleSeason} className="flex-1 min-h-11 rounded-[11px] shadow-[inset_0_0_0_1px_rgba(229,169,61,0.5)] text-[13px] font-bold text-[#F2C36B] active:scale-[0.98]" aria-label={fullyWatched ? 'Marquer toute la saison comme non vue' : 'Marquer toute la saison comme vue'}>{fullyWatched ? 'Tout marquer non vu' : 'Tout marquer vu'}</button>}
        {onSeasonTrailer && <button type="button" onClick={onSeasonTrailer} className="min-h-11 px-3 rounded-[11px] bg-[#18181b] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] text-[13px] font-bold text-zinc-100 inline-flex items-center gap-1.5"><Play size={14} className="fill-current" />Bande-annonce</button>}
      </div>}
    </DetailCard>
    {!episodes ? <div className="flex flex-col gap-1 pt-1" aria-hidden="true">{[0, 1, 2].map(index => <div key={index} className="flex items-center gap-2 min-h-[62px] px-2.5 animate-pulse"><div className="w-5" /><div className="w-[84px] h-[47px] rounded-lg bg-zinc-800/80" /><div className="flex-1 space-y-2"><div className="h-3.5 w-3/4 rounded bg-zinc-800/80" /><div className="h-3 w-1/3 rounded bg-zinc-800/60" /></div></div>)}</div>
      : <div className="flex flex-col">{episodes.map(episode => {
        const key = `${number}x${episode.episode_number}`, watched = isSeen(episode.episode_number), isNext = key === nextKey;
        const aired = !episode.air_date || episode.air_date <= today;
        // #857 : à venir = ligne nette (plus de demi-grisé) et libellé relatif, daté au-delà de 7 jours.
        const relative = !aired && episode.air_date ? upcomingEpisodeLabel(episode.air_date, today) : null;
        // #879 : à droite, le délai seul (« Dans 8 jours ») ; la date de sortie passe sous le titre.
        const until = relative ? relative.split(' · ')[0] : null;
        const releaseDay = !aired && episode.air_date ? new Date(`${episode.air_date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) : null;
        const watchedAt = watched ? Number(show?.episodeRecords?.[key]?.watchedAt) : NaN;
        const watchedOn = watched && Number.isFinite(watchedAt) && watchedAt > 0 ? `Vu le ${new Date(watchedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}` : null;
        const runtime = episode.runtime || runtimeFallback;
        // Retour terrain du 08/11 : la note est déjà dans les barres de la saison ; la ligne reprend le numéro
        // (« E02 », or à voir, bleu à venir, gris vu) et l'image reste libre de tout repère.
        const episodeCode = `E${String(episode.episode_number).padStart(2, '0')}`;
        const download = episodeDownloadPresentation(episode.episode_number, aired, Boolean(episodesHasFile?.[key]), getEpisodeDownload?.(episode.episode_number), Boolean(episodesMonitored?.[key]));
        // #879 : état unique de l'épisode pour le mode téléchargement et les pastilles passives.
        const live = getEpisodeDownload?.(episode.episode_number);
        const modeState: EpisodeModeState = watched ? 'seen' : download.kind;
        const inMode = Boolean(downloadMode?.active);
        const picked = Boolean(downloadMode?.picked.has(episode.episode_number));
        // Sorti : à télécharger (or) ; à venir : à programmer dans Sonarr (bleu).
        const selectable = inMode && isEpisodePickable(modeState);
        const activate = () => { if (!inMode) onOpenEpisode(episode); else if (selectable) downloadMode!.onToggle(episode.episode_number); };
        // #845 : seule la ligne elle-même ouvre l'épisode au clavier ; Entrée sur le bouton Vu imbriqué ne fait que le basculer.
        return <div key={`ep-${key}`} data-episode-row={episode.episode_number} role="button" tabIndex={0} onClick={activate} onKeyDown={event => { if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return; event.preventDefault(); activate(); }} aria-label={`Épisode ${episode.episode_number} : ${episode.name || ''}`} className={cn('flex items-center gap-2 min-h-[62px] py-1.5 pl-2.5 pr-1.5 rounded-[14px] cursor-pointer', picked && !aired ? 'bg-[#0E1A20] shadow-[inset_0_0_0_1.5px_rgba(125,211,252,0.8)]' : isNext || picked ? 'bg-[rgba(229,169,61,0.08)] shadow-[inset_0_0_0_1.5px_rgba(229,169,61,0.6)]' : watched ? '' : aired ? 'bg-white/[0.03]' : 'seenit-episode--upcoming bg-[repeating-linear-gradient(135deg,#141417_0_6px,#101013_6px_12px)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)]')}>
          <span className="relative w-[76px] h-[47px] rounded-lg overflow-hidden bg-zinc-800 shrink-0">{episode.still_path && <img src={`https://image.tmdb.org/t/p/w300${episode.still_path}`} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" style={{ opacity: watched ? 0.55 : 1, filter: watched ? 'grayscale(1)' : undefined }} />}{downloadMode && !inMode && <EpisodePassiveChip state={modeState} progress={live?.progress} />}{downloadMode && modeState === 'active' && <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[3px] bg-black/60"><i className="block h-full bg-zinc-100" style={{ width: `${Math.max(0, Math.min(100, Number(live?.progress) || 0))}%` }} /></span>}</span>
          <span className="flex-1 min-w-0 flex flex-col gap-[3px]"><span className={cn('text-[14px] leading-[1.35] font-bold line-clamp-2 break-words decoration-[1.5px]', watched ? 'text-zinc-500 line-through' : 'text-white')}>{episode.name || `Épisode ${episode.episode_number}`}</span><span className="text-[12px] text-zinc-400"><b data-episode-code className={cn('font-extrabold', watched ? 'text-zinc-500' : aired ? 'text-[#F2C36B]' : 'text-sky-300')}>{episodeCode}</b>{' · '}{watchedOn ? <span className="text-zinc-500">{watchedOn}</span> : releaseDay ? <span>{releaseDay}</span> : <>{runtime} min{isNext && <b className="font-extrabold text-[#F2C36B]"> · prochain</b>}</>}</span></span>
          {/* #857 : même bouton Vu que l'Accueil ; #859 : animation au toucher, dessinée par le compositeur. */}
          {!aired && until && <span className="shrink-0 pr-1 text-[12.5px] font-extrabold text-sky-300 whitespace-nowrap">{until}</span>}
          {/* Retour terrain du 08/11 : cloche de rappel sur un épisode à venir (hors mode téléchargement). */}
          {!aired && !inMode && <EpisodeReminderBell show={show} episode={{ season_number: number, episode_number: episode.episode_number, name: episode.name, air_date: episode.air_date }} />}
          {aired && inMode && <EpisodeModeControl episode={episode.episode_number} state={modeState} picked={picked} progress={live?.progress} onToggle={() => downloadMode!.onToggle(episode.episode_number)} />}
          {!aired && inMode && <EpisodeProgramControl episode={episode.episode_number} state={modeState} picked={picked} onToggle={() => downloadMode!.onToggle(episode.episode_number)} />}
          {aired && !inMode && <SeenItCheckButton className="seenit-check--compositor" celebrationLayer={<CompositorCelebration />} isWatched={watched} title={watched ? `Marquer l’épisode ${episode.episode_number} non vu` : `Marquer l’épisode ${episode.episode_number} vu`} onClick={event => settleSeenToggle(onToggleEpisode(event, episode.episode_number))} />}
        </div>;
      })}</div>}
  </section>;
}
