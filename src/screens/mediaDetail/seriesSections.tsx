import React from 'react';
import { Play } from 'lucide-react';
import { episodeDownloadPresentation } from '../../features/downloads/episodeDownloadPresentation';
import type { LiveDownloadItem } from '../../services/sonarrRadarr';
import { type Show } from '../../types';
import { cn, formatAirDateSafe, getTodayStr } from '../../lib/utils';
import { averageRating, formatRating, RATING_TONE_TEXT, ratingTone, reliableEpisodeRatings, seasonAverageLabel, seasonAveragesView, settleSeenToggle, upcomingEpisodeLabel, type SeasonAverage } from '../../features/shows/detailPlanning';
import { DetailCard } from './detailUi';
import { SeenItCheckButton } from '../../components/SeenItCheckButton';
import { CompositorCelebration } from '../../components/SeenItCheckCelebration';
import { SeenItRing } from '../../components/SeenItLogo';
import { EpisodeReminderBell } from '../../components/EpisodeReminderBell';
import { EpisodeModeControl, EpisodeProgramControl, isEpisodeInertInMode, isEpisodePickable, type EpisodeModeState } from './downloadMode';

type SeasonMeta = { season_number: number; episode_count?: number; air_date?: string | null; vote_average?: number; name?: string };
type EpisodeData = { id?: number; episode_number: number; name?: string; still_path?: string | null; air_date?: string | null; runtime?: number | null; vote_average?: number; vote_count?: number };

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

/**
 * Courbe « Moyenne par saison » (notes TMDB des saisons, SEENIT-RATING-001), à partir de quatre saisons notées. Retour
 * terrain du 18/11 : à deux ou trois saisons, la moyenne vit dans la tuile de chaque saison (`SeasonPills`).
 */
