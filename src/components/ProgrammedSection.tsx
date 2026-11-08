import React, { useEffect, useState } from 'react';
import { Clock3, Film, MoreHorizontal, Tv, X } from 'lucide-react';
import { useDownloadConfigStore } from '../store/downloadConfigStore';
import { useToastStore } from '../store/toastStore';
import { arrSyncKey, notifyArrWrite, useArrSnapshot, useArrSyncStore } from '../store/arrSyncStore';
import { changeProgrammedQuality, fetchWatchedMovie, programmedDateLabel, programmedScope, unprogramItem, type ProgrammedItem, type ReleaseKind } from '../features/downloads/programmedCalendar';
import type { LiveDownloadItem } from '../services/sonarrRadarrLive';

type EpisodeItem = Extract<ProgrammedItem, { kind: 'episode' }>;
type MovieItem = Extract<ProgrammedItem, { kind: 'movie' }>;
type WatchedMovie = Awaited<ReturnType<typeof fetchWatchedMovie>>;

/**
 * Pastille de date (refonte du 08/11) : « Sortie ven. 13 nov. » pour un épisode ; pour un film, la sortie dont
 * il s'agit (« Sortie numérique 3 févr. », « Au cinéma 9 déc. »), car seule une version numérique ou physique
 * se télécharge. Depuis la v1.4.281 la pastille a sa propre ligne et passe à la ligne au lieu d'être rognée.
 */
export function releasePill(date?: string, kind: ReleaseKind = 'air'): string {
  if (!date) return 'Date à venir';
  const label = programmedDateLabel(date);
  const day = label === 'Demain' || label === "Aujourd'hui" ? label.toLowerCase() : label;
  if (kind === 'cinema') return `Au cinéma ${day}`;
  if (kind === 'digital') return `Sortie numérique ${day}`;
  if (kind === 'physical') return `Sortie Blu-ray ${day}`;
  return `Sortie ${day}`;
}
/** Film suivi sans date utile : la raison exacte, jamais une date inventée. */
export function watchedMoviePill(details: WatchedMovie | undefined): string {
  if (details?.date) return releasePill(details.date, details.dateKind);
  if (details?.inCinemasPast) return 'Déjà au cinéma · sortie numérique pas encore annoncée';
  return details ? 'Date de sortie pas encore annoncée' : 'Pas encore de version';
}
const When = ({ children }: { children: React.ReactNode }) => <span className="programmed__when"><Clock3 size={13} aria-hidden="true" />{children}</span>;
const code = (item: EpisodeItem) => `S${String(item.season).padStart(2, '0')}E${String(item.episode).padStart(2, '0')}`;
const pad = (value: number) => String(value).padStart(2, '0');
const qualityChoice = (quality?: string) => quality === '4K' ? '4k' : quality === '1080p' ? '1080p' : null;

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
 * récupéreront à leur sortie, regroupés par série (identifiant Sonarr exact). Retour terrain du 08/11 : une
 * demande lancée sans version disponible, dont la surveillance est confirmée (`watching`), y figure aussi ;
 * l'entrée du calendrier du même périmètre exact n'est pas répétée. Chaque carte a son menu ⋯ (qualité 1080p/4K,
 * annulation). La liste vient de l'état Sonarr/Radarr synchronisé (SEENIT-DOWNLOAD-016) : la section ne lit
 * rien elle-même, et chaque action resynchronise cet état et la fiche concernée.
 */
