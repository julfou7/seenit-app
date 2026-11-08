import React, { useEffect, useState } from 'react';
import { Check, Film, Tv } from 'lucide-react';
import { useDownloadConfigStore } from '../store/downloadConfigStore';
import { auth } from '../lib/firebase';
import { readUserScopedJson, writeUserScopedJson } from '../lib/userIsolation';
import { useArrSnapshot, useArrSyncStore } from '../store/arrSyncStore';
import { recentImportLabel, recentImportsScope, type RecentImport } from '../features/downloads/recentImports';

// Les affiches *Arr pointent souvent vers l'original TMDB : une vignette suffit pour une mini-carte.
const thumbnail = (url?: string) => url?.replace(/(image\.tmdb\.org\/t\/p\/)original\//, '$1w342/');

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
export const visibleRecentImports = (items: readonly RecentImport[], clearedAt: number) => items.filter(item => item.date > clearedAt);

/**
 * Rangée « Téléchargés · 7 derniers jours ». Depuis la v1.4.281 (« le bas c'est pas très joli… reprendre le
 * style des mini-cartes ») : mini-cartes d'Explorer — affiche dans un cadre arrondi, pastilles dans les coins
 * (« 8 ép. » en haut à gauche, coche en haut à droite, jamais sur le titre de l'affiche), titre or sur deux
 * lignes et repère court en dessous, sans coupure. « Vider » masque la liste actuelle sur cet appareil ; un
 * nouvel import réapparaît. Rien n'est supprimé dans Sonarr, Radarr ou le client.
 */
export function RecentImportsRail({ items, failures, onShowClick }: { items: RecentImport[]; failures: string[]; onShowClick?: (id: string | number, mediaType?: 'tv' | 'movie') => void }) {
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const uid = auth.currentUser?.uid;
  const [clearedAt, setClearedAt] = useState(() => Number(readUserScopedJson(uid, CLEARED_FIELD, 0)) || 0);
  const visible = visibleRecentImports(items, clearedAt);
  if (!visible.length && !failures.length) return null;
  const now = Date.now();
  const clear = () => {
    const at = Math.max(...items.map(item => item.date), Date.now());
    writeUserScopedJson(uid, CLEARED_FIELD, at);
    setClearedAt(at);
  };
  return <section className="downloads-section downloads-recent" data-recent-imports>
    <div className="downloads-recent__head">
      <h2>Téléchargés</h2>
      <span>7 derniers jours</span>
      {visible.length > 0 && <button type="button" className="downloads-recent__clear" onClick={clear}>Vider</button>}
    </div>
    {failures.length > 0 && <p className="download-card__meta" role="status">{failures.join(' et ')} injoignable pour l’instant : la liste peut être incomplète.</p>}
    {visible.length > 0 && <ul className="downloads-recent__rail">
      {visible.map(item => {
        const label = recentImportLabel(item, now);
        const count = item.kind === 'series' ? item.episodes.length : 1;
        const src = thumbnail(item.posterUrl);
        return <li key={item.key} data-recent-import={item.key}>
          <button type="button" disabled={!item.tmdbId || !onShowClick} aria-label={`Ouvrir ${item.title} : ${label}`}
            onClick={() => item.tmdbId && onShowClick?.(item.tmdbId, item.kind === 'movie' ? 'movie' : 'tv')}>
            <span className="downloads-recent__poster">
              {src && !failed.has(item.key) ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(previous => new Set(previous).add(item.key))} /> : item.kind === 'movie' ? <Film size={24} /> : <Tv size={24} />}
              {count > 1 && <span className="downloads-recent__count">{count} ép.</span>}
              <span className="downloads-recent__done" aria-hidden="true"><Check size={13} strokeWidth={3} /></span>
            </span>
            <span className="downloads-recent__info">
              <strong>{item.title}</strong>
              <span>{label}</span>
            </span>
          </button>
        </li>;
      })}
    </ul>}
  </section>;
}
