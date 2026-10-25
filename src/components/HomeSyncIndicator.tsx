import { canPausePlexSync, isPlexSyncTerminal } from '../features/plex/plexSyncPresentation';
import { auth } from '../lib/firebase';
import { useEffect, useState } from 'react';
import { readUserScopedJson, subscribeUserScopedStorageField } from '../lib/userIsolation';
import type { PlexSyncStatus } from '../store/syncStore';
import { X } from 'lucide-react';
import { useSyncStore } from '../store/syncStore';
import { DialogLayer } from './ui/DialogLayer';

/** Subscribe here so a Plex progress message never renders the media lists. */
export function HomeSyncIndicator() {
  const activePlex = useSyncStore(state => state.plexSyncStatus);
  const details = useSyncStore(state => state.syncStatus);
  const uid = auth.currentUser?.uid;
  const [lastReport, setLastReport] = useState<PlexSyncStatus | null>(null);
  useEffect(() => { const refresh = () => setLastReport(readUserScopedJson<PlexSyncStatus | null>(uid, 'plex_last_sync_report_v1', null)); refresh(); return subscribeUserScopedStorageField(uid, 'plex_last_sync_report_v1', refresh); }, [uid]);
  const ownedActivePlex = activePlex?.progress && activePlex.progress.uid !== uid ? null : activePlex;
  const plex = ownedActivePlex || (!details && lastReport?.progress?.uid === uid ? lastReport : null);
  const pausedUid = useSyncStore(state => state.plexPauseUid);
  const [open, setOpen] = useState(false);
  const message = plex?.message || (details ? `Actualisation de ${details.current}` : 'Synchronisation terminée');
  const progress = plex?.progress?.uid === auth.currentUser?.uid ? plex.progress : undefined;
  const paused = pausedUid === auth.currentUser?.uid;
  const label = plex ? 'Synchro Plex' : 'Métadonnées des séries';
  const counts = /\((\d+)\/(\d+)\)/.exec(plex?.message || '');
  const total = progress ? progress.phase === 'collect' ? undefined : (progress.historyTotal || 0) + (progress.watchlistTotal || 0) : counts ? Number(counts[2]) : details?.total;
  const completed = progress ? progress.phase === 'done' || progress.phase === 'save' ? total : progress.phase === 'watchlist' ? (progress.historyTotal || 0) + progress.processed : progress.phase === 'watched' ? progress.processed : 0 : counts ? Number(counts[1]) : details ? details.total - details.pending : undefined;
  const settled = isPlexSyncTerminal(progress?.phase, message);
  const canPause = canPausePlexSync(ownedActivePlex, uid);
  const successful = progress ? progress.phase === 'done' : /terminé|à jour/i.test(message);
  const percent = total && completed !== undefined ? Math.min(100, Math.max(0, Math.round(completed / total * 100))) : undefined;
  if (!plex && !details && !open) return null;
  const ring = <span className={`home-sync-ring${percent === undefined && !settled ? ' home-sync-ring--waiting' : ''}`} role="progressbar" aria-label="Progression de la synchronisation" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={message} style={{ '--sync-progress': `${successful ? 100 : percent ?? (settled ? 0 : 25)}%` } as React.CSSProperties}><span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 2h7.5l7.5 10-7.5 10H4l7.5-10L4 2z" /></svg></span></span>;
  return <>
    <button type="button" className="home-sync-button" aria-label={`Détails de la synchronisation ${plex ? 'Plex' : 'des métadonnées'}`} title={message} onClick={() => setOpen(true)}>{ring}</button>
    {open && <DialogLayer label={label} onDismiss={() => setOpen(false)} className="fixed inset-0 flex items-end sm:items-center justify-center bg-black/65 p-4 pb-nav">
      <section className="home-sync-sheet">
        <header>{ring}<div><h2>{label}{percent !== undefined ? ` · ${percent} %` : ''}</h2><p>Tu peux continuer à utiliser SeenIt</p></div><button type="button" data-dialog-initial-focus aria-label="Fermer la synchronisation" onClick={() => setOpen(false)}><X size={20} /></button></header>
        <p role="status">{paused ? 'En pause · la collecte en cours termine avant la pause' : message}</p>
        {progress && <><div className="home-sync-sheet__bar" role="presentation"><span style={{width:`${percent ?? 0}%`}} /></div>
          <dl className="home-sync-sheet__metrics"><div><dt>Watchlist</dt><dd>{progress.watchlistTotal === undefined ? 'en cours…' : `${progress.watchlistTotal} titres reçus`}</dd></div><div><dt>Vus / non vus</dt><dd>{progress.phase === 'watched' && progress.total !== undefined ? `${progress.processed} / ${progress.total}` : progress.historyTotal === undefined ? 'en cours…' : `${progress.historyTotal} visionnages reçus`}</dd></div><div><dt>Disponibilités</dt><dd>{progress.mode === 'delta' ? 'cache conservé · delta' : progress.complete ? 'collecte complète' : 'collecte partielle / en cours'}</dd></div></dl>
          <h3>Serveurs</h3>{!progress.servers.length && <p>Collecte en cours · aucun bilan reçu pour le moment</p>}
          <ul className="home-sync-sheet__servers">{progress.servers.map((server, index) => <li key={server.id || index}><strong>{server.name}</strong>{server.owned !== undefined && <small>{server.owned ? 'ton serveur' : 'partagé'}</small>}<span>{server.reason || `${server.watchedItems ?? 0} vus · ${server.inventoryItems ?? 0} indexés`}</span><i data-complete={!server.reason} /></li>)}</ul>
          <p>{progress.mode === 'delta' ? 'Vérification des changements récents. Le cache des disponibilités reste affiché.' : 'Scan complet des serveurs accessibles, personnels et partagés.'} Les serveurs ignorés sont indiqués ci-dessus.</p>
          {progress.changed !== undefined && <p>{progress.changed} changements · {progress.alreadyWatched || 0} déjà vus · {progress.unresolved || 0} identités non résolues</p>}
          {canPause && <button type="button" className="home-sync-sheet__pause" onClick={() => { if (canPausePlexSync(useSyncStore.getState().plexSyncStatus, auth.currentUser?.uid)) useSyncStore.getState().setPlexPauseUid(paused ? null : auth.currentUser?.uid || null); }}>{paused ? 'Reprendre' : 'Mettre en pause'}</button>}
        </>}
        {total !== undefined && completed !== undefined && <p className="home-sync-sheet__count">{completed} sur {total} éléments traités</p>}
        {details && plex && <p>Actualisation des séries : {details.current} · {details.pending} en attente</p>}
      </section>
    </DialogLayer>}
  </>;
}
