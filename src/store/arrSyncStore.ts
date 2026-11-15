import { create } from 'zustand';
import { auth } from '../lib/firebase';
import { readUserScopedJson, writeUserScopedJson } from '../lib/userIsolation';
import { useDownloadConfigStore } from './downloadConfigStore';
import { useMediaPresenceStore } from './mediaPresenceStore';
import { checkWantedReleases, fetchProgrammedCalendar, fetchWatchedMovie, programmedScope, wantedReleaseReader, type ProgrammedCalendar } from '../features/downloads/programmedCalendar';
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

/**
 * Retour terrain du 15/11 : à l'ouverture, seules les demandes SeenIt s'affichaient, puis tout Programmés et
 * Téléchargés apparaissait quelques secondes plus tard. La dernière copie est gardée sur l'appareil, par compte,
 * et montrée tout de suite si elle appartient au même serveur ; la synchronisation la remplace ensuite sans saut.
 * La portée contient les clés d'API : seule son empreinte est enregistrée, jamais la clé.
 */
const PERSISTED_FIELD = 'arr_snapshot_v1';
export function arrScopeFingerprint(key: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index++) hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16);
}
type PersistedSnapshot = { scope: string; snapshot: Omit<ArrSnapshot, 'key'> };
export function readPersistedArrSnapshot(key: string): ArrSnapshot | null {
  const uid = auth.currentUser?.uid;
  if (!uid) return null;
  const saved = readUserScopedJson<PersistedSnapshot | null>(uid, PERSISTED_FIELD, null);
  return saved?.scope === arrScopeFingerprint(key) && saved.snapshot ? { ...saved.snapshot, key } : null;
}
function persistArrSnapshot(snapshot: ArrSnapshot): void {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const { key, programmed, ...rest } = snapshot;
  // `movieQuality` n'est utile que pendant la synchronisation : la copie gardée n'en a pas besoin.
  const stored: PersistedSnapshot = { scope: arrScopeFingerprint(key), snapshot: { ...rest, programmed: programmed ? { items: programmed.items, failures: programmed.failures } : null } };
  try { writeUserScopedJson(uid, PERSISTED_FIELD, stored); } catch { /* Une copie non gardée n'empêche jamais l'affichage. */ }
}
let inFlight: { key: string; promise: Promise<void> } | null = null;
/** Une seule vérification de versions à la fois (indexers ménagés, jamais deux lots concurrents). */
let releaseChecking = false;
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
    // Une copie d'une autre portée n'est jamais montrée, même le temps de la relecture ; la dernière copie
    // gardée pour cette portée l'est, en attendant la relecture.
    if (!current || current.key !== key) set({ snapshot: readPersistedArrSnapshot(key) });
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
      // Retour terrain du 15/11 (v1.4.314) : « Disque plein » prouvé par les versions proposées, sur la liste complète
      // (revue Codex #1053) ; la dernière copie de cette portée garde les vérifications récentes, non refaites.
      // Retour du 15/11 (v1.4.315, « timeout ») : une recherche de versions peut durer 90 s ; les listes s'affichent
      // tout de suite (résultats récents repris), la vérification se poursuit puis met la copie à jour.
      const previous = get().snapshot?.key === key ? get().snapshot?.programmed?.items || [] : [];
      const items = labelled.programmed?.items;
      // Vérification déjà en cours : les résultats récents sont repris, aucune nouvelle lecture n'est lancée.
      const checks = items ? checkWantedReleases(items, previous, Date.now(), wantedReleaseReader(config), releaseChecking ? 0 : undefined) : null;
      const reading = Boolean(checks) && !releaseChecking;
      const snapshot = { key, programmed: labelled.programmed, imports: labelled.imports, undecided: labelled.undecided || [], watched, syncedAt: Date.now() };
      set({ snapshot });
      persistArrSnapshot(snapshot);
      if (checks && reading) {
        releaseChecking = true;
        void checks.catch(() => undefined).finally(() => {
          releaseChecking = false;
          const latest = get().snapshot;
          if (arrSyncKey() !== key || latest?.key !== key || !latest.programmed) return;
          // Revue Codex #1056 : une relecture arrivée pendant la vérification ne perd pas ses résultats ; ils sont
          // reportés sur la copie courante, titre par titre, si la qualité et le profil sont les mêmes.
          const merged = latest.programmed.items.map(item => ({ ...item }));
          void checkWantedReleases(merged, items, Date.now(), wantedReleaseReader(config), 0);
          const updated = { ...latest, programmed: { ...latest.programmed, items: merged } };
          set({ snapshot: updated });
          persistArrSnapshot(updated);
        });
      }
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
  const key = arrSyncKey();
  if (snapshot && snapshot.key === key) return snapshot;
  // Premier affichage, avant même la première relecture : la dernière copie gardée pour ce compte et ce serveur.
  return readPersistedArrSnapshot(key);
}

/** Après une écriture de SeenIt dans Sonarr/Radarr (programmer, annuler, qualité, lancer). */
export const notifyArrWrite = (target?: ArrWriteTarget) => useArrSyncStore.getState().afterWrite(target);
