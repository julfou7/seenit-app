import React from 'react';
import { createPortal } from 'react-dom';
import { Download } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { EpisodeDownloadPresentation } from '../../features/downloads/episodeDownloadPresentation';

/**
 * #879 — Mode téléchargement de la fiche série : une surcouche, jamais des boutons partout.
 * Hors mode, la fiche ne garde qu'un bouton ⬇ (avec le nombre de téléchargements actifs) et des
 * pastilles passives sur les vignettes. En mode, le contrôle de sélection remplace le Vu de chaque
 * épisode, le bandeau montre la saison et la barre d'action du bas demande la qualité (1080p ou 4K).
 */
export type EpisodeModeState = 'seen' | EpisodeDownloadPresentation['kind'];

/** Un épisode peut être coché s'il est sorti, sans fichier ni téléchargement actif (un échec se relance). */
export const isEpisodeSelectable = (state: EpisodeModeState) => state === 'available' || state === 'attention';

export function DownloadModeToggle({ active, badge, onToggle }: { active: boolean; badge: number; onToggle: () => void }) {
  return <button type="button" onClick={onToggle} aria-pressed={active} aria-label={active ? 'Quitter le mode téléchargement' : `Mode téléchargement${badge ? `, ${badge} en cours` : ''}`}
    className={cn('relative w-[52px] h-[52px] shrink-0 rounded-[15px] grid place-items-center active:scale-95', active ? 'bg-[#E5A93D] text-black' : 'bg-zinc-800 text-zinc-200 shadow-[0_0_0_1px_rgba(255,255,255,0.12)]')}>
    <Download size={22} />
    {badge > 0 && <span aria-hidden="true" className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-zinc-100 text-black text-[11px] font-extrabold grid place-items-center shadow-[0_0_0_2px_#141417]">{badge}</span>}
  </button>;
}

const segmentStyle = (state: EpisodeModeState, picked: boolean, progress?: number): React.CSSProperties => {
  if (picked) return { background: '#27272a', boxShadow: 'inset 0 0 0 1.5px #E5A93D' };
  if (state === 'seen') return { background: '#E5A93D' };
  if (state === 'present') return { background: '#F4F4F5' };
  if (state === 'active') { const pct = Math.max(0, Math.min(100, Number(progress) || 0)); return { background: `linear-gradient(90deg,#F4F4F5 ${pct}%,#3f3f46 ${pct}%)` }; }
  if (state === 'attention') return { background: 'rgba(251,113,133,0.6)' };
  if (state === 'future') return { background: 'repeating-linear-gradient(135deg,#2a2a2f 0 2px,#141417 2px 4px)' };
  return { background: '#3f3f46' };
};

const LEGEND: Array<{ state: EpisodeModeState; one: string; many: string; dot: React.CSSProperties }> = [
  { state: 'seen', one: 'vu', many: 'vus', dot: { background: '#E5A93D' } },
  { state: 'present', one: 'téléchargé', many: 'téléchargés', dot: { background: '#F4F4F5' } },
  { state: 'active', one: 'en cours', many: 'en cours', dot: { background: 'linear-gradient(90deg,#F4F4F5 50%,#3f3f46 50%)' } },
  { state: 'attention', one: 'à régler', many: 'à régler', dot: { background: 'rgba(251,113,133,0.6)' } }
];

export function DownloadModeBanner({ season, states, progress, picked, allPicked, canPick, onToggleAll, onExit }: {
  season: number; states: readonly { episode: number; state: EpisodeModeState }[]; progress: (episode: number) => number | undefined;
  picked: ReadonlySet<number>; allPicked: boolean; canPick: boolean; onToggleAll: () => void; onExit: () => void;
}) {
  const counts = states.reduce<Record<string, number>>((acc, entry) => { acc[entry.state] = (acc[entry.state] || 0) + 1; return acc; }, {});
  const legend = LEGEND.filter(entry => counts[entry.state]).map(entry => ({ ...entry, label: `${counts[entry.state]} ${counts[entry.state] > 1 ? entry.many : entry.one}` }));
  return <section aria-label="Mode téléchargement" className="rounded-[18px] bg-[#1E1A12] shadow-[inset_0_0_0_1.5px_rgba(229,169,61,0.6)] px-3.5 py-3 flex flex-col gap-2.5 animate-in fade-in slide-in-from-top-1 duration-150 motion-reduce:animate-none">
    <div className="flex items-center gap-2.5">
      <span className="flex-1 min-w-0"><strong className="block text-[15px] font-extrabold text-[#F2C36B]">Mode téléchargement</strong><span className="text-[12.5px] text-zinc-300">Coche les épisodes de la saison {season} à récupérer.</span></span>
      <button type="button" onClick={onExit} className="min-h-11 px-3.5 rounded-xl bg-white/10 text-[14px] font-extrabold text-zinc-100 active:scale-95">Terminé</button>
    </div>
    <div className="flex gap-[3px]" role="img" aria-label={`Saison ${season} : ${legend.map(entry => entry.label).join(', ') || 'rien de téléchargé'}`}>
      {states.map(entry => <span key={entry.episode} className="flex-1 h-[7px] rounded-[3px]" style={segmentStyle(entry.state, picked.has(entry.episode), progress(entry.episode))} />)}
    </div>
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      {legend.map(entry => <span key={entry.state} className="inline-flex items-center gap-1.5 text-[12px] font-bold text-zinc-300"><i aria-hidden="true" className="w-[9px] h-[9px] rounded-[3px]" style={entry.dot} />{entry.label}</span>)}
      {canPick && <button type="button" onClick={onToggleAll} className="ml-auto min-h-11 text-[14px] font-extrabold text-[#F2C36B]">{allPicked ? 'Tout décocher' : 'Tout cocher'}</button>}
    </div>
  </section>;
}

export function DownloadModeBar({ title, detail, enabled, onLaunch, onPrecise }: { title: string; detail: string; enabled: boolean; onLaunch: (quality: '1080p' | '4k') => void; onPrecise?: () => void }) {
  // La fiche vit dans un contexte d'empilement (z-150) sous la navigation (z-160) : la barre passe par un
  // portail sur document.body pour recouvrir réellement la navigation et recevoir les appuis.
  const bar = <div role="region" aria-label="Lancer le téléchargement" className="fixed inset-x-2.5 bottom-[calc(10px+env(safe-area-inset-bottom,0px))] z-[170] max-w-md mx-auto rounded-3xl bg-[rgba(22,22,26,0.96)] backdrop-blur-xl p-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.13),0_14px_34px_rgba(0,0,0,0.6)] animate-in fade-in slide-in-from-bottom-2 duration-200 motion-reduce:animate-none">
    <div className="flex items-baseline justify-between gap-3 px-1">
      <strong className="min-w-0 truncate text-[15px] font-extrabold text-white">{title}</strong>
      {onPrecise && <button type="button" onClick={onPrecise} disabled={!enabled} className="shrink-0 min-h-8 text-[13px] font-bold text-zinc-400 disabled:opacity-40">Version précise ›</button>}
    </div>
    <p className="px-1 text-[12.5px] text-zinc-400">{detail}</p>
    <div className="flex gap-2 mt-2.5">
      <button type="button" disabled={!enabled} onClick={() => onLaunch('1080p')} className="flex-1 h-12 rounded-[14px] bg-[#E5A93D] text-black text-[16px] font-extrabold active:scale-[0.98] disabled:bg-zinc-800 disabled:text-zinc-500">1080p</button>
      <button type="button" disabled={!enabled} onClick={() => onLaunch('4k')} className="flex-1 h-12 rounded-[14px] bg-zinc-800 text-zinc-100 text-[16px] font-extrabold shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] active:scale-[0.98] disabled:text-zinc-500">4K</button>
    </div>
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

/** Pastille passive sur la vignette, hors mode : seulement quand il se passe quelque chose. */
export function EpisodePassiveChip({ state, progress }: { state: EpisodeModeState; progress?: number }) {
  const label = state === 'active' ? `${Math.max(0, Math.min(99, Math.round(Number(progress) || 0)))} %` : state === 'present' ? '✓ Prêt' : state === 'attention' ? '!' : null;
  if (!label) return null;
  return <span aria-hidden="true" className={cn('absolute right-1 bottom-1 rounded-md px-1.5 text-[10.5px] font-extrabold leading-[1.45]', state === 'attention' ? 'bg-rose-400 text-rose-950' : 'bg-black/85 text-zinc-100')}>{label}</span>;
}

/** État de chaque épisode d'une saison pour le bandeau du mode (même calcul que les lignes). */
export function seasonModeStates(episodes: readonly { episode_number: number; air_date?: string | null }[] | null, seen: (episode: number) => boolean, presentation: (episode: number, aired: boolean) => EpisodeDownloadPresentation, today: string): { episode: number; state: EpisodeModeState }[] {
  return (episodes || []).map(entry => {
    const aired = !entry.air_date || entry.air_date <= today;
    return { episode: entry.episode_number, state: seen(entry.episode_number) ? 'seen' : presentation(entry.episode_number, aired).kind };
  });
}