export function SeasonAverageChart({ averages }: { averages: readonly SeasonAverage[] }) {
  if (averages.length < 2) return null;
  const values = averages.map(entry => entry.average);
  const low = Math.min(...values) - 0.15, high = Math.max(...values) + 0.15;
  const x = (index: number) => 24 + index * (292 / (averages.length - 1));
  const y = (value: number) => 82 - ((value - low) / (high - low)) * 58;
  return <DetailCard className="px-3.5 pt-3.5 pb-2 flex flex-col gap-1.5" data-season-averages="chart">
    <h3 className="text-[15px] font-bold text-white">Moyenne par saison</h3>
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
 * Retour terrain du 18/11 (« autant fusionner les deux ») : avec `averages` (deux ou trois saisons), la pastille devient
 * une tuile qui porte aussi la moyenne TMDB de sa saison : « Saison 1 (2025) » ou « S1 (2025) », note colorée par
 * niveau, écart avec la saison notée précédente (omis s'il s'arrondit à 0,0), puis l'avancement.
 */
export function SeasonPills({ seasons, show, selected, onSelect, downloading, averages }: { seasons: readonly SeasonMeta[]; show: Show | null | undefined; selected: number | null; onSelect: (season: number) => void; downloading?: (season: number) => boolean; averages?: readonly SeasonAverage[] }) {
  if (seasons.length < 2) return null;
  const today = getTodayStr();
  const tiles = Boolean(averages) && seasons.length <= 3;
  return <div className={tiles ? 'grid gap-2' : 'flex gap-1.5 overflow-x-auto hide-scrollbar -mx-4 px-4'} style={tiles ? { gridTemplateColumns: `repeat(${seasons.length},minmax(0,1fr))` } : undefined} role="group" aria-label="Saisons" data-season-tiles={tiles || undefined}>
    {seasons.map(season => {
      const count = season.episode_count || 0, seen = seenInSeason(show, season.season_number), on = season.season_number === selected;
      const future = count === 0 || Boolean(season.air_date && season.air_date > today);
      const complete = !future && seen >= count;
      const state = future ? 'Bientôt' : complete ? 'vue' : `${seen}/${count}`;
      const active = Boolean(downloading?.(season.season_number));
      const seenPct = count > 0 ? Math.min(100, Math.round((seen / count) * 100)) : 0;
      const index = tiles ? averages!.findIndex(entry => entry.season === season.season_number) : -1;
      const entry = index >= 0 ? averages![index] : null;
      const delta = entry && index > 0 && Math.abs(entry.average - averages![index - 1].average) >= 0.05 ? entry.average - averages![index - 1].average : null;
      const rating = entry ? `, note ${formatRating(entry.average)}${delta ? `, ${delta > 0 ? 'en hausse' : 'en baisse'} de ${formatRating(Math.abs(delta))}` : ''}` : '';
      const ring = on ? 'bg-[#1E1A12] shadow-[inset_0_0_0_1.5px_#E5A93D]' : 'bg-[#18181b] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]';
      const dot = active && <i aria-hidden="true" data-season-downloading className="block h-[7px] w-[7px] rounded-full bg-white" />;
      const bar = (className: string) => <span aria-hidden="true" data-season-bar className={cn('block h-[3px] overflow-hidden rounded-sm bg-zinc-700', className)}><i className="block h-full bg-[#E5A93D]" style={{ width: `${seenPct}%` }} /></span>;
      return <button type="button" key={`pill-${season.season_number}`} onClick={() => onSelect(season.season_number)} aria-pressed={on} aria-label={`Saison ${season.season_number}, ${state}${rating}${active ? ', téléchargement en cours' : ''}`} data-season-average={tiles ? season.season_number : undefined}
        className={cn(tiles ? 'min-w-0 px-3 py-2.5 rounded-xl flex flex-col gap-1.5 text-left' : 'min-w-[58px] shrink-0 h-[56px] px-2 rounded-xl flex flex-col items-center justify-center gap-px', ring)}>
        {tiles ? <>
          <span className="flex items-center gap-1"><span className={cn('text-[12px] font-bold leading-none whitespace-nowrap', on ? 'text-[#F2C36B]' : 'text-zinc-400')}>{seasonAverageLabel({ season: season.season_number, average: 0, year: season.air_date?.slice(0, 4) }, seasons.length)}</span>{dot}</span>
          {entry ? <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1"><b className="text-[20px] font-extrabold leading-none tabular-nums whitespace-nowrap" style={{ color: RATING_TONE_TEXT[ratingTone(entry.average)] }}>★ {formatRating(entry.average)}</b>{delta && <span data-season-delta className={cn('text-[11px] font-bold leading-none whitespace-nowrap', delta > 0 ? 'text-emerald-400' : 'text-rose-400')}>{delta > 0 ? '▲' : '▼'} {formatRating(Math.abs(delta))}</span>}</span>
            : <span className={cn('text-[13px] font-bold leading-5', future ? 'text-sky-300' : 'text-zinc-500')}>{future ? 'Bientôt' : 'Pas de note'}</span>}
          <span className="flex items-center gap-1.5 h-3.5">{bar('flex-1')}{complete ? <SeenItRing size={14} /> : !future && <span className="text-[11px] font-bold leading-none tabular-nums text-zinc-400">{seen}/{count}</span>}</span>
        </> : <>
          <span className="flex items-center gap-1"><span className={cn('text-[13px] font-extrabold', on ? 'text-[#F2C36B]' : 'text-white')}>S{season.season_number}</span>{dot}</span>
          {complete ? <SeenItRing size={17} className="my-px" /> : <span className={cn('text-[10.5px] font-bold whitespace-nowrap', future ? 'text-sky-300' : on ? 'text-zinc-200' : 'text-zinc-400')}>{state}</span>}
          {bar('mt-0.5 w-full')}
        </>}
      </button>;
    })}
  </div>;
}

/**
 * Saison sélectionnée : avancement, moyenne, « Tout marquer vu / non vu » et bande-annonce de saison, puis les lignes
 * d'épisode. Retour terrain du 18/11 : plus de barres de notes par épisode ici, elles vivent sur la fiche épisode.
 */
export function SeasonPanel({ season, averageShownAbove = false, episodes, show, nextKey, runtimeFallback, onToggleSeason, onToggleEpisode, onOpenEpisode, onSeasonTrailer, episodesHasFile, episodesMonitored, getEpisodeDownload, downloadMode }: { season: SeasonMeta; averageShownAbove?: boolean; episodes: readonly EpisodeData[] | null; show: Show | null | undefined; nextKey: string | null; runtimeFallback: number; onToggleSeason: (event: React.MouseEvent) => void; onToggleEpisode: (event: React.MouseEvent, episode: number) => unknown; onOpenEpisode: (episode: EpisodeData) => void; onSeasonTrailer?: () => void;  episodesHasFile?: Record<string, boolean>; episodesMonitored?: Record<string, boolean>; getEpisodeDownload?: (episode: number) => LiveDownloadItem | null; downloadMode?: { active: boolean; picked: ReadonlySet<number>; onToggle: (episode: number) => void } | null }) {
  const number = season.season_number, count = season.episode_count || 0, today = getTodayStr();
  const seen = seenInSeason(show, number);
  const future = count === 0 || Boolean(season.air_date && season.air_date > today) || (episodes ? episodes.length > 0 && episodes.every(episode => episode.air_date && episode.air_date > today) : false);
  // Retour v1.4.300 : une note sur une poignée de votes ne fait pas la moyenne ; la note de saison TMDB (sans
  // nombre de votes) ne sert que tant que les épisodes ne sont pas chargés.
  const ratings = reliableEpisodeRatings(episodes || []);
  const mean = episodes ? averageRating(ratings) : (season.vote_average && season.vote_average > 0 ? season.vote_average : null);
  // Retour terrain du 18/11 : la moyenne de la saison est déjà au-dessus (sa tuile ou la courbe) ; la saison ne la
  // répète pas (et n'affiche donc pas deux valeurs voisines, 8,1 en TMDB saison contre 8,2 en épisodes fiables).
  const showMean = !averageShownAbove;
  const fullyWatched = count > 0 && seen >= count;
  const isSeen = (episode: number) => Boolean(show?.seenEpisodes?.includes(`${number}x${episode}`));
  const inMode = Boolean(downloadMode?.active);
  // Retour terrain du 18/11 (« ça fait bloc sur bloc ») : plus de carte autour de la saison. Un titre de section, la
  // bande-annonce en petit, « Tout marquer vu » en texte seul en tête de liste, au-dessus de la colonne des coches
  // (masqué en mode téléchargement, où cette colonne porte le téléchargement), puis des lignes à plat de même hauteur,
  // séparées par un filet.
  return <section id={`season-panel-${number}`} className="flex flex-col" aria-label={`Saison ${number}`}>
    <div className="flex justify-between items-center gap-2 pl-1">
      <div className="min-w-0 flex flex-col"><h3 className="text-[17px] font-bold text-white">Saison {number}{count > 0 ? ` · ${seen}/${count}` : ''}</h3>{showMean && (mean !== null ? <span className="text-[12px] text-zinc-400">moyenne <b className="text-white">{formatRating(mean)}</b></span> : episodes && episodes.some(episode => Number(episode.vote_average) > 0) ? <span className="text-[12px] text-zinc-500">notes insuffisantes</span> : null)}</div>
      {onSeasonTrailer && <button type="button" onClick={onSeasonTrailer} data-season-trailer className="shrink-0 min-h-11 inline-flex items-center"><span className="inline-flex h-7 items-center gap-1 rounded-lg bg-[#18181b] px-2.5 text-[12px] font-bold text-zinc-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]"><Play size={12} className="fill-current" />Bande-annonce</span></button>}
    </div>
    {future && <p className="pl-1 pb-1 text-[13px] text-zinc-400">Saison annoncée{season.air_date ? ` · prochainement, le ${formatAirDateSafe(season.air_date, 'long')}` : ' · les épisodes arrivent bientôt'}</p>}
    {!future && count > 0 && !inMode && <button type="button" onClick={onToggleSeason} data-season-all aria-pressed={fullyWatched} aria-label={fullyWatched ? 'Marquer toute la saison comme non vue' : 'Marquer toute la saison comme vue'} className="self-end min-h-11 px-3 text-[13px] font-bold text-[#F2C36B] active:opacity-80">{fullyWatched ? 'Tout marquer non vu' : 'Tout marquer vu'}</button>}
    {!episodes ? <div className="flex flex-col gap-1 pt-1" aria-hidden="true">{[0, 1, 2].map(index => <div key={index} className="flex items-center gap-2 min-h-[62px] px-2.5 animate-pulse"><div className="w-5" /><div className="w-[84px] h-[47px] rounded-lg bg-zinc-800/80" /><div className="flex-1 space-y-2"><div className="h-3.5 w-3/4 rounded bg-zinc-800/80" /><div className="h-3 w-1/3 rounded bg-zinc-800/60" /></div></div>)}</div>
      : <div className="flex flex-col">{episodes.map(episode => {
        // Retour terrain du 08/11 : l'épisode suivant n'est plus entouré (doublon avec la sélection du mode
        // téléchargement) ; « · prochain » dans sa ligne suffit.
        const key = `${number}x${episode.episode_number}`, watched = isSeen(episode.episode_number), isNext = key === nextKey;
        const aired = !episode.air_date || episode.air_date <= today;
        // #857 : à venir = ligne nette (plus de demi-grisé) et libellé relatif, daté au-delà de 7 jours.
        const relative = !aired && episode.air_date ? upcomingEpisodeLabel(episode.air_date, today) : null;
        // Retour terrain du 18/11 (lignes de hauteur égale) : le délai rejoint la ligne d'infos jusqu'à 7 jours (« Dans 4
        // jours »), puis la date (« sam. 13 déc. ») ; à droite, seulement la cloche.
        const releaseDay = relative && relative.includes(' · ') ? new Date(`${episode.air_date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) : relative;
        const watchedAt = watched ? Number(show?.episodeRecords?.[key]?.watchedAt) : NaN;
        const watchedOn = watched && Number.isFinite(watchedAt) && watchedAt > 0 ? `Vu le ${new Date(watchedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}` : null;
        const runtime = episode.runtime || runtimeFallback;
        // Retour terrain du 08/11 puis du 18/11 : la note se lit sur la fiche épisode ; la ligne reprend le numéro
        // (« Sxx | Eyy », or à voir, bleu à venir, gris vu) et l'image reste libre de tout repère.
        const episodeCode = `S${String(number).padStart(2, '0')} | E${String(episode.episode_number).padStart(2, '0')}`;
        const download = episodeDownloadPresentation(episode.episode_number, aired, Boolean(episodesHasFile?.[key]), getEpisodeDownload?.(episode.episode_number), Boolean(episodesMonitored?.[key]));
        // #879 : état unique de l'épisode pour le mode téléchargement et les pastilles passives.
        const live = getEpisodeDownload?.(episode.episode_number);
        const modeState: EpisodeModeState = watched ? 'seen' : download.kind;
        const picked = Boolean(downloadMode?.picked.has(episode.episode_number));
        // Sorti : à télécharger (or) ; à venir : à programmer dans Sonarr (bleu).
        const selectable = inMode && isEpisodePickable(modeState);
        // Retour terrain du 16/11 : en mode, une ligne qui ne se coche pas s'efface (rien à faire dessus).
        const inert = inMode && isEpisodeInertInMode(modeState);
        // Retour terrain du 16/11 (« pour les séries, je veux pouvoir cliquer sur un épisode ») : en mode, un épisode qui se
        // coche se coche ; les autres (déjà là, programmés, vus, en cours) ouvrent leur fiche comme hors mode.
        const activate = () => { if (inMode && selectable) downloadMode!.onToggle(episode.episode_number); else onOpenEpisode(episode); };
        // #845 : seule la ligne elle-même ouvre l'épisode au clavier ; Entrée sur le bouton Vu imbriqué ne fait que le basculer.
        return <div key={`ep-${key}`} data-episode-row={episode.episode_number} role="button" tabIndex={0} onClick={activate} onKeyDown={event => { if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return; event.preventDefault(); activate(); }} aria-label={`Épisode ${episode.episode_number} : ${episode.name || ''}`} data-mode-inert={inert || undefined} className={cn('flex items-center gap-2 h-[62px] pl-1 pr-1.5 cursor-pointer border-b border-white/[0.07] last:border-b-0', inert && 'opacity-50', picked && 'rounded-[14px] border-transparent bg-[#0E1A20] shadow-[inset_0_0_0_1.5px_rgba(125,211,252,0.8)]')}>
          <span className="relative w-[76px] h-[47px] rounded-lg overflow-hidden bg-zinc-800 shrink-0">{episode.still_path && <img src={`https://image.tmdb.org/t/p/w300${episode.still_path}`} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" style={{ opacity: watched ? 0.55 : 1, filter: watched ? 'grayscale(1)' : undefined }} />}{inMode && modeState === 'active' && <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[3px] bg-black/60"><i className="block h-full bg-zinc-100" style={{ width: `${Math.max(0, Math.min(100, Number(live?.progress) || 0))}%` }} /></span>}</span>
          <span className="flex-1 min-w-0 flex flex-col gap-[3px]"><span className={cn('text-[14px] leading-[1.35] font-bold truncate decoration-[1.5px]', watched ? 'text-zinc-500 line-through' : 'text-white')}>{episode.name || `Épisode ${episode.episode_number}`}</span><span className="text-[12px] text-zinc-400 truncate"><b data-episode-code className={cn('font-extrabold', watched ? 'text-zinc-500' : aired ? 'text-[#F2C36B]' : 'text-sky-300')}>{episodeCode}</b>{' · '}{watchedOn ? <span className="text-zinc-500">{watchedOn}</span> : releaseDay ? <span>{releaseDay}</span> : <>{runtime} min{isNext && <b className="font-extrabold text-[#F2C36B]"> · prochain</b>}</>}</span></span>
          {/* #857 : même bouton Vu que l'Accueil ; #859 : animation au toucher, dessinée par le compositeur. */}
          {/* Retour terrain du 08/11 : cloche de rappel sur un épisode à venir (hors mode téléchargement). */}
          {!aired && !inMode && <EpisodeReminderBell show={show} episode={{ season_number: number, episode_number: episode.episode_number, name: episode.name, air_date: episode.air_date }} />}
          {aired && inMode && <EpisodeModeControl episode={episode.episode_number} state={modeState} picked={picked} progress={live?.progress} onToggle={() => downloadMode!.onToggle(episode.episode_number)} />}
          {!aired && inMode && <EpisodeProgramControl episode={episode.episode_number} state={modeState} picked={picked} onToggle={() => downloadMode!.onToggle(episode.episode_number)} />}
          {aired && !inMode && <SeenItCheckButton className="seenit-check--compositor" celebrationLayer={<CompositorCelebration />} isWatched={watched} title={watched ? `Marquer l’épisode ${episode.episode_number} non vu` : `Marquer l’épisode ${episode.episode_number} vu`} onClick={event => settleSeenToggle(onToggleEpisode(event, episode.episode_number))} />}
        </div>;
      })}</div>}
  </section>;
}
