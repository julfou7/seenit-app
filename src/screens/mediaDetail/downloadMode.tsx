import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { DownloadMark } from '../../components/SeenItLogo';
import { cn } from '../../lib/utils';
import type { EpisodeDownloadPresentation } from '../../features/downloads/episodeDownloadPresentation';

/**
 * #879 — Mode téléchargement de la fiche série : une surcouche, jamais des boutons partout.
 * Hors mode, la fiche ne garde qu'un bouton ⬇ (avec le nombre de téléchargements actifs) et des
 * pastilles passives sur les vignettes. En mode, le contrôle de sélection remplace le Vu de chaque
 * épisode, le bandeau montre la saison (chaque segment se touche) et la barre d'action du bas, compacte,
 * demande la qualité (1080p ou 4K) sans cacher la liste (retour terrain du 07/11).
 */
export type EpisodeModeState = 'seen' | EpisodeDownloadPresentation['kind'];

/** Un épisode peut être coché s'il est sorti, sans fichier ni téléchargement actif (un échec se relance). */
export const isEpisodeSelectable = (state: EpisodeModeState) => state === 'available' || state === 'attention';
/** #879 — Un épisode à venir, pas encore surveillé dans Sonarr, peut être programmé (coché en bleu). */
export const isEpisodeProgrammable = (state: EpisodeModeState) => state === 'future';
export const isEpisodePickable = (state: EpisodeModeState) => isEpisodeSelectable(state) || isEpisodeProgrammable(state);
const SKY = '#7DD3FC';
const HATCH = 'repeating-linear-gradient(135deg,#2a2a2f 0 2px,#141417 2px 4px)';

