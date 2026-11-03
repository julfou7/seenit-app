import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import type { PlexCollectProgress } from './plexSyncProgressModel';

/**
 * SEENIT-PLEX-012 — Écoute l'avancement publié par le backend pendant la collecte Plex. Seul le document
 * portant l'identifiant de la synchro en cours est pris en compte (une ancienne synchro est ignorée).
 */
export function createPlexSyncId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  return random || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function watchPlexCollectProgress(uid: string, syncId: string, onUpdate: (progress: PlexCollectProgress) => void): () => void {
  let stopped = false;
  try {
    const unsubscribe = onSnapshot(doc(db, 'users', uid, 'settings', 'plexSyncProgress'), snapshot => {
      const data = snapshot.data() as PlexCollectProgress | undefined;
      if (stopped || !data || data.syncId !== syncId) return;
      onUpdate(data);
    }, () => undefined);
    return () => { stopped = true; unsubscribe(); };
  } catch {
    return () => { stopped = true; };
  }
}

/** Ligne d'état courte pendant la collecte. */
export function describePlexCollect(progress: PlexCollectProgress): string {
  const servers = progress.servers.length;
  const finished = progress.servers.filter(server => server.state === 'done' || server.state === 'skipped').length;
  if (servers > 0 && finished === servers && progress.enrichTotal > 0) return 'Préparation des visionnages Plex…';
  if (servers > 0) return `Lecture des serveurs Plex · ${finished}/${servers}`;
  return progress.mode === 'full' ? 'Lecture de ton compte Plex…' : 'Vérification des visionnages récents…';
}
