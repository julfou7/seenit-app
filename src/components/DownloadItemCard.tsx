import React, { lazy, Suspense, useRef, useState } from 'react';
import { Film, Search, Trash2, Tv, MoreHorizontal, CheckCircle2 } from 'lucide-react';
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
  const attention = group === 'attention', waiting = group === 'waiting', terminal = group === 'completed' || group === 'cancelled';
  // Une carte en échec ou pas encore disponible garde ses deux actions visibles ; depuis le 08/11, l'attente a
  // sa propre section « En attente », en bleu, et n'est plus présentée comme une erreur.
  const toFix = attention || waiting;
  const progress = truncateDownloadProgressPercent(Math.min(100, Math.max(0, Number(item.progress) || 0)));
  const problem = downloadProblem(item.errorMessage || item.statusText);
  const id = item.tmdbId || library?.tmdbId;
  const audio = getReleaseAudio(item.releaseTitle).label;
  const scope = isTv ? subTitle : ['Film', item.quality].filter(Boolean).join(' · ');
  const meta = [isTv ? item.quality : '', audio, item.size > 0 ? formatBytes(item.size) : ''].filter(Boolean).join(' · ');
  const label = attention ? problem.title : waiting ? 'Pas encore disponible' : group === 'cancelled' ? 'Annulé' : group === 'completed' ? 'Terminé' : item.importState === 'pending' && progress >= 100 ? 'Transfert terminé · import à confirmer' : item.status === 'searching' ? 'Recherche en cours…' : item.status === 'submitting' ? 'Envoi au client' : item.status === 'paused' ? 'En pause' : item.status === 'queued' ? 'En file d’attente' : null;
  const showTrack = group === 'active' && !(item.importState === 'pending' && progress >= 100) && (label === null || progress > 0);
  return <article className={`download-card${attention ? ' download-card--attention' : ''}${waiting ? ' download-card--waiting' : ''}${terminal ? ' download-card--terminal' : ''}`} data-download-id={item.id}>
    <div className="download-card__head">
      <button type="button" className="download-card__poster" disabled={!id || !onShowClick} aria-label={`Ouvrir ${cleanTitle}`} onClick={() => id && onShowClick?.(id, item.mediaType)}>
        {src && !posterFailed ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setPosterFailed(true)} /> : isTv ? <Tv size={22} /> : <Film size={22} />}
      </button>
      <div className="download-card__body">
        <button type="button" className="download-card__title" disabled={!id || !onShowClick} onClick={() => id && onShowClick?.(id, item.mediaType)}>{cleanTitle}</button>
        {scope && <p className="download-card__scope">{scope}</p>}
        {meta && <p className="download-card__meta">{meta}</p>}
        {label && <p className={`download-card__status${attention ? ' is-error' : ''}`}>{group === 'completed' && <CheckCircle2 size={14} aria-hidden="true" />}{label}</p>}
        {toFix && <p className="download-card__hint">{attention ? problem.hint : availabilityHint(item.availability)}</p>}
      </div>
      <button type="button" className="download-card__more" aria-label={`Actions pour ${cleanTitle}`} aria-expanded={details} onClick={() => setDetails(!details)}><MoreHorizontal size={20} /></button>
    </div>
    {/* Maquette : la barre or court en bas du billet, avec le pourcentage et le temps restant. */}
    {showTrack && <div className="download-card__track">
      <div role="progressbar" aria-label="Progression du transfert" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} className="download-card__progress"><span style={{ width: `${progress}%` }} /></div>
      <strong>{progress} %</strong>
      {item.timeleft && item.timeleft !== '--' && <span>≈ {item.timeleft}</span>}
    </div>}
    {/* Une carte à régler montre ses deux actions sans passer par « … ». */}
    {toFix && <div className="download-card__quick">
      {item.tmdbId && <button type="button" onClick={() => setChoosingRelease(true)}>Choisir une version</button>}
      <button type="button" onClick={onRemove} aria-label={`Retirer ${cleanTitle}`}>Retirer</button>
    </div>}
    {details && <div className="download-card__actions">
      {item.tmdbId && terminal && <button type="button" onClick={() => setChoosingRelease(true)}><Search size={15} />Autre version</button>}
      {item.tmdbId && toFix && <button type="button" onClick={() => setChoosingQuality(true)}>Changer la qualité</button>}
      {!toFix && <button type="button" onClick={onRemove} aria-label={`${terminal ? 'Retirer' : 'Annuler'} ${cleanTitle}`}><Trash2 size={15} />{terminal ? 'Retirer' : 'Annuler'}</button>}
      {item.speedFormatted && group === 'active' && <p className="download-card__meta">{item.speedFormatted}</p>}
    </div>}
    <Suspense fallback={<p role="status" className="download-card__meta">Ouverture du sélecteur…</p>}>
      {choosingRelease && <AlternativeReleaseModal item={item} onClose={() => setChoosingRelease(false)} />}
      {choosingQuality && item.tmdbId && <DownloadModal isOpen onClose={() => setChoosingQuality(false)} title={item.movieTitle || item.seriesTitle || cleanTitle} mediaType={item.mediaType} tmdbId={item.tmdbId} tvdbId={item.tvdbId} imdbId={item.imdbId} posterPath={poster.current} initialSeason={item.seasonNumber} initialEpisode={item.episodeNumber} />}
    </Suspense>
  </article>;
}
