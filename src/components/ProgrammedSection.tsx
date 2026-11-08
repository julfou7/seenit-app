import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Clock3, Film, Tv, X } from 'lucide-react';
import { useDownloadConfigStore } from '../store/downloadConfigStore';
import { useToastStore } from '../store/toastStore';
import { fetchProgrammedCalendar, programmedDateLabel, programmedScope, unprogramItem, type ProgrammedItem } from '../features/downloads/programmedCalendar';
import type { LiveDownloadItem } from '../services/sonarrRadarrLive';

type EpisodeItem = Extract<ProgrammedItem, { kind: 'episode' }>;
/** Pastille de date (refonte du 08/11) : « Sortie mar. 10 nov. », « Sortie demain ». */
const releasePill = (date?: string) => {
  if (!date) return 'Date à venir';
  const label = programmedDateLabel(date);
  return label === 'Demain' || label === "Aujourd'hui" ? `Sortie ${label.toLowerCase()}` : `Sortie ${label}`;
};
const When = ({ children }: { children: React.ReactNode }) => <span className="programmed__when"><Clock3 size={13} aria-hidden="true" />{children}</span>;
const code = (item: EpisodeItem) => `S${String(item.season).padStart(2, '0')}E${String(item.episode).padStart(2, '0')}`;

const pad = (value: number) => String(value).padStart(2, '0');
/**
 * Retour terrain du 08/11 (Harry Potter) : Sonarr connaît les épisodes et leurs dates avant TMDB, mais pas
 * encore leurs titres (« TBA »). L'épisode reste listé avec sa date ; son titre s'affiche « Titre à venir ».
 */
export const isUntitledEpisode = (item: EpisodeItem) => !item.title?.trim() || /^(?:tba|tbd|to be announced)$/i.test(item.title.trim());
const requestScope = (item: LiveDownloadItem) => item.mediaType === 'movie' ? 'Film'
  : item.seasonNumber != null ? item.episodeNumber != null ? `S${pad(item.seasonNumber)}E${pad(item.episodeNumber)}` : `Saison ${item.seasonNumber}` : 'Série';
const posterUrl = (path?: string | null) => !path ? null : path.startsWith('http') ? path : `https://image.tmdb.org/t/p/w185${path}`;
/** Même périmètre exact (TMDB, saison et épisode), jamais le titre. */
const coveredBy = (item: ProgrammedItem, request: LiveDownloadItem) => Number(request.tmdbId) > 0 && Number(item.tmdbId) === Number(request.tmdbId)
  && (item.kind === 'movie' ? request.mediaType === 'movie'
    : request.mediaType === 'tv' && Number(request.seasonNumber) === item.season && Number(request.episodeNumber) === item.episode);

/**
 * #879 — Section « Programmés » de l'onglet Télécharger : épisodes et films que Sonarr et Radarr
 * récupéreront à leur sortie, regroupés par série (identifiant Sonarr exact). « Annuler » retire la
 * surveillance de l'élément, sans rien supprimer ; une source injoignable est dite, pas masquée.
 * Retour terrain du 08/11 (« Le Chat Chapeauté ») : une demande lancée sans version disponible, dont la
 * surveillance est confirmée (`watching`), y figure aussi avec la raison (« Pas encore de version ») ;
 * l'entrée du calendrier du même périmètre exact n'est pas répétée, sa date est reprise sur la carte.
 */
