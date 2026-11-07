import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Clock3, Film, Tv } from 'lucide-react';
import { useDownloadConfigStore } from '../store/downloadConfigStore';
import { useToastStore } from '../store/toastStore';
import { fetchProgrammedCalendar, programmedDateLabel, programmedScope, unprogramItem, type ProgrammedItem } from '../features/downloads/programmedCalendar';

type EpisodeItem = Extract<ProgrammedItem, { kind: 'episode' }>;
const movieRelease = (date?: string) => {
  if (!date) return 'Date à venir';
  const label = programmedDateLabel(date);
  return label === 'Demain' || label === "Aujourd'hui" ? `Sort ${label.toLowerCase()}` : `Sort le ${label}`;
};
const code = (item: EpisodeItem) => `S${String(item.season).padStart(2, '0')}E${String(item.episode).padStart(2, '0')}`;

/**
 * #879 — Section « Programmés » de l'onglet Télécharger : épisodes et films que Sonarr et Radarr
 * récupéreront à leur sortie, regroupés par série (identifiant Sonarr exact). « Annuler » retire la
 * surveillance de l'élément, sans rien supprimer ; une source injoignable est dite, pas masquée.
 */
export function ProgrammedSection({ refreshKey = 0, onShowClick }: { refreshKey?: number; onShowClick?: (id: string | number, mediaType?: 'tv' | 'movie') => void }) {
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

  if (!items.length && !failures.length) return null;
  const series = new Map<number, EpisodeItem[]>();
  const movies: Extract<ProgrammedItem, { kind: 'movie' }>[] = [];
  for (const item of items) {
    if (item.kind === 'movie') movies.push(item);
    else series.set(item.seriesId, [...(series.get(item.seriesId) || []), item]);
  }
  const cancelButton = (item: ProgrammedItem, label: string) => <button type="button" disabled={busy !== null} onClick={() => void cancel(item)} aria-label={`Annuler la programmation de ${label}`} className="programmed__cancel">Annuler</button>;

  return <section className="downloads-section" data-programmed>
    <h2>Programmés · {items.length}</h2>
    {failures.length > 0 && <p className="download-card__meta" role="status">{failures.join(' et ')} injoignable pour l’instant : la liste peut être incomplète.</p>}
    {[...series.values()].map(group => {
      const first = group[0];
      const open = () => first.tmdbId && onShowClick?.(first.tmdbId, 'tv');
      return <article key={`s${first.seriesId}`} className="download-card programmed" data-programmed-series={first.seriesId}>
        <div className="download-card__head">
          <button type="button" className="download-card__poster download-season__poster" disabled={!first.tmdbId || !onShowClick} aria-label={`Ouvrir ${first.seriesTitle}`} onClick={open}>{first.posterUrl ? <img src={first.posterUrl} alt="" loading="lazy" decoding="async" /> : <Tv size={22} />}</button>
          <div className="download-card__body">
            <button type="button" className="download-card__title" disabled={!first.tmdbId || !onShowClick} onClick={open}>{first.seriesTitle}</button>
            <p className="download-card__scope">{group.length} épisode{group.length > 1 ? 's' : ''} · récupéré{group.length > 1 ? 's' : ''} à la sortie</p>
          </div>
        </div>
        <ul className="download-season__rows">
          {group.map(item => <li key={item.id} className="download-season__row" data-programmed-episode={item.id}>
            <span className="download-season__code">{code(item)}</span>
            <span className="download-season__text"><span className="download-season__title">{item.title}</span><span className="download-season__state programmed__state"><Clock3 size={13} aria-hidden="true" />Programmé · {programmedDateLabel(item.date)}</span></span>
            {cancelButton(item, `${first.seriesTitle} ${code(item)}`)}
          </li>)}
        </ul>
      </article>;
    })}
    {movies.map(movie => <article key={`m${movie.id}`} className="download-card programmed" data-programmed-movie={movie.id}>
      <div className="download-card__head">
        <button type="button" className="download-card__poster download-season__poster" disabled={!movie.tmdbId || !onShowClick} aria-label={`Ouvrir ${movie.title}`} onClick={() => movie.tmdbId && onShowClick?.(movie.tmdbId, 'movie')}>{movie.posterUrl ? <img src={movie.posterUrl} alt="" loading="lazy" decoding="async" /> : <Film size={22} />}</button>
        <div className="download-card__body">
          <button type="button" className="download-card__title" disabled={!movie.tmdbId || !onShowClick} onClick={() => movie.tmdbId && onShowClick?.(movie.tmdbId, 'movie')}>{movie.title}</button>
          <p className="download-card__scope">Film · {movieRelease(movie.date)}</p>
          <p className="download-season__state programmed__state"><Clock3 size={13} aria-hidden="true" />Radarr le récupère dès sa sortie</p>
        </div>
        {cancelButton(movie, movie.title)}
      </div>
    </article>)}
  </section>;
}