export function DownloadModeToggle({ active, badge, onToggle }: { active: boolean; badge: number; onToggle: () => void }) {
  return <button type="button" onClick={onToggle} aria-pressed={active} aria-label={active ? 'Quitter le mode téléchargement' : `Mode téléchargement${badge ? `, ${badge} en cours` : ''}`}
    className={cn('relative w-[52px] h-[52px] shrink-0 rounded-[15px] grid place-items-center active:scale-95', active ? 'bg-[#E5A93D] text-black' : 'bg-zinc-800 text-zinc-200 shadow-[0_0_0_1px_rgba(255,255,255,0.12)]')}>
    <DownloadMark size={26} />
    {badge > 0 && <span aria-hidden="true" className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-zinc-100 text-black text-[11px] font-extrabold grid place-items-center shadow-[0_0_0_2px_#141417]">{badge}</span>}
  </button>;
}

const segmentStyle = (state: EpisodeModeState, picked: boolean, progress?: number): React.CSSProperties => {
  if (picked && state === 'future') return { background: HATCH, boxShadow: `inset 0 0 0 1.5px ${SKY}` };
  if (picked) return { background: '#27272a', boxShadow: 'inset 0 0 0 1.5px #E5A93D' };
  if (state === 'programmed') return { background: HATCH, boxShadow: `inset 0 0 0 1.5px ${SKY}` };
  if (state === 'seen') return { background: '#E5A93D' };
  if (state === 'present') return { background: '#F4F4F5' };
  if (state === 'active') { const pct = Math.max(0, Math.min(100, Number(progress) || 0)); return { background: `linear-gradient(90deg,#F4F4F5 ${pct}%,#3f3f46 ${pct}%)` }; }
  if (state === 'attention') return { background: 'rgba(251,113,133,0.6)' };
  if (state === 'future') return { background: HATCH };
  return { background: '#3f3f46' };
};

const STATE_LABEL: Record<EpisodeModeState, string> = { seen: 'vu', present: 'téléchargé', active: 'en cours', attention: 'à régler', future: 'à venir, programmable', available: 'disponible', programmed: 'programmé' };

const LEGEND: Array<{ state: EpisodeModeState; one: string; many: string; dot: React.CSSProperties }> = [
  { state: 'seen', one: 'vu', many: 'vus', dot: { background: '#E5A93D' } },
  { state: 'present', one: 'téléchargé', many: 'téléchargés', dot: { background: '#F4F4F5' } },
  { state: 'active', one: 'en cours', many: 'en cours', dot: { background: 'linear-gradient(90deg,#F4F4F5 50%,#3f3f46 50%)' } },
  { state: 'attention', one: 'à régler', many: 'à régler', dot: { background: 'rgba(251,113,133,0.6)' } },
  { state: 'programmed', one: 'programmé', many: 'programmés', dot: { background: '#141417', boxShadow: `inset 0 0 0 1.5px ${SKY}` } }
];

export function DownloadModeBanner({ season, states, progress, picked, allPicked, canPick, onToggleAll, onSegment }: {
  season: number; states: readonly { episode: number; state: EpisodeModeState }[]; progress: (episode: number) => number | undefined;
  picked: ReadonlySet<number>; allPicked: boolean; canPick: boolean; onToggleAll: () => void;
  /** Toucher un segment coche ou décoche son épisode (s'il se coche) et fait défiler jusqu'à sa ligne. */
  onSegment: (episode: number) => void;
}) {
  const counts = states.reduce<Record<string, number>>((acc, entry) => { acc[entry.state] = (acc[entry.state] || 0) + 1; return acc; }, {});
  const legend = LEGEND.filter(entry => counts[entry.state]).map(entry => ({ ...entry, label: `${counts[entry.state]} ${counts[entry.state] > 1 ? entry.many : entry.one}` }));
  return <section aria-label="Mode téléchargement" className="rounded-[18px] bg-[#1E1A12] shadow-[inset_0_0_0_1.5px_rgba(229,169,61,0.6)] px-3.5 pt-3 pb-2 flex flex-col animate-in fade-in slide-in-from-top-1 duration-150 motion-reduce:animate-none">
    <strong className="text-[15px] font-extrabold text-[#F2C36B]">Mode téléchargement · saison {season}</strong>
    <span className="text-[12.5px] text-zinc-300">{states.some(entry => entry.state === 'future' || entry.state === 'programmed') ? 'Coche les épisodes. En bleu : programmés pour leur sortie.' : 'Touche une barre ou un épisode pour le cocher.'}</span>
    {/* Segments de 44 × 44 px au minimum : chaque épisode se touche directement ; une longue saison défile
        horizontalement au lieu de réduire les cibles à quelques pixels. Le numéro situe l'épisode. */}
    <div className="flex gap-[3px] mt-1 overflow-x-auto hide-scrollbar snap-x" role="group" aria-label={`Saison ${season} : ${legend.map(entry => entry.label).join(', ') || 'rien de téléchargé'}`}>
      {states.map(entry => {
        const selectable = isEpisodePickable(entry.state);
        const isPicked = picked.has(entry.episode);
        return <button key={entry.episode} type="button" data-mode-segment={entry.episode} onClick={() => onSegment(entry.episode)} aria-pressed={selectable ? isPicked : undefined}
          aria-label={`Épisode ${entry.episode} : ${isPicked ? 'coché' : STATE_LABEL[entry.state]}`} className="flex-1 min-w-11 h-11 shrink-0 snap-start flex flex-col justify-center gap-1 active:scale-95 transition-transform">
          <span aria-hidden="true" className={cn('text-[10.5px] font-extrabold leading-none text-center', isPicked ? 'text-[#F2C36B]' : 'text-zinc-500')}>{entry.episode}</span>
          <span className="block w-full h-[9px] rounded-[3px]" style={segmentStyle(entry.state, isPicked, progress(entry.episode))} />
        </button>;
      })}
    </div>
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      {legend.map(entry => <span key={entry.state} className="inline-flex items-center gap-1.5 text-[12px] font-bold text-zinc-300"><i aria-hidden="true" className="w-[9px] h-[9px] rounded-[3px]" style={entry.dot} />{entry.label}</span>)}
      {canPick && <button type="button" onClick={onToggleAll} className="ml-auto min-h-11 px-3 rounded-xl bg-[rgba(229,169,61,0.14)] text-[13.5px] font-extrabold text-[#F2C36B] active:scale-95">{allPicked ? 'Tout décocher' : 'Tout cocher'}</button>}
    </div>
  </section>;
}

export function DownloadModeBar({ title, detail, enabled, onLaunch, onPrecise, onExit, tone = 'gold' }: { title: string; detail: string; enabled: boolean; onLaunch: (quality: '1080p' | '4k') => void; onPrecise?: () => void; onExit: () => void; tone?: 'gold' | 'sky' }) {
  // La fiche vit dans un contexte d'empilement (z-150) sous la navigation (z-160) : la barre passe par un
  // portail sur document.body pour recouvrir réellement la navigation et recevoir les appuis. Une seule
  // ligne de 60 px (retour terrain du 07/11) : la liste n'est plus cachée par un grand panneau.
  const bar = <div role="region" aria-label="Lancer le téléchargement" data-mode-bar className="fixed inset-x-2.5 bottom-[calc(10px+env(safe-area-inset-bottom,0px))] z-[170] max-w-md mx-auto rounded-[22px] bg-[rgba(22,22,26,0.96)] backdrop-blur-xl p-2 flex items-center gap-2 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.13),0_14px_34px_rgba(0,0,0,0.6)] animate-in fade-in slide-in-from-bottom-2 duration-200 motion-reduce:animate-none">
    <button type="button" onClick={onExit} aria-label="Quitter le mode téléchargement" className="w-11 h-11 shrink-0 grid place-items-center rounded-full bg-white/10 text-zinc-100 active:scale-95"><X size={20} /></button>
    {onPrecise && enabled
      ? <button type="button" onClick={onPrecise} className="flex-1 min-w-0 min-h-11 flex flex-col justify-center text-left leading-tight"><strong className="truncate text-[14.5px] font-extrabold text-white">{title}</strong><span className="text-[12.5px] font-bold text-zinc-400">Version précise ›</span></button>
      : <span className="flex-1 min-w-0 min-h-11 flex flex-col justify-center leading-tight"><strong className="truncate text-[14.5px] font-extrabold text-white">{title}</strong><span className={cn('truncate text-[12.5px]', tone === 'sky' ? 'font-bold text-[#7DD3FC]' : 'text-zinc-400')}>{detail}</span></span>}
    {/* Bleu : le film à venir est programmé pour sa sortie (maquette DlFilm). */}
    <button type="button" disabled={!enabled} onClick={() => onLaunch('1080p')} className={cn('h-11 shrink-0 px-3.5 rounded-[13px] text-black text-[15px] font-extrabold active:scale-[0.97] disabled:bg-zinc-800 disabled:text-zinc-500', tone === 'sky' ? 'bg-[#7DD3FC]' : 'bg-[#E5A93D]')}>1080p</button>
    <button type="button" disabled={!enabled} onClick={() => onLaunch('4k')} className="h-11 shrink-0 px-3.5 rounded-[13px] bg-zinc-800 text-zinc-100 text-[15px] font-extrabold shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] active:scale-[0.97] disabled:text-zinc-500">4K</button>
  </div>;
  return typeof document === 'undefined' ? bar : createPortal(bar, document.body);
}

/** Contrôle de droite en mode : sélection (or) ou état du téléchargement, à la place du Vu. */
export function EpisodeModeControl({ episode, state, picked, progress, onToggle }: { episode: number; state: EpisodeModeState; picked: boolean; progress?: number; onToggle: () => void }) {
  if (isEpisodeSelectable(state)) {
    const ring = state === 'attention' && !picked ? '#FB7185' : '#A1A1AA';
    return <button type="button" role="checkbox" aria-checked={picked} aria-label={`${state === 'attention' ? 'Relancer' : 'Télécharger'} l’épisode ${episode}`} onClick={event => { event.stopPropagation(); onToggle(); }} className="w-11 h-11 shrink-0 grid place-items-center">
      <svg viewBox="0 0 100 100" width="34" height="34" aria-hidden="true">
        {picked ? <circle cx="50" cy="50" r="42" fill="#E5A93D" /> : <circle cx="50" cy="50" r="38" fill="none" stroke={ring} strokeWidth="8" />}
        <path d="M50 30v34M36 51l14 14 14-14" fill="none" stroke={picked ? '#0B0B0D' : ring} strokeWidth={picked ? 10 : 8} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>;
  }
  if (state === 'active') {
    const pct = Math.max(0, Math.min(100, Math.round(Number(progress) || 0)));
    return <span role="img" aria-label={`Épisode ${episode} : ${pct} %`} className="w-11 h-11 shrink-0 grid place-items-center">
      <svg viewBox="0 0 100 100" width="34" height="34" aria-hidden="true"><circle cx="50" cy="50" r="38" fill="none" stroke="#3f3f46" strokeWidth="9" /><circle cx="50" cy="50" r="38" fill="none" stroke="#F4F4F5" strokeWidth="9" strokeLinecap="round" strokeDasharray={`${(2 * Math.PI * 38 * pct / 100).toFixed(1)} 239`} transform="rotate(-90 50 50)" /><text x="50" y="59" textAnchor="middle" fontSize="27" fontWeight="800" fill="#F4F4F5">{pct}</text></svg>
    </span>;
  }
  if (state === 'present') return <span role="img" aria-label={`Épisode ${episode} téléchargé`} className="w-11 h-11 shrink-0 grid place-items-center"><svg viewBox="0 0 100 100" width="34" height="34" aria-hidden="true"><circle cx="50" cy="50" r="42" fill="#F4F4F5" /><path d="M50 27v30M37 45l13 13 13-13M34 70h32" fill="none" stroke="#0B0B0D" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" /></svg></span>;
  return <span aria-hidden="true" className="w-11 h-11 shrink-0" />;
}

/** #879 — Contrôle d'un épisode à venir en mode : case bleue « Programmer », ou état programmé. */
export function EpisodeProgramControl({ episode, state, picked, onToggle }: { episode: number; state: EpisodeModeState; picked: boolean; onToggle: () => void }) {
  if (state === 'programmed') return <span role="img" aria-label={`Épisode ${episode} programmé dans Sonarr`} className="w-11 h-11 shrink-0 grid place-items-center">
    <svg viewBox="0 0 100 100" width="34" height="34" aria-hidden="true"><circle cx="50" cy="50" r="40" fill="none" stroke={SKY} strokeWidth="8" /><path d="M50 30v22l14 9" fill="none" stroke={SKY} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" /></svg>
  </span>;
  if (!isEpisodeProgrammable(state)) return null;
  return <button type="button" role="checkbox" aria-checked={picked} aria-label={`Programmer l’épisode ${episode}`} onClick={event => { event.stopPropagation(); onToggle(); }} className="w-11 h-11 shrink-0 grid place-items-center">
    <svg viewBox="0 0 100 100" width="34" height="34" aria-hidden="true">
      {picked ? <circle cx="50" cy="50" r="42" fill={SKY} /> : <circle cx="50" cy="50" r="38" fill="none" stroke={SKY} strokeWidth="8" strokeDasharray="10 7" />}
      <path d="M50 30v22l14 9" fill="none" stroke={picked ? '#0B0B0D' : SKY} strokeWidth={picked ? 10 : 8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </button>;
}

/** Pastille passive sur la vignette, hors mode : seulement quand il se passe quelque chose. */
export function EpisodePassiveChip({ state, progress }: { state: EpisodeModeState; progress?: number }) {
  const label = state === 'active' ? `${Math.max(0, Math.min(99, Math.round(Number(progress) || 0)))} %` : state === 'present' ? '✓ Prêt' : state === 'attention' ? '!' : state === 'programmed' ? 'Programmé' : null;
  if (!label) return null;
  return <span aria-hidden="true" className={cn('absolute right-1 bottom-1 rounded-md px-1.5 text-[10.5px] font-extrabold leading-[1.45]', state === 'attention' ? 'bg-rose-400 text-rose-950' : state === 'programmed' ? 'bg-black/85 text-sky-300' : 'bg-black/85 text-zinc-100')}>{label}</span>;
}

/** État de chaque épisode d'une saison pour le bandeau du mode (même calcul que les lignes). */
export function seasonModeStates(episodes: readonly { episode_number: number; air_date?: string | null }[] | null, seen: (episode: number) => boolean, presentation: (episode: number, aired: boolean) => EpisodeDownloadPresentation, today: string): { episode: number; state: EpisodeModeState }[] {
  return (episodes || []).map(entry => {
    const aired = !entry.air_date || entry.air_date <= today;
    return { episode: entry.episode_number, state: seen(entry.episode_number) ? 'seen' : presentation(entry.episode_number, aired).kind };
  });
}