export function ProgrammedSection({ refreshKey = 0, onShowClick, watching = [], onRemoveWatching }: { refreshKey?: number; onShowClick?: (id: string | number, mediaType?: 'tv' | 'movie') => void; watching?: readonly LiveDownloadItem[]; onRemoveWatching?: (item: LiveDownloadItem) => void }) {
  const [items, setItems] = useState<ProgrammedItem[]>([]);
  const [failures, setFailures] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  // Les identifiants viennent d'un serveur précis : la liste est liée à sa portée et rechargée quand elle change.
  const scope = programmedScope(useDownloadConfigStore());
  const loadedScope = useRef<string | null>(null);
  const request = useRef(0);
  const load = useCallback(async () => {
    const id = ++request.current;
    const config = useDownloadConfigStore.getState();
    const at = programmedScope(config);
    loadedScope.current = null;
    setItems([]);
    setFailures([]);
    const calendar = await fetchProgrammedCalendar(config);
    // Une réponse d'une ancienne portée (ou d'un ancien chargement) est ignorée.
    if (id !== request.current || programmedScope(useDownloadConfigStore.getState()) !== at) return;
    loadedScope.current = at;
    setItems(calendar.items);
    setFailures(calendar.failures);
  }, []);
  useEffect(() => { void load(); }, [load, refreshKey, scope]);

  const cancel = async (item: ProgrammedItem) => {
    const key = `${item.kind}:${item.id}`;
    if (busy) return;
    const label = item.kind === 'episode' ? `${item.seriesTitle} · ${code(item)}` : item.title;
    const config = useDownloadConfigStore.getState();
    // Jamais un ancien identifiant envoyé à un autre serveur : la liste est rechargée à la place.
    if (programmedScope(config) !== loadedScope.current) {
      useToastStore.getState().showToast({ title: label, action: 'La configuration a changé : liste rechargée, rien n’a été modifié.' }, 'info');
      void load();
      return;
    }
    setBusy(key);
    try {
      await unprogramItem(config, item);
      setItems(previous => previous.filter(entry => !(entry.kind === item.kind && entry.id === item.id)));
      useToastStore.getState().showToast({ title: item.kind === 'episode' ? item.seriesTitle : item.title, subtitle: item.kind === 'episode' ? `S${item.season} | E${item.episode}` : undefined, action: 'N’est plus programmé.' }, 'info');
    } catch (error: unknown) {
      useToastStore.getState().showToast({ title: label, action: error instanceof Error ? error.message : 'Impossible de déprogrammer.' }, 'error');
    } finally {
      setBusy(null);
    }
  };

  if (!items.length && !failures.length && !watching.length) return null;
  const series = new Map<number, EpisodeItem[]>();
  const movies: Extract<ProgrammedItem, { kind: 'movie' }>[] = [];
  const dates = new Map<string, string | undefined>();
  for (const item of items) {
    const request = watching.find(entry => coveredBy(item, entry));
    if (request) { dates.set(request.id, item.date); continue; }
    if (item.kind === 'movie') movies.push(item);
    else series.set(item.seriesId, [...(series.get(item.seriesId) || []), item]);
  }
  const cancelButton = (item: ProgrammedItem, label: string) => <button type="button" disabled={busy !== null} onClick={() => void cancel(item)} aria-label={`Annuler la programmation de ${label}`} className="programmed__cancel">Annuler</button>;
  const rowCancel = (item: ProgrammedItem, label: string) => <button type="button" disabled={busy !== null} onClick={() => void cancel(item)} aria-label={`Annuler la programmation de ${label}`} className="programmed__cancel programmed__cancel--icon"><X size={18} aria-hidden="true" /></button>;

  return <section className="downloads-section" data-programmed>
    <h2>Programmés</h2>
    {failures.length > 0 && <p className="download-card__meta" role="status">{failures.join(' et ')} injoignable pour l’instant : la liste peut être incomplète.</p>}
    {watching.map(request => {
      const isTv = request.mediaType === 'tv';
      const name = request.movieTitle || request.seriesTitle || request.title;
      const poster = posterUrl(request.posterPath);
      const open = () => request.tmdbId && onShowClick?.(request.tmdbId, request.mediaType);
      const date = dates.get(request.id);
      return <article key={`w${request.id}`} className="download-card programmed" data-programmed-request={request.id}>
        <div className="download-card__head">
          <button type="button" className="download-card__poster download-season__poster" disabled={!request.tmdbId || !onShowClick} aria-label={`Ouvrir ${name}`} onClick={open}>{poster ? <img src={poster} alt="" loading="lazy" decoding="async" /> : isTv ? <Tv size={22} /> : <Film size={22} />}</button>
          <div className="download-card__body">
            <button type="button" className="download-card__title" disabled={!request.tmdbId || !onShowClick} onClick={open}>{name}</button>
            <p className="programmed__meta">{requestScope(request)} · {isTv ? 'Sonarr' : 'Radarr'}</p>
            <div className="programmed__foot"><When>{date ? releasePill(date) : 'Pas encore de version'}</When>
              {onRemoveWatching && <button type="button" onClick={() => onRemoveWatching(request)} aria-label={`Annuler la programmation de ${name}`} className="programmed__cancel">Annuler</button>}</div>
          </div>
        </div>
      </article>;
    })}
    {[...series.values()].map(group => {
      const first = group[0];
      const open = () => first.tmdbId && onShowClick?.(first.tmdbId, 'tv');
      return <article key={`s${first.seriesId}`} className="download-card programmed" data-programmed-series={first.seriesId}>
        <div className="download-card__head">
          <button type="button" className="download-card__poster download-season__poster" disabled={!first.tmdbId || !onShowClick} aria-label={`Ouvrir ${first.seriesTitle}`} onClick={open}>{first.posterUrl ? <img src={first.posterUrl} alt="" loading="lazy" decoding="async" /> : <Tv size={22} />}</button>
          <div className="download-card__body">
            <button type="button" className="download-card__title" disabled={!first.tmdbId || !onShowClick} onClick={open}>{first.seriesTitle}</button>
            <p className="programmed__meta">Série · Sonarr · {group.length} épisode{group.length > 1 ? 's' : ''}</p>
            <div className="programmed__foot"><When>{releasePill(group.map(item => item.date).filter((value): value is string => Boolean(value)).sort()[0])}</When></div>
          </div>
        </div>
        <ul className="download-season__rows">
          {group.map(item => <li key={item.id} className="download-season__row" data-programmed-episode={item.id}>
            <span className="download-season__code">{code(item)}</span>
            <span className="programmed__row-title" data-untitled={isUntitledEpisode(item) || undefined}>{isUntitledEpisode(item) ? 'Titre à venir' : item.title}</span>
            <span className="programmed__row-date">{programmedDateLabel(item.date)}</span>
            {rowCancel(item, `${first.seriesTitle} ${code(item)}`)}
          </li>)}
        </ul>
      </article>;
    })}
    {movies.map(movie => <article key={`m${movie.id}`} className="download-card programmed" data-programmed-movie={movie.id}>
      <div className="download-card__head">
        <button type="button" className="download-card__poster download-season__poster" disabled={!movie.tmdbId || !onShowClick} aria-label={`Ouvrir ${movie.title}`} onClick={() => movie.tmdbId && onShowClick?.(movie.tmdbId, 'movie')}>{movie.posterUrl ? <img src={movie.posterUrl} alt="" loading="lazy" decoding="async" /> : <Film size={22} />}</button>
        <div className="download-card__body">
          <button type="button" className="download-card__title" disabled={!movie.tmdbId || !onShowClick} onClick={() => movie.tmdbId && onShowClick?.(movie.tmdbId, 'movie')}>{movie.title}</button>
          <p className="programmed__meta">Film · Radarr</p>
          <div className="programmed__foot"><When>{releasePill(movie.date)}</When>{cancelButton(movie, movie.title)}</div>
        </div>
      </div>
    </article>)}
  </section>;
}