export function ProgrammedSection({ refreshKey = 0, onShowClick, watching = [], onRemoveWatching }: { refreshKey?: number; onShowClick?: (id: string | number, mediaType?: 'tv' | 'movie') => void; watching?: readonly LiveDownloadItem[]; onRemoveWatching?: (item: LiveDownloadItem) => void }) {
  // Les identifiants viennent d'un serveur précis : la copie synchronisée est liée au compte et au serveur.
  const scope = programmedScope(useDownloadConfigStore());
  const snapshot = useArrSnapshot();
  const revision = useArrSyncStore(state => state.revision);
  // Masque tout de suite ce qui vient d'être annulé, en attendant la resynchronisation.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const syncedAt = snapshot?.syncedAt;
  useEffect(() => { setHidden(new Set()); }, [syncedAt]);
  const items = (snapshot?.programmed?.items || []).filter(item => !hidden.has(`${item.kind}:${item.id}`));
  const failures = snapshot?.programmed?.failures || [];
  const [watchedMovies, setWatchedMovies] = useState<Record<number, WatchedMovie>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  useEffect(() => { void useArrSyncStore.getState().sync(); }, [refreshKey, scope]);

  // Film suivi absent du calendrier : ses dates et sa qualité sont lues dans Radarr par son TMDB exact.
  const watchedMovieIds = watching.filter(entry => entry.mediaType === 'movie' && Number(entry.tmdbId) > 0 && !items.some(item => coveredBy(item, entry))).map(entry => Number(entry.tmdbId));
  const watchedKey = watchedMovieIds.join(',');
  useEffect(() => {
    if (!watchedKey) return;
    let current = true;
    const config = useDownloadConfigStore.getState();
    void Promise.all(watchedKey.split(',').map(async tmdbId => [Number(tmdbId), await fetchWatchedMovie(config, Number(tmdbId)).catch(() => null)] as const)).then(entries => {
      if (current && programmedScope(useDownloadConfigStore.getState()) === programmedScope(config)) setWatchedMovies(previous => ({ ...previous, ...Object.fromEntries(entries) }));
    });
    return () => { current = false; };
  }, [watchedKey, revision, scope]);

  const toast = useToastStore.getState().showToast;
  // Jamais un identifiant d'une copie d'un autre compte ou serveur envoyé au serveur actuel : relecture à la place.
  const sameScope = () => {
    if (useArrSyncStore.getState().snapshot?.key === arrSyncKey()) return true;
    toast({ title: 'Programmés', action: 'La configuration a changé : liste rechargée, rien n’a été modifié.' }, 'info');
    void useArrSyncStore.getState().sync();
    return false;
  };
  const cancel = async (targets: readonly ProgrammedItem[], label: string) => {
    if (busy || !targets.length || !sameScope()) return;
    setBusy(label);
    setMenu(null);
    const config = useDownloadConfigStore.getState();
    try {
      for (const item of targets) await unprogramItem(config, item);
      setHidden(previous => new Set([...previous, ...targets.map(item => `${item.kind}:${item.id}`)]));
      const first = targets[0];
      // État synchronisé et fiche relus ensemble : l'épisode ou le film redevient programmable dans sa fiche.
      notifyArrWrite({ tmdbId: first.tmdbId, tvdbId: first.kind === 'episode' ? first.tvdbId : undefined, mediaType: first.kind === 'movie' ? 'movie' : 'tv' });
      toast({ title: first.kind === 'episode' ? first.seriesTitle : first.title, subtitle: first.kind === 'episode' && targets.length === 1 ? `S${first.season} | E${first.episode}` : undefined, action: targets.length > 1 ? `${targets.length} épisodes ne sont plus programmés.` : 'N’est plus programmé.' }, 'info');
    } catch (error: unknown) {
      toast({ title: label, action: error instanceof Error ? error.message : 'Impossible de déprogrammer.' }, 'error');
      notifyArrWrite();
    } finally {
      setBusy(null);
    }
  };
  const changeQuality = async (target: { kind: 'movie'; id: number } | { kind: 'series'; id: number }, preference: '1080p' | '4k', label: string, media: { tmdbId?: number; mediaType: 'tv' | 'movie' }) => {
    if (busy || !sameScope()) return;
    setBusy(label);
    setMenu(null);
    try {
      await changeProgrammedQuality(useDownloadConfigStore.getState(), target, preference);
      toast({ title: label, action: `Qualité : ${preference === '4k' ? '4K' : '1080p'}` }, 'success');
      notifyArrWrite(media);
    } catch (error: unknown) {
      toast({ title: label, action: error instanceof Error ? error.message : 'Qualité inchangée.' }, 'error');
    } finally {
      setBusy(null);
    }
  };

  if (!items.length && !failures.length && !watching.length) return null;
  const series = new Map<number, EpisodeItem[]>();
  const movies: MovieItem[] = [];
  const covering = new Map<string, ProgrammedItem>();
  for (const item of items) {
    const watched = watching.find(entry => coveredBy(item, entry));
    if (watched) { covering.set(watched.id, item); continue; }
    if (item.kind === 'movie') movies.push(item);
    else series.set(item.seriesId, [...(series.get(item.seriesId) || []), item]);
  }
  const rowCancel = (item: EpisodeItem, label: string) => <button type="button" disabled={busy !== null} onClick={() => void cancel([item], label)} aria-label={`Annuler la programmation de ${label}`} className="programmed__cancel programmed__cancel--icon"><X size={18} aria-hidden="true" /></button>;
  /** Menu ⋯ de chaque carte (retour terrain du 08/11 : « toujours les 3 petits points pour changer la qualité »). */
  const cardMenu = (key: string, label: string, quality: string | undefined, onQuality: ((preference: '1080p' | '4k') => void) | null, onCancel: () => void, cancelLabel = 'Annuler la programmation') => {
    const open = menu === key;
    return { open, button: <button type="button" className="download-card__more" aria-label={`Actions pour ${label}`} aria-expanded={open} onClick={() => setMenu(open ? null : key)}><MoreHorizontal size={20} /></button>,
      panel: open && <div className="download-card__actions programmed__menu" data-programmed-menu={key}>
        {onQuality && <div className="programmed__quality" role="group" aria-label={`Qualité de ${label}`}>
          <span>Qualité</span>
          {(['1080p', '4k'] as const).map(choice => <button key={choice} type="button" disabled={busy !== null} aria-pressed={qualityChoice(quality) === choice} onClick={() => qualityChoice(quality) !== choice && onQuality(choice)}>{choice === '4k' ? '4K' : '1080p'}</button>)}
        </div>}
        <button type="button" disabled={busy !== null} onClick={onCancel}><X size={15} aria-hidden="true" />{cancelLabel}</button>
      </div> };
  };
  const poster = (url: string | null | undefined, isTv: boolean, name: string, onOpen: () => void, disabled: boolean) => <button type="button" className="download-card__poster download-season__poster" disabled={disabled} aria-label={`Ouvrir ${name}`} onClick={onOpen}>{url ? <img src={url} alt="" loading="lazy" decoding="async" /> : isTv ? <Tv size={22} /> : <Film size={22} />}</button>;
  const meta = (...parts: Array<string | undefined | false>) => parts.filter(Boolean).join(' · ');

  return <section className="downloads-section" data-programmed>
    <h2>Programmés</h2>
    {failures.length > 0 && <p className="download-card__meta" role="status">{failures.join(' et ')} injoignable pour l’instant : la liste peut être incomplète.</p>}
    {watching.map(entry => {
      const isTv = entry.mediaType === 'tv';
      const name = entry.movieTitle || entry.seriesTitle || entry.title;
      const open = () => entry.tmdbId && onShowClick?.(entry.tmdbId, entry.mediaType);
      const item = covering.get(entry.id);
      const details = !isTv && !item && Number(entry.tmdbId) > 0 ? watchedMovies[Number(entry.tmdbId)] : undefined;
      const quality = item?.quality || details?.quality || entry.quality;
      const pill = item ? releasePill(item.date, item.kind === 'movie' ? item.dateKind : 'air') : isTv ? 'Pas encore de version' : watchedMoviePill(Number(entry.tmdbId) in watchedMovies ? details : undefined);
      const radarrId = item?.kind === 'movie' ? item.id : details?.id;
      const actions = cardMenu(`w${entry.id}`, name, quality, !isTv && radarrId ? choice => void changeQuality({ kind: 'movie', id: radarrId }, choice, name, { tmdbId: Number(entry.tmdbId) || undefined, mediaType: 'movie' }) : null, () => { setMenu(null); onRemoveWatching?.(entry); });
      return <article key={`w${entry.id}`} className="download-card programmed" data-programmed-request={entry.id}>
        <div className="download-card__head">
          {poster(posterUrl(entry.posterPath), isTv, name, open, !entry.tmdbId || !onShowClick)}
          <div className="download-card__body">
            <button type="button" className="download-card__title" disabled={!entry.tmdbId || !onShowClick} onClick={open}>{name}</button>
            <p className="programmed__meta">{meta(requestScope(entry), isTv ? 'Sonarr' : 'Radarr', quality)}</p>
            <div className="programmed__foot"><When>{pill}</When></div>
          </div>
          {onRemoveWatching && actions.button}
        </div>
        {actions.panel}
      </article>;
    })}
    {[...series.values()].map(group => {
      const first = group[0];
      const open = () => first.tmdbId && onShowClick?.(first.tmdbId, 'tv');
      const actions = cardMenu(`s${first.seriesId}`, first.seriesTitle, first.quality, choice => void changeQuality({ kind: 'series', id: first.seriesId }, choice, first.seriesTitle, { tmdbId: first.tmdbId, mediaType: 'tv' }), () => void cancel(group, first.seriesTitle), group.length > 1 ? `Ne plus programmer ces ${group.length} épisodes` : 'Annuler la programmation');
      return <article key={`s${first.seriesId}`} className="download-card programmed" data-programmed-series={first.seriesId}>
        <div className="download-card__head">
          {poster(first.posterUrl, true, first.seriesTitle, open, !first.tmdbId || !onShowClick)}
          <div className="download-card__body">
            <button type="button" className="download-card__title" disabled={!first.tmdbId || !onShowClick} onClick={open}>{first.seriesTitle}</button>
            <p className="programmed__meta">{meta('Série · Sonarr', first.quality, `${group.length} épisode${group.length > 1 ? 's' : ''}`)}</p>
            <div className="programmed__foot"><When>{releasePill(group.map(item => item.date).filter((value): value is string => Boolean(value)).sort()[0])}</When></div>
          </div>
          {actions.button}
        </div>
        {actions.panel}
        <ul className="download-season__rows">
          {group.map(item => <li key={item.id} className="download-season__row" data-programmed-episode={item.id}>
            <span className="download-season__code">{code(item)}</span>
            <span className="programmed__row-text">
              <span className="programmed__row-title" data-untitled={isUntitledEpisode(item) || undefined}>{isUntitledEpisode(item) ? 'Titre à venir' : item.title}</span>
              <span className="programmed__row-date">{programmedDateLabel(item.date)}</span>
            </span>
            {rowCancel(item, `${first.seriesTitle} ${code(item)}`)}
          </li>)}
        </ul>
      </article>;
    })}
    {movies.map(movie => {
      const open = () => movie.tmdbId && onShowClick?.(movie.tmdbId, 'movie');
      const actions = cardMenu(`m${movie.id}`, movie.title, movie.quality, choice => void changeQuality({ kind: 'movie', id: movie.id }, choice, movie.title, { tmdbId: movie.tmdbId, mediaType: 'movie' }), () => void cancel([movie], movie.title));
      return <article key={`m${movie.id}`} className="download-card programmed" data-programmed-movie={movie.id}>
        <div className="download-card__head">
          {poster(movie.posterUrl, false, movie.title, open, !movie.tmdbId || !onShowClick)}
          <div className="download-card__body">
            <button type="button" className="download-card__title" disabled={!movie.tmdbId || !onShowClick} onClick={open}>{movie.title}</button>
            <p className="programmed__meta">{meta('Film · Radarr', movie.quality)}</p>
            <div className="programmed__foot"><When>{releasePill(movie.date, movie.dateKind)}</When></div>
          </div>
          {actions.button}
        </div>
        {actions.panel}
      </article>;
    })}
  </section>;
}
