import React, { lazy, Suspense, useRef, useState } from 'react';
import { Tv, X } from 'lucide-react';
import { useShowsStore } from '../store/showsStore';
import { formatCleanMediaInfo, type LiveDownloadItem } from '../services/sonarrRadarr';
import { findMatchingShowForDownload } from '../features/downloads/downloadIdentity';
import { preferSeenItImagePath, selectStableDownloadPosterPath } from '../features/downloads/downloadPosterStability';
import { truncateDownloadProgressPercent } from '../features/downloads/downloadPresentation';
import { downloadGroup } from '../features/downloads/downloadGroups';
import { releaseVariantLabel } from '../features/downloads/releaseQuality';
import { addEpisodeToSeason, useNextEpisodeToAdd } from '../features/downloads/addNextEpisode';
import { useToastStore } from '../store/toastStore';
const PreciseVersionPage = lazy(() => import('../screens/mediaDetail/PreciseVersionPage'));

type RowKind = 'done' | 'active' | 'queued' | 'waiting' | 'attention';
const rowKind = (item: LiveDownloadItem): RowKind => {
  const group = downloadGroup(item);
  if (group === 'completed') return 'done';
  if (group === 'attention') return 'attention';
  if (group === 'waiting') return 'waiting';
  return item.status === 'downloading' && Number(item.progress) > 0 ? 'active' : 'queued';
};
const percent = (item: LiveDownloadItem) => truncateDownloadProgressPercent(Math.min(100, Math.max(0, Number(item.progress) || 0)));

function rowState(item: LiveDownloadItem, kind: RowKind): string {
  if (kind === 'done') return item.importState === 'pending' ? 'Transfert terminé · import à confirmer' : 'Téléchargé · prêt à regarder';
  if (kind === 'attention') return item.errorMessage || item.statusText || 'Une intervention est nécessaire';
  if (kind === 'waiting') return 'Pas encore disponible';
  if (kind === 'active') return [`${percent(item)} %`, item.timeleft && item.timeleft !== '--' ? `≈ ${item.timeleft}` : ''].filter(Boolean).join(' · ');
  return item.status === 'searching' ? 'Recherche en cours' : item.status === 'paused' ? 'En pause' : 'En attente';
}

const SEGMENT: Record<RowKind, React.CSSProperties> = {
  done: { background: '#F4F4F5' },
  active: {},
  queued: { background: '#27272A', boxShadow: 'inset 0 0 0 1.5px #F4F4F5' },
  waiting: { background: '#27272A', boxShadow: 'inset 0 0 0 1.5px #71717A' },
  attention: { background: 'rgba(251,113,133,0.6)' }
};
const LEGEND: Array<{ kind: RowKind; one: string; many: string }> = [
  { kind: 'done', one: 'prêt', many: 'prêts' },
  { kind: 'active', one: 'en cours', many: 'en cours' },
  { kind: 'queued', one: 'en attente', many: 'en attente' },
  { kind: 'waiting', one: 'pas encore disponible', many: 'pas encore disponibles' },
  { kind: 'attention', one: 'à régler', many: 'à régler' }
];

/**
 * #879 — Carte d'une saison dans l'onglet Télécharger (maquette DlOngletSuivi) : une seule carte pour
 * tous les épisodes d'une même saison, une barre (un segment par épisode suivi, comme le bandeau de la
 * fiche), puis une ligne par épisode avec son état et ✕ pour l'annuler. Le regroupement repose sur
 * l'identité TMDB/TVDB exacte, jamais sur le titre.
 */
