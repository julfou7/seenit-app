import React, { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { useDownloadConfigStore } from '../store/downloadConfigStore';
import { useToastStore } from '../store/toastStore';
import { auth } from '../lib/firebase';
import { readUserScopedJson, writeUserScopedJson } from '../lib/userIsolation';
import { arrSyncKey, notifyArrWrite, useArrSnapshot, useArrSyncStore } from '../store/arrSyncStore';
import { recentImportLabel, recentImportServerKey, recentImportsScope, removeRecentImport, visibleRecentImports, type ArrPendingTitle, type RecentImport } from '../features/downloads/recentImports';
import { undecidedReason } from '../features/downloads/arrCoverage';
import { LoadMore } from './cards/HomeLoadMore';
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

/** SEENIT-DOWNLOAD-023 : titres de Sonarr/Radarr ni téléchargés ni programmés, de la même copie synchronisée. */
export function useUndecidedTitles(): ArrPendingTitle[] {
  return useArrSnapshot()?.undecided || [];
}

/** v1.4.284 : titres retirés un à un (serveur + clé → date du titre retiré) ; un nouvel import du titre revient. */
const REMOVED_FIELD = 'downloads.recentImports.removed';
/** Une page de la grille, puis le seul « Afficher plus » de l'app (SEENIT-UX-020). */
const PAGE = 12;

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
 * Section « Téléchargés » (et « À décider », même carte). Depuis la v1.4.284 (retour terrain du 09/11 : « reprends
 * exactement cet affichage ») : la grille et la carte d'Explorer, avec « Retirer » à la place de « Ajouter ». Retirer
 * sort le titre de la liste et de Radarr/Sonarr en gardant les fichiers ; une série dont Sonarr attend encore des
 * épisodes y reste (décision du propriétaire du 09/11). Depuis la v1.4.289 (« plus de limite à 7 jours, pour ne pas
 * laisser de données orphelines dans Sonarr/Radarr ») : tout ce qu'ils détiennent avec un fichier, sans limite de
 * date, page par page ; « Vider », qui masquait la liste sans rien retirer, disparaît. « À décider » (SEENIT-DOWNLOAD-023)
 * liste ce qui n'est ni téléchargé ni programmé : toucher l'affiche ouvre la fiche pour décider, ou Retirer.
 */
export function RecentImportsRail({ items, failures, onShowClick, variant = 'imports' }: { items: readonly RecentImport[]; failures: string[]; onShowClick?: (id: string | number, mediaType?: 'tv' | 'movie') => void; variant?: 'imports' | 'undecided' }) {
  const uid = auth.currentUser?.uid;
  const [removed, setRemoved] = useState<Record<string, number>>(() => readUserScopedJson<Record<string, number>>(uid, REMOVED_FIELD, {}) || {});
  const [busy, setBusy] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const config = useDownloadConfigStore();
  const keyOf = (item: RecentImport) => recentImportServerKey(config, item);
  const visible = visibleRecentImports(items, 0, removed, keyOf);
  const undecided = variant === 'undecided';
  if (!visible.length && (undecided || !failures.length)) return null;
  const toast = useToastStore.getState().showToast;
  const remove = async (item: RecentImport) => {
    if (busy) return;
    // Jamais un identifiant lu sur un autre compte ou serveur envoyé au serveur actuel.
    if (useArrSyncStore.getState().snapshot?.key !== arrSyncKey()) {
      toast({ title: undecided ? 'À décider' : 'Téléchargés', action: 'La configuration a changé : liste rechargée, rien n’a été retiré.' }, 'info');
      void useArrSyncStore.getState().sync();
      return;
    }
    setBusy(item.key);
    try {
      const outcome = await removeRecentImport(useDownloadConfigStore.getState(), item);
      // Les retraits mémorisés ne sont plus purgés par date : un titre ancien reste masqué tant qu'il n'a pas changé.
      const next = { ...readUserScopedJson<Record<string, number>>(uid, REMOVED_FIELD, {}), ...removed, [keyOf(item)]: item.date };
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
  const shown = visible.slice(0, limit);
  return <section className={`downloads-section downloads-recent${undecided ? ' downloads-undecided' : ''}`} data-recent-imports={undecided ? undefined : ''} data-undecided={undecided ? '' : undefined}>
    <div className="downloads-recent__head">
      <h2>{undecided ? 'À décider' : 'Téléchargés'}</h2>
      {visible.length > 0 && <span>{visible.length} titre{visible.length > 1 ? 's' : ''}</span>}
    </div>
    {undecided && <p className="downloads-undecided__intro">Dans Sonarr ou Radarr, ni téléchargés ni programmés. Touche une affiche pour décider dans la fiche, ou retire-les.</p>}
    {failures.length > 0 && <p className="download-card__meta" role="status">{failures.join(' et ')} injoignable pour l’instant : la liste peut être incomplète.</p>}
    {visible.length > 0 && <ul className="grid grid-cols-3 sm:grid-cols-4 gap-x-1.5 gap-y-4" aria-label={undecided ? 'À décider' : 'Téléchargés'}>
      {shown.map(item => <li key={item.key} data-recent-import={undecided ? undefined : item.key} data-undecided-title={undecided ? item.key : undefined} className="min-w-0" title={undecided ? undecidedReason(item as ArrPendingTitle) : recentImportLabel(item)}>
        <GridMediaCard media={importMedia(item)} posterSrc={item.posterUrl}
          onShowClick={(id, mediaType) => { if (item.tmdbId && onShowClick) onShowClick(id, mediaType); }}
          action={{ label: 'Retirer', ariaLabel: `Retirer ${item.title} de ${undecided ? 'À décider' : 'Téléchargés'} et de ${item.kind === 'movie' ? 'Radarr' : 'Sonarr'}`, busy: busy === item.key, disabled: busy !== null && busy !== item.key,
            icon: busy === item.key ? <Loader2 size={10} className="animate-spin" aria-hidden="true" /> : <X size={10} aria-hidden="true" />, onSelect: () => void remove(item) }} />
        {undecided && <p className="downloads-undecided__reason">{undecidedReason(item as ArrPendingTitle)}</p>}
      </li>)}
    </ul>}
    <LoadMore previews={visible.slice(limit, limit + 3).map(item => ({ key: item.key, initial: item.title.charAt(0), imagePath: tmdbPosterPath(item.posterUrl) || null }))}
      remainingCount={visible.length - limit} step={PAGE} onLoad={() => setLimit(value => value + PAGE)} />
  </section>;
}
