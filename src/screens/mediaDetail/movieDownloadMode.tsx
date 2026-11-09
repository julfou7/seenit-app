import React, { useState } from 'react';
import { CalendarClock, Loader2 } from 'lucide-react';
import { DownloadMark } from '../../components/SeenItLogo';
import { cn } from '../../lib/utils';

/**
 * Maquette DlFilm — mode téléchargement de la fiche film. Hors mode, un seul bouton ⬇ de 56 px à côté du
 * bouton principal ; il montre l'état réel du film : pourcentage pendant le téléchargement, horloge bleue
 * quand Radarr attend sa sortie. En mode, la barre compacte des séries demande la qualité.
 */
export type FilmDownloadState = 'idle' | 'mode' | 'active' | 'waiting' | 'programmed';

const BUTTON_LABEL: Record<FilmDownloadState, string> = {
  idle: 'Télécharger le film',
  mode: 'Quitter le mode téléchargement',
  active: 'Téléchargement en cours',
  waiting: 'Téléchargement en attente de disponibilité',
  programmed: 'Programmé pour sa sortie'
};

export function MovieDownloadButton({ state, progress, upcoming, onPress }: { state: FilmDownloadState; progress: number; upcoming: boolean; onPress: () => void }) {
  const pct = Math.max(0, Math.min(100, Math.floor(progress)));
  const label = state === 'active' ? `${BUTTON_LABEL.active}, ${pct} %` : state === 'idle' && upcoming ? 'Programmer le film' : BUTTON_LABEL[state];
  return <button type="button" onClick={onPress} aria-pressed={state === 'mode'} aria-label={label} data-film-download={state}
    className={cn('w-14 h-14 shrink-0 rounded-2xl grid place-items-center active:scale-95',
      state === 'mode' ? 'bg-[#7DD3FC] text-black'
        : state === 'programmed' ? 'bg-[#0E1A20] text-[#7DD3FC] shadow-[inset_0_0_0_1.5px_rgba(125,211,252,0.8)]'
          : state === 'active' ? 'relative text-white'
            : 'bg-zinc-800 text-zinc-200 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]')}
    style={state === 'active' ? { background: `conic-gradient(#F4F4F5 0 ${pct}%, #3F3F46 ${pct}% 100%)` } : undefined}>
    {state === 'active' ? <span className="absolute inset-[4px] rounded-[12px] bg-[#18181B] grid place-items-center text-[13px] font-extrabold">{pct} %</span> : state === 'programmed' ? <CalendarClock size={22} /> : <DownloadMark size={34} strokeWidth={1.9} />}
  </button>;
}

/** Suivi du film dans la fiche : en cours (barre et temps), pas encore trouvé, ou programmé ; « Annuler ». */
export function MovieDownloadTrack({ state, quality, progress, timeleft, waitingHint, onCancel }: {
  state: Extract<FilmDownloadState, 'active' | 'waiting' | 'programmed'>; quality?: string; progress: number; timeleft?: string; waitingHint?: string;
  onCancel: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const pct = Math.max(0, Math.min(100, Math.floor(progress)));
  const programmed = state === 'programmed';
  const title = programmed ? 'Programmé pour sa sortie' : state === 'waiting' ? 'Pas encore trouvé' : `Téléchargement${quality ? ` · ${quality}` : ''}`;
  const sub = programmed ? 'Radarr le récupère dès sa sortie' : state === 'waiting' ? waitingHint || 'On réessaie automatiquement.' : [`${pct} %`, timeleft && timeleft !== '--' ? `≈ ${timeleft}` : ''].filter(Boolean).join(' · ');
  const cancel = async () => {
    // Retirer un téléchargement en cours se confirme ; déprogrammer ne supprime rien.
    if (!programmed && !confirming) { setConfirming(true); return; }
    setBusy(true);
    try { await onCancel(); } finally { setBusy(false); setConfirming(false); }
  };
  return <section aria-label="Téléchargement du film" data-film-track={state} className="rounded-[20px] bg-[#141417] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)]">
    <div className="flex items-center gap-3 px-3.5 py-3">
      <span aria-hidden="true" className={cn('w-[42px] h-[42px] shrink-0 rounded-[10px] grid place-items-center', programmed ? 'bg-[#0E1A20] text-[#7DD3FC]' : 'bg-zinc-800 text-zinc-100')}>{programmed ? <CalendarClock size={20} /> : <DownloadMark size={22} />}</span>
      <div className="flex-1 min-w-0">
        <strong className="block text-[15px] font-extrabold text-white">{confirming ? 'Annuler le téléchargement ?' : title}</strong>
        <small className={cn('block text-[13px] font-bold', programmed ? 'text-[#7DD3FC]' : 'text-zinc-300')}>{confirming ? 'Le fichier déjà reçu est conservé.' : sub}</small>
        {state === 'active' && !confirming && <span role="progressbar" aria-label="Progression du film" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="block mt-1.5 h-1 rounded-[3px] bg-zinc-700 overflow-hidden"><i className="block h-full rounded-[3px] bg-zinc-100" style={{ width: `${pct}%` }} /></span>}
      </div>
      {confirming && <button type="button" onClick={() => setConfirming(false)} className="min-h-11 px-2.5 rounded-xl text-[13.5px] font-bold text-zinc-300">Garder</button>}
      <button type="button" disabled={busy} onClick={() => void cancel()} className={cn('min-h-11 px-2.5 rounded-xl text-[13.5px] font-bold flex items-center gap-1.5 disabled:opacity-60', confirming ? 'text-rose-300' : 'text-zinc-300')}>
        {busy && <Loader2 size={15} className="animate-spin" />}Annuler
      </button>
    </div>
  </section>;
}
