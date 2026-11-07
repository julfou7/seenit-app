import React, { useEffect, useRef, useState } from 'react';
import { Check, Film, Tv } from 'lucide-react';
import { useDownloadConfigStore } from '../store/downloadConfigStore';
import { fetchRecentImports, recentImportLabel, recentImportsScope, type RecentImport } from '../features/downloads/recentImports';

interface RecentImportsState { scope: string | null; items: RecentImport[]; failures: string[] }
const EMPTY = { items: [] as RecentImport[], failures: [] as string[], loaded: false };
// Les affiches *Arr pointent souvent vers l'original TMDB : une vignette suffit pour une carte de 104 px.
const thumbnail = (url?: string) => url?.replace(/(image\.tmdb\.org\/t\/p\/)original\//, '$1w342/');

/**
 * Imports Sonarr/Radarr des 7 derniers jours, liés à la portée serveur : une réponse d'une autre
 * configuration (ou d'un chargement plus ancien) n'est jamais affichée.
 */
export function useRecentImports(refreshKey = 0): { items: RecentImport[]; failures: string[]; loaded: boolean } {
  const scope = recentImportsScope(useDownloadConfigStore());
  const [state, setState] = useState<RecentImportsState>({ scope: null, items: [], failures: [] });
  const request = useRef(0);
  useEffect(() => {
    const id = ++request.current;
    const config = useDownloadConfigStore.getState();
    const at = recentImportsScope(config);
    void fetchRecentImports(config).catch(() => ({ items: [], failures: ['Sonarr/Radarr'] })).then(result => {
      if (id !== request.current || recentImportsScope(useDownloadConfigStore.getState()) !== at) return;
      setState({ scope: at, items: result.items, failures: result.failures });
    });
  }, [refreshKey, scope]);
  return state.scope === scope ? { items: state.items, failures: state.failures, loaded: true } : EMPTY;
}

/**
 * Rangée « Téléchargés · 7 derniers jours » (maquette DlOngletSuivi) : affiches de 104 px, pastille
 * « 2 ép. » quand une série a plusieurs épisodes importés, coche « prêt », titre or et repère court.
 */
export function RecentImportsRail({ items, failures, onShowClick }: { items: RecentImport[]; failures: string[]; onShowClick?: (id: string | number, mediaType?: 'tv' | 'movie') => void }) {
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  if (!items.length && !failures.length) return null;
  const now = Date.now();
  return <section className="downloads-section downloads-recent" data-recent-imports>
    <div className="downloads-recent__head"><h2>Téléchargés</h2><span>7 derniers jours</span></div>
    {failures.length > 0 && <p className="download-card__meta" role="status">{failures.join(' et ')} injoignable pour l’instant : la liste peut être incomplète.</p>}
    {items.length > 0 && <ul className="downloads-recent__rail">
      {items.map(item => {
        const label = recentImportLabel(item, now);
        const count = item.kind === 'series' ? item.episodes.length : 1;
        const src = thumbnail(item.posterUrl);
        return <li key={item.key} data-recent-import={item.key}>
          <button type="button" disabled={!item.tmdbId || !onShowClick} aria-label={`Ouvrir ${item.title} : ${label}`}
            onClick={() => item.tmdbId && onShowClick?.(item.tmdbId, item.kind === 'movie' ? 'movie' : 'tv')}>
            <span className="downloads-recent__poster">
              {src && !failed.has(item.key) ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(previous => new Set(previous).add(item.key))} /> : item.kind === 'movie' ? <Film size={24} /> : <Tv size={24} />}
              {count > 1 && <span className="downloads-recent__count">{count} ép.</span>}
              <span className="downloads-recent__done" aria-hidden="true"><Check size={17} strokeWidth={2.8} /></span>
            </span>
            <strong>{item.title}</strong>
            <span>{label}</span>
          </button>
        </li>;
      })}
    </ul>}
  </section>;
}
