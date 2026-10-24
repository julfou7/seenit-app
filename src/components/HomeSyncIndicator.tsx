import { useState } from 'react';
import { X } from 'lucide-react';
import { useSyncStore } from '../store/syncStore';
import { DialogLayer } from './ui/DialogLayer';

/** Subscribe here so a Plex progress message never renders the media lists. */
export function HomeSyncIndicator() {
  const plex = useSyncStore(state => state.plexSyncStatus);
  const details = useSyncStore(state => state.syncStatus);
  const [open, setOpen] = useState(false);
  const message = plex?.message || (details ? `Actualisation de ${details.current}` : 'Synchronisation terminée');
  const counts = /\((\d+)\/(\d+)\)/.exec(plex?.message || '');
  const total = counts ? Number(counts[2]) : details?.total;
  const completed = counts ? Number(counts[1]) : details ? details.total - details.pending : undefined;
  const settled = /terminé|à jour|erreur|pause/i.test(message);
  const percent = total && completed !== undefined ? Math.min(100, Math.max(0, Math.round(completed / total * 100))) : undefined;
  if (!plex && !details && !open) return null;
  const ring = <span className={`home-sync-ring${percent === undefined && !settled ? ' home-sync-ring--waiting' : ''}`} role="progressbar" aria-label="Progression de la synchronisation" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={message} style={{ '--sync-progress': `${settled ? 100 : percent ?? 25}%` } as React.CSSProperties}><span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 2h7.5l7.5 10-7.5 10H4l7.5-10L4 2z" /></svg></span></span>;
  return <>
    <button type="button" className="home-sync-button" aria-label="Détails de la synchronisation Plex" title={message} onClick={() => setOpen(true)}>{ring}</button>
    {open && <DialogLayer label="Synchronisation Plex" onDismiss={() => setOpen(false)} className="fixed inset-0 flex items-end sm:items-center justify-center bg-black/65 p-4 pb-nav">
      <section className="home-sync-sheet">
        <header>{ring}<div><h2>Synchronisation Plex{percent !== undefined ? ` · ${percent} %` : ''}</h2><p>Tu peux continuer à utiliser SeenIt</p></div><button type="button" data-dialog-initial-focus aria-label="Fermer la synchronisation" onClick={() => setOpen(false)}><X size={20} /></button></header>
        <p role="status">{message}</p>
        {total !== undefined && completed !== undefined && <p className="home-sync-sheet__count">{completed} sur {total} éléments traités</p>}
        {details && plex && <p>Actualisation des séries : {details.current} · {details.pending} en attente</p>}
      </section>
    </DialogLayer>}
  </>;
}
