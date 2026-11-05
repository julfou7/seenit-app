import React, { lazy, Suspense, useRef, useState } from 'react';
import { Film, Search, Trash2, Tv, ChevronDown } from 'lucide-react';
import { useShowsStore } from '../store/showsStore';
import { formatBytes, formatCleanMediaInfo, type LiveDownloadItem } from '../services/sonarrRadarr';
import { findMatchingShowForDownload } from '../features/downloads/downloadIdentity';
import { preferSeenItImagePath, selectStableDownloadPosterPath } from '../features/downloads/downloadPosterStability';
import { truncateDownloadProgressPercent } from '../features/downloads/downloadPresentation';
import { downloadGroup, downloadProblem } from '../features/downloads/downloadGroups';
import { availabilityHint } from '../features/downloads/downloadAvailability';
import { getReleaseAudio } from '../features/downloads/releaseAudio';
const AlternativeReleaseModal = lazy(() => import('./AlternativeReleaseModal').then(module => ({ default: module.AlternativeReleaseModal })));
const DownloadModal = lazy(() => import('./DownloadModal').then(module => ({ default: module.DownloadModal })));

export function DownloadItemCard({ item, onShowClick, onRemove }: { item: LiveDownloadItem; onShowClick?: (id: string | number, mediaType?: 'tv' | 'movie') => void; onRemove: () => void }) {
  const [choosingRelease, setChoosingRelease] = useState(false);
  const [choosingQuality, setChoosingQuality] = useState(false);
  const [details, setDetails] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const library = useShowsStore(state => findMatchingShowForDownload(item, state.shows));
  const poster = useRef<string | undefined>(undefined);
  poster.current = selectStableDownloadPosterPath(poster.current, preferSeenItImagePath(item.posterPath, library?.posterPath || undefined));
  const src = poster.current ? poster.current.startsWith('http') ? poster.current : `https://image.tmdb.org/t/p/w185${poster.current}` : null;
  const { cleanTitle, subTitle, isTv } = formatCleanMediaInfo(item);
  const group = downloadGroup(item);
  const attention = group === 'attention', terminal = group === 'completed' || group === 'cancelled';
  const progress = truncateDownloadProgressPercent(Math.min(100, Math.max(0, Number(item.progress) || 0)));
  const problem = downloadProblem(item.errorMessage || item.statusText);
  const id = item.tmdbId || library?.tmdbId;
  const audio = getReleaseAudio(item.releaseTitle).label;
  const meta = [subTitle || (isTv ? 'Série' : 'Film'), item.quality, audio, item.size > 0 ? formatBytes(item.size) : ''].filter(Boolean).join(' · ');
  const label = attention ? problem.title : group === 'waiting' ? 'En attente de disponibilité' : group === 'cancelled' ? 'Annulé' : group === 'completed' ? 'Terminé' : item.importState === 'pending' && progress >= 100 ? 'Transfert terminé · import à confirmer' : item.status === 'searching' ? 'Recherche en cours' : item.status === 'submitting' ? 'Envoi au client' : item.status === 'paused' ? 'En pause' : `${progress} %`;
  return <article className={`download-card${attention ? ' download-card--attention' : ''}${terminal ? ' download-card--terminal' : ''}`} data-download-id={item.id}>
    <div className="download-card__head">
      <button type="button" className="download-card__poster" disabled={!id || !onShowClick} aria-label={`Ouvrir ${cleanTitle}`} onClick={() => id && onShowClick?.(id, item.mediaType)}>
        {src && !posterFailed ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setPosterFailed(true)} /> : isTv ? <Tv size={22} /> : <Film size={22} />}
      </button>
      <div className="download-card__body">
        <button type="button" className="download-card__title" disabled={!id || !onShowClick} onClick={() => id && onShowClick?.(id, item.mediaType)}>{cleanTitle}</button>
        <p className="download-card__meta">{meta}</p>
        <p className={`download-card__status${attention ? ' is-error' : ''}`}>{label}</p>
        {group === 'active' && <><div role="progressbar" aria-label="Progression du transfert" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} className="download-card__progress"><span style={{ width: `${progress}%` }} /></div><p className="download-card__meta">{[item.speedFormatted, item.timeleft && item.timeleft !== '--' ? item.timeleft : '', item.statusText].filter(Boolean).join(' · ')}</p></>}
      </div>
    </div>
    {attention && <p className="download-card__hint">{problem.hint}</p>}
    {group === 'waiting' && <p className="download-card__hint">{availabilityHint(item.availability)}</p>}
    {terminal && details && <p className="download-card__meta">{item.statusText}</p>}
    <div className="download-card__actions">
      {item.tmdbId && (attention || (terminal && details) || group === 'waiting') && <button type="button" onClick={() => setChoosingRelease(true)}><Search size={15} />Autre version</button>}
      {item.tmdbId && (attention || group === 'waiting') && <button type="button" onClick={() => setChoosingQuality(true)}>Changer la qualité</button>}
      {(!terminal || details) && <button type="button" onClick={onRemove} aria-label={`${terminal || attention ? 'Retirer' : 'Annuler'} ${cleanTitle}`}><Trash2 size={15} />{terminal || attention ? 'Retirer' : 'Annuler'}</button>}
      <button type="button" aria-expanded={details} onClick={() => setDetails(!details)}><ChevronDown size={15} />Détails</button>
    </div>
    {details && <div className="download-card__details"><p>{item.releaseTitle || 'Release non résolue'}</p><p>{item.downloadClient || 'Client non précisé'}</p>{item.errorMessage && <p>{item.errorMessage}</p>}</div>}
    <Suspense fallback={<p role="status" className="download-card__meta">Ouverture du sélecteur…</p>}>
      {choosingRelease && <AlternativeReleaseModal item={item} onClose={() => setChoosingRelease(false)} />}
      {choosingQuality && item.tmdbId && <DownloadModal isOpen onClose={() => setChoosingQuality(false)} title={item.movieTitle || item.seriesTitle || cleanTitle} mediaType={item.mediaType} tmdbId={item.tmdbId} tvdbId={item.tvdbId} imdbId={item.imdbId} posterPath={poster.current} initialSeason={item.seasonNumber} initialEpisode={item.episodeNumber} />}
    </Suspense>
  </article>;
}
