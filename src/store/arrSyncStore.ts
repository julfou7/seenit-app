import { create } from 'zustand';
import { auth } from '../lib/firebase';
import { useDownloadConfigStore } from './downloadConfigStore';
import { useMediaPresenceStore } from './mediaPresenceStore';
import { fetchProgrammedCalendar, programmedScope, type ProgrammedCalendar } from '../features/downloads/programmedCalendar';
import { fetchRecentImports, type RecentImports } from '../features/downloads/recentImports';

/**
 * SEENIT-DOWNLOAD-016 — État Sonarr/Radarr synchronisé (retour terrain du 08/11 : « ça serait pas mieux de
 * synchroniser Sonarr et Radarr plutôt que de bricoler un truc à moitié synchronisé ? »).
 *
 * Avant, chaque écran lisait Sonarr/Radarr de son côté, avec son cache et son rythme : l'onglet Télécharger
 * repartait vide puis sautait à chaque ouverture, une fiche restait « programmée » après une annulation faite
 * dans Programmés. Désormais une seule copie, par compte et par serveur, est relue en un seul endroit :
 * - à l'ouverture de l'onglet, au retour dans l'application et quand la file du client change d'état ;
 * - juste après chaque écriture de SeenIt (programmer, annuler, changer la qualité, lancer), avec la présence
 *   de la fiche concernée, pour que fiche, Programmés et Téléchargés disent la même chose.
 * Les écrans ne font que l'afficher ; la dernière copie reste affichée pendant une relecture (pas de saut).
 * Sonarr et Radarr restent la référence : un changement fait dans leur interface apparaît à la synchronisation
 * suivante. Une copie d'un autre compte ou d'un autre serveur n'est jamais affichée.
 */
export interface ArrSnapshot { key: string; programmed: ProgrammedCalendar | null; imports: RecentImports | null; syncedAt: number }
export interface ArrWriteTarget { tmdbId?: number | string; tvdbId?: number | string; mediaType: 'tv' | 'movie' }

interface ArrSyncState {
  snapshot: ArrSnapshot | null;
  /** Incrémenté à chaque écriture de SeenIt : les détails dérivés (dates d'un film suivi…) sont relus. */
  revision: number;
  syncing: boolean;
  sync: (options?: { maxAgeMs?: number }) => Promise<void>;
  afterWrite: (target?: ArrWriteTarget) => void;
}

/** Portée d'une copie : compte connecté + serveurs Sonarr/Radarr (adresse et clé) + réglage Téléchargements. */
export const arrSyncKey = () => `${auth.currentUser?.uid || ''}\n${programmedScope(useDownloadConfigStore.getState())}`;
let inFlight: { key: string; promise: Promise<void> } | null = null;
let sequence = 0;

export const useArrSyncStore = create<ArrSyncState>((set, get) => ({
  snapshot: null,
  revision: 0,
  syncing: false,
  sync: async ({ maxAgeMs = 0 } = {}) => {
    const key = arrSyncKey();
    const current = get().snapshot;
    if (current?.key === key && maxAgeMs > 0 && Date.now() - current.syncedAt < maxAgeMs) return;
    if (inFlight?.key === key) return inFlight.promise;
    // Une copie d'une autre portée n'est jamais montrée, même le temps de la relecture.
    if (current && current.key !== key) set({ snapshot: null });
    const config = useDownloadConfigStore.getState();
    const id = ++sequence;
    const promise = (async () => {
      set({ syncing: true });
      const [programmed, imports] = await Promise.all([
        fetchProgrammedCalendar(config).catch(() => ({ items: [], failures: ['Sonarr/Radarr'] })),
        fetchRecentImports(config).catch(() => ({ items: [], failures: ['Sonarr/Radarr'] })),
      ]);
      // Une réponse arrivée après un changement de compte ou de serveur, ou dépassée par une relecture plus
      // récente (écriture de SeenIt entre-temps), est ignorée.
      if (arrSyncKey() !== key || id !== sequence) return;
      set({ snapshot: { key, programmed, imports, syncedAt: Date.now() } });
    })().finally(() => {
      if (inFlight?.promise === promise) inFlight = null;
      set({ syncing: false });
    });
    inFlight = { key, promise };
    return promise;
  },
  afterWrite: target => {
    set(state => ({ revision: state.revision + 1 }));
    // Une lecture lancée avant l'écriture ne peut pas en tenir compte : elle est remplacée.
    inFlight = null;
    void get().sync();
    if (target?.tmdbId) void useMediaPresenceStore.getState().checkPresence({ tmdbId: target.tmdbId, tvdbId: target.tvdbId, mediaType: target.mediaType, forceRefresh: true }).catch(() => undefined);
  },
}));

/** Copie courante, seulement si elle appartient au compte et au serveur actuels. */
export function useArrSnapshot(): ArrSnapshot | null {
  const snapshot = useArrSyncStore(state => state.snapshot);
  useDownloadConfigStore();
  return snapshot && snapshot.key === arrSyncKey() ? snapshot : null;
}

/** Après une écriture de SeenIt dans Sonarr/Radarr (programmer, annuler, qualité, lancer). */
export const notifyArrWrite = (target?: ArrWriteTarget) => useArrSyncStore.getState().afterWrite(target);
