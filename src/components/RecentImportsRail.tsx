import React, { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { useDownloadConfigStore } from '../store/downloadConfigStore';
import { useToastStore } from '../store/toastStore';
import { auth } from '../lib/firebase';
import { readUserScopedJson, writeUserScopedJson } from '../lib/userIsolation';
import { arrSyncKey, notifyArrWrite, useArrSnapshot, useArrSyncStore } from '../store/arrSyncStore';
import { recentImportLabel, recentImportServerKey, recentImportsScope, removeRecentImport, visibleRecentImports, type RecentImport } from '../features/downloads/recentImports';
import { frenchArrMessage } from '../features/downloads/arrStatusMessages';
import type { TMDBMedia } from '../features/shows/tmdb';
import { GridMediaCard } from './GridMediaCard';

/**
 * Imports Sonarr/Radarr des 7 derniers jours, lus dans l'état Sonarr/Radarr synchronisé (SEENIT-DOWNLOAD-016) :
 * une copie d'un autre compte ou serveur n'est jamais affichée, et la dernière copie reste affichée pendant une
 * relecture (bug d'affichage du 08/11 : plus de saut à chaque ouverture de l'onglet).
 */
export function useRecentImports(refreshKey = 0): { items: RecentImport[]; failures: string[]; loaded: boolean } {
  const scope = recentImportsScope(useDownloadConfigStore());
  const snapshot = useArrSnapshot();
  useEffect(() => { void useArrSyncStore.getState().sync(); }, [refreshKey, scope]);
  const imports = snapshot?.imports;
  return imports ? { items: imports.items, failures: imports.failures, loaded: true } : { items: [], failures: [], loaded: false };
}

/** Retour terrain du 08/11 (« je veux pouvoir nettoyer aussi ») : « Vider » masque les imports déjà vus. */
const CLEARED_FIELD = 'downloads.recentImports.clearedAt';
/** v1.4.284 : imports retirés un à un (serveur + clé → date de l'import retiré) ; un nouvel import du titre revient. */
const REMOVED_FIELD = 'downloads.recentImports.removed';
const WEEK = 8 * 86_400_000;

const toastMedia = (item: RecentImport) => item.tmdbId ? { tmdbId: item.tmdbId, mediaType: item.kind === 'movie' ? 'movie' as const : 'tv' as const } : null;
const tmdbPosterPath = (url?: string) => url?.match(/image\.tmdb\.org\/t\/p\/[^/]+(\/[^/?#]+)$/)?.[1];
/** Carte d'Explorer d'un import : identité TMDB exacte, affiche TMDB (sinon celle de Sonarr/Radarr), note et année. */
export function importMedia(item: RecentImport): TMDBMedia {
  const date = item.year ? `${item.year}-01-01` : undefined;
  const base = { id: item.tmdbId || 0, poster_path: tmdbPosterPath(item.posterUrl) || null, vote_average: item.rating || 0 };
  return item.kind === 'movie'
    ? { ...base, media_type: 'movie', title: item.title, release_date: date }
    : { ...base, media_type: 'tv', name: item.title, first_air_date: date };
}

/**
 * Section « Téléchargés · 7 derniers jours ». Depuis la v1.4.284 (retour terrain du 09/11 : « reprends exactement
 * cet affichage ») : la grille et la carte d'Explorer (note, logo du diffuseur, titre or, Série/Film et année),
 * avec « Retirer » à la place de « Ajouter ». Retirer sort le titre de la liste et de Radarr/Sonarr en gardant les
 * fichiers ; une série dont Sonarr attend encore des épisodes y reste (décision du propriétaire du 09/11).
 * « Vider » masque toute la liste actuelle sur cet appareil, sans rien supprimer.
 */
export function RecentImportsRail({ items, failures, onShowClick }: { items: RecentImport[]; failures: string[]; onShowClick?: (id: string | number, mediaType?: 'tv' | 'movie') => void }) {
  const uid = auth.currentUser?.uid;
  const [clearedAt, setClearedAt] = useState(() => Number(readUserScopedJson(uid, CLEARED_FIELD, 0)) || 0);
  const [removed, setRemoved] = useState<Record<string, number>>(() => readUserScopedJson<Record<string, number>>(uid, REMOVED_FIELD, {}) || {});
  const [busy, setBusy] = useState<string | null>(null);
  const config = useDownloadConfigStore();
  const keyOf = (item: RecentImport) => recentImportServerKey(config, item);
  const visible = visibleRecentImports(items, clearedAt, removed, keyOf);
  if (!visible.length && !failures.length) return null;
  const toast = useToastStore.getState().showToast;
  const clear = () => {
    const at = Math.max(...items.map(item => item.date), Date.now());
    writeUserScopedJson(uid, CLEARED_FIELD, at);
    setClearedAt(at);
  };
  const remove = async (item: RecentImport) => {
    if (busy) return;
    // Jamais un identifiant lu sur un autre compte ou serveur envoyé au serveur actuel.
    if (useArrSyncStore.getState().snapshot?.key !== arrSyncKey()) {
      toast({ title: 'Téléchargés', action: 'La configuration a changé : liste rechargée, rien n’a été retiré.' }, 'info');
      void useArrSyncStore.getState().sync();
      return;
    }
    setBusy(item.key);
    try {
      const outcome = await removeRecentImport(useDownloadConfigStore.getState(), item);
      const now = Date.now();
      const next = Object.fromEntries([...Object.entries(removed).filter(([, date]) => date > now - WEEK), [keyOf(item), item.date]]);
      writeUserScopedJson(uid, REMOVED_FIELD, next);
      setRemoved(next);
      notifyArrWrite({ tmdbId: item.tmdbId, mediaType: item.kind === 'movie' ? 'movie' : 'tv' });
      // Retour terrain du 09/11 sur la v1.4.286 : l'affiche reste dans le toast, qui ouvre la fiche ; « fichiers
      // gardés » n'apporte rien (Sonarr/Radarr déplacent les fichiers après l'import).
      toast({ title: item.title, action: outcome === 'kept' ? 'Retiré de la liste · la suite reste programmée dans Sonarr' : `Retiré de ${item.kind === 'movie' ? 'Radarr' : 'Sonarr'}`, posterPath: item.posterUrl || null, media: toastMedia(item) }, 'info');
    } catch (error: unknown) {
      toast({ title: item.title, action: frenchArrMessage(error instanceof Error ? error.message : '') || 'Retrait impossible. Réessaie.', posterPath: item.posterUrl || null, media: toastMedia(item) }, 'error');
    } finally {
      setBusy(null);
    }
  };
  return <section className="downloads-section downloads-recent" data-recent-imports>
    <div className="downloads-recent__head">
      <h2>Téléchargés</h2>
      <span>7 derniers jours</span>
      {visible.length > 0 && <button type="button" className="downloads-recent__clear" onClick={clear}>Vider</button>}
    </div>
    {failures.length > 0 && <p className="download-card__meta" role="status">{failures.join(' et ')} injoignable pour l’instant : la liste peut être incomplète.</p>}
    {visible.length > 0 && <ul className="grid grid-cols-3 sm:grid-cols-4 gap-x-1.5 gap-y-4" aria-label="Téléchargés">
      {visible.map(item => <li key={item.key} data-recent-import={item.key} className="min-w-0" title={recentImportLabel(item)}>
        <GridMediaCard media={importMedia(item)} posterSrc={item.posterUrl}
          onShowClick={(id, mediaType) => { if (item.tmdbId && onShowClick) onShowClick(id, mediaType); }}
          action={{ label: 'Retirer', ariaLabel: `Retirer ${item.title} de Téléchargés et de ${item.kind === 'movie' ? 'Radarr' : 'Sonarr'}`, busy: busy === item.key, disabled: busy !== null && busy !== item.key,
            icon: busy === item.key ? <Loader2 size={10} className="animate-spin" aria-hidden="true" /> : <X size={10} aria-hidden="true" />, onSelect: () => void remove(item) }} />
      </li>)}
    </ul>}
  </section>;
}
