import { create } from 'zustand';
import { auth } from '../lib/firebase';
import { useDownloadConfigStore } from './downloadConfigStore';
import { useMediaPresenceStore } from './mediaPresenceStore';
import { fetchProgrammedCalendar, fetchWatchedMovie, programmedScope, type ProgrammedCalendar } from '../features/downloads/programmedCalendar';
import { fetchRecentImports, type ArrPendingTitle, type RecentImports } from '../features/downloads/recentImports';
import { coverArrLibrary } from '../features/downloads/arrCoverage';
import { localizeArrLists } from '../features/downloads/arrMediaLabels';
import { tmdbArrLabelSource } from '../features/downloads/arrMediaSource';

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
export type WatchedMovieDetails = Awaited<ReturnType<typeof fetchWatchedMovie>>;
/** `watched` : films suivis absents du calendrier (dates, qualité, identifiant Radarr), lus dans la même copie. */
/** `undecided` : titres de Sonarr/Radarr ni téléchargés ni programmés (SEENIT-DOWNLOAD-023). */
export interface ArrSnapshot { key: string; programmed: ProgrammedCalendar | null; imports: RecentImports | null; undecided: ArrPendingTitle[]; watched: Record<number, WatchedMovieDetails>; syncedAt: number }
export interface ArrWriteTarget { tmdbId?: number | string; tvdbId?: number | string; mediaType: 'tv' | 'movie' }

interface ArrSyncState {
  snapshot: ArrSnapshot | null;
  /** Incrémenté à chaque écriture de SeenIt : les détails dérivés (dates d'un film suivi…) sont relus. */
  revision: number;
  syncing: boolean;
  /** Films suivis (TMDB) dont les détails sont relus à chaque synchronisation (revue Codex #918). */
  watchedIds: number[];
  watchMovies: (tmdbIds: readonly number[]) => void;
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
  watchedIds: [],
  watchMovies: tmdbIds => {
    const ids = [...new Set(tmdbIds.filter(id => id > 0))].sort((a, b) => a - b);
    if (ids.join(',') === get().watchedIds.join(',')) return;
    set({ watchedIds: ids });
    const snapshot = get().snapshot;
    if (ids.some(id => !snapshot || !(id in snapshot.watched))) { inFlight = null; void get().sync(); }
  },
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
      const watchedIds = get().watchedIds;
      const [programmed, imports, watched] = await Promise.all([
        fetchProgrammedCalendar(config).catch(() => ({ items: [], failures: ['Sonarr/Radarr'] })),
        fetchRecentImports(config).catch((): RecentImports => ({ items: [], failures: ['Sonarr/Radarr'], pending: [] })),
        // Revue Codex #918 : les détails d'un film suivi appartiennent à la même copie (même compte, même
        // serveur) et sont relus à chaque synchronisation ; une lecture échouée est retentée à la suivante.
        Promise.all(watchedIds.map(async id => [id, await fetchWatchedMovie(config, id).catch(() => null)] as const)).then(entries => Object.fromEntries(entries) as Record<number, WatchedMovieDetails>),
      ]);
      // Une réponse arrivée après un changement de compte ou de serveur, ou dépassée par une relecture plus
      // récente (écriture de SeenIt entre-temps), est ignorée.
      if (arrSyncKey() !== key || id !== sequence) return;
      // SEENIT-DOWNLOAD-022 : titres, affiches et notes de la fiche TMDB en français, comme le reste de l'app.
      // SEENIT-DOWNLOAD-023 : chaque titre de Sonarr/Radarr à un endroit (Téléchargés, Programmés ou À décider).
      const coverage = coverArrLibrary(programmed, imports.pending);
      const labelled = await localizeArrLists({ programmed: coverage.programmed, imports, undecided: coverage.undecided }, tmdbArrLabelSource);
      if (arrSyncKey() !== key || id !== sequence) return;
      set({ snapshot: { key, programmed: labelled.programmed, imports: labelled.imports, undecided: labelled.undecided || [], watched, syncedAt: Date.now() } });
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