export function SeasonDownloadCard({ seasonNumber, items, onShowClick, onRemove }: { seasonNumber: number; items: LiveDownloadItem[]; onShowClick?: (id: string | number, mediaType?: 'tv' | 'movie') => void; onRemove: (item: LiveDownloadItem) => void }) {
  const first = items[0];
  const library = useShowsStore(state => findMatchingShowForDownload(first, state.shows));
  const poster = useRef<string | undefined>(undefined);
  const [posterFailed, setPosterFailed] = useState(false);
  poster.current = selectStableDownloadPosterPath(poster.current, preferSeenItImagePath(first.posterPath, library?.posterPath || undefined));
  const src = poster.current ? poster.current.startsWith('http') ? poster.current : `https://image.tmdb.org/t/p/w185${poster.current}` : null;
  const title = first.seriesTitle || library?.title || formatCleanMediaInfo(first).cleanTitle;
  const id = first.tmdbId || library?.tmdbId;
  const qualities = [...new Set(items.map(item => item.quality).filter(Boolean))];
  const rows = items.map(item => ({ item, kind: rowKind(item) }));
  const counts = rows.reduce<Partial<Record<RowKind, number>>>((acc, row) => ({ ...acc, [row.kind]: (acc[row.kind] || 0) + 1 }), {});
  const legend = LEGEND.filter(entry => counts[entry.kind]).map(entry => `${counts[entry.kind]} ${counts[entry.kind]! > 1 ? entry.many : entry.one}`);
  const open = () => id && onShowClick?.(id, 'tv');
  // « Ajouter E6 » : le prochain épisode sorti, ni vu, ni présent, ni déjà dans la carte (TMDB exact requis).
  const target = Number(first.tmdbId) > 0 ? { tmdbId: Number(first.tmdbId), tvdbId: Number(first.tvdbId) || undefined, season: seasonNumber, title, posterPath: poster.current, tracked: items.map(item => Number(item.episodeNumber)) } : null;
  const next = useNextEpisodeToAdd(target);
  const [picking, setPicking] = useState(false);
  const [precise, setPrecise] = useState<number | null>(null);
  const sameQuality = qualities.length === 1 && /2160|4k/i.test(String(qualities[0])) ? '4k' : qualities.length === 1 && /1080/.test(String(qualities[0])) ? '1080p' : null;
  const add = (quality: '1080p' | '4k') => {
    if (!target || !next) return;
    setPicking(false);
    const episode = next.episode;
    void addEpisodeToSeason(target, episode, quality, (action, kind = 'download') => useToastStore.getState().showToast({ title, subtitle: `S${seasonNumber} | E${episode}`, action, posterPath: poster.current }, kind));
  };

  return <article className="download-card download-season" data-download-season={`${id || first.tvdbId}:${seasonNumber}`}>
    <div className="download-card__head">
      <button type="button" className="download-card__poster download-season__poster" disabled={!id || !onShowClick} aria-label={`Ouvrir ${title}`} onClick={open}>
        {src && !posterFailed ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setPosterFailed(true)} /> : <Tv size={22} />}
      </button>
      <div className="download-card__body">
        <button type="button" className="download-card__title" disabled={!id || !onShowClick} onClick={open}>{title}</button>
        <p className="download-card__scope">{[`Saison ${seasonNumber}`, `${items.length} épisodes`, qualities.length === 1 ? qualities[0] : ''].filter(Boolean).join(' · ')}</p>
      </div>
    </div>
    <div className="download-season__bar" role="img" aria-label={`Saison ${seasonNumber} : ${legend.join(', ')}`}>
      {rows.map(({ item, kind }) => <span key={item.id} style={kind === 'active' ? { background: `linear-gradient(90deg,#F4F4F5 ${percent(item)}%,#3F3F46 ${percent(item)}%)` } : SEGMENT[kind]} />)}
    </div>
    <p className="download-season__legend" aria-hidden="true">{legend.join(' · ')}</p>
    <ul className="download-season__rows">
      {rows.map(({ item, kind }) => {
        const code = `E${item.episodeNumber}`;
        return <li key={item.id} className="download-season__row" data-download-id={item.id} data-row-kind={kind}>
          <span className="download-season__code">{code}</span>
          <span className="download-season__text">
            <span className="download-season__title">{item.episodeTitle || `Épisode ${item.episodeNumber}`}</span>
            <span className={`download-season__state is-${kind}`}>{[rowState(item, kind), releaseVariantLabel(item.releaseTitle)].filter(Boolean).join(' · ')}</span>
            {kind === 'active' && <span role="progressbar" aria-label={`Progression de ${code}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent(item)} className="download-season__progress"><i style={{ width: `${percent(item)}%` }} /></span>}
          </span>
          <button type="button" className="download-season__remove" onClick={() => onRemove(item)}
            aria-label={kind === 'done' || kind === 'attention' ? `Retirer ${code} de la liste` : `Annuler le téléchargement de ${code}`}><X size={18} /></button>
        </li>;
      })}
    </ul>
    {next && !picking && <button type="button" className="download-season__add" onClick={() => setPicking(true)}>Ajouter E{next.episode}</button>}
    {next && picking && <div className="download-season__pick" role="group" aria-label={`Ajouter E${next.episode} en quelle qualité ?`}>
      <p>Ajouter E{next.episode} en quelle qualité ?</p>
      <div>
        <button type="button" className="is-gold" onClick={() => add('1080p')}>1080p{sameQuality === '1080p' && <span> · comme les autres</span>}</button>
        <button type="button" onClick={() => add('4k')}>4K{sameQuality === '4k' && <span> · comme les autres</span>}</button>
        <button type="button" onClick={() => setPicking(false)}>Plus tard</button>
        <button type="button" onClick={() => { setPicking(false); setPrecise(next.episode); }}>Autres…</button>
      </div>
    </div>}
    {precise !== null && target && <Suspense fallback={<span role="status">Ouverture de la version précise…</span>}><PreciseVersionPage target={{ title, tmdbId: target.tmdbId, tvdbId: target.tvdbId, posterPath: poster.current, season: seasonNumber, episode: precise }} onClose={() => setPrecise(null)} /></Suspense>}
  </article>;
}
