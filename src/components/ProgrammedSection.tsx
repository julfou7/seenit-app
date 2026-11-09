import React, { useEffect, useState } from 'react';
import { ChevronDown, Clock3, Film, MoreHorizontal, Tv, X } from 'lucide-react';
import { auth } from '../lib/firebase';
import { readUserScopedJson, writeUserScopedJson } from '../lib/userIsolation';
import { useDownloadConfigStore } from '../store/downloadConfigStore';
import { useShowsStore } from '../store/showsStore';
import { hideSeenWanted, seenWatchedRequest } from '../features/downloads/wantedSeen';
import { useToastStore } from '../store/toastStore';
import { arrSyncKey, notifyArrWrite, useArrSnapshot, useArrSyncStore, type WatchedMovieDetails } from '../store/arrSyncStore';
import { changeProgrammedQuality, programmedDateLabel, programmedScope, unprogramItem, type ProgrammedItem, type ReleaseKind } from '../features/downloads/programmedCalendar';
import type { LiveDownloadItem } from '../services/sonarrRadarrLive';

type EpisodeItem = Extract<ProgrammedItem, { kind: 'episode' }>;
type MovieItem = Extract<ProgrammedItem, { kind: 'movie' }>;
type WatchedMovie = WatchedMovieDetails;

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
/** Décision du 09/11 (`USR-2026-11-09-009`) : sorti, surveillé, sans fichier — Sonarr/Radarr le cherchent encore. */
export const WANTED_PILL = 'Recherché · pas encore de version';
/** Pastille d'un film du calendrier ou recherché : sa sortie, sinon la raison exacte. */
export function programmedMoviePill(movie: Pick<MovieItem, 'date' | 'dateKind' | 'wanted' | 'inCinemasPast'>): string {
  if (movie.date) return releasePill(movie.date, movie.dateKind);
  if (movie.wanted) return WANTED_PILL;
  return movie.inCinemasPast ? 'Déjà au cinéma · sortie numérique pas encore annoncée' : 'Date à venir';
}
const itemPill = (item: EpisodeItem) => item.wanted ? WANTED_PILL : releasePill(item.date);
/** Jour de sortie passé d'un épisode recherché (« sam. 31 oct. »). */
const pastDayLabel = (date?: string) => date ? new Date(date).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) : '';

/** v1.4.284 (retour terrain du 09/11 : « une vue compacte ? la hauteur varie d'une série à l'autre ») : une ligne
 * de hauteur régulière par titre, épisodes repliés ; la vue détaillée reste au choix, mémorisée par compte. */
export type ProgrammedLayout = 'compact' | 'detailed';
const LAYOUT_FIELD = 'downloads.programmed.layout';
/**
 * Retour terrain du 09/11 sur la v1.4.284 (MobLand, 9 épisodes : « il faut que je puisse masquer le détail de
 * tous les épisodes, ça prend toute la place ») : en détaillé, les épisodes se replient ; dépliés jusqu'à 3 par
 * défaut, repliés au-delà. En compact, toujours repliés.
 */
export const EPISODES_OPEN_MAX = 3;
export const episodesOpenByDefault = (layout: ProgrammedLayout, count: number) => layout === 'detailed' && count <= EPISODES_OPEN_MAX;
export function episodesToggleLabel(open: boolean, count: number, wanted: number): string {
  const target = count > 1 ? `les ${count} épisodes` : 'l’épisode';
  if (open) return `Masquer ${target}`;
  return `Voir ${target}${wanted ? ` · ${wanted} recherché${wanted > 1 ? 's' : ''}` : ''}`;
}
interface ProgrammedCard {
  key: string; data: Record<string, number | string>; name: string; isTv: boolean; poster?: string | null; meta: string; pill: string;
  open: () => unknown; canOpen: boolean;
  actions: { open: boolean; button: React.ReactNode; panel: React.ReactNode } | null;
  episodes?: { summary: string; count: number; wanted: number; rows: React.ReactNode };
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
export function ProgrammedSection({ refreshKey = 0, onShowClick, watching: watchingRequests = [], onRemoveWatching }: { refreshKey?: number; onShowClick?: (id: string | number, mediaType?: 'tv' | 'movie') => void; watching?: readonly LiveDownloadItem[]; onRemoveWatching?: (item: LiveDownloadItem) => void }) {
  // Les identifiants viennent d'un serveur précis : la copie synchronisée est liée au compte et au serveur.
  const scope = programmedScope(useDownloadConfigStore());
  const snapshot = useArrSnapshot();
  // Masque tout de suite ce qui vient d'être annulé, en attendant la resynchronisation.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const syncedAt = snapshot?.syncedAt;
  useEffect(() => { setHidden(new Set()); }, [syncedAt]);
  // Retour terrain du 09/11 (`USR-2026-11-09-016`) : un recherché déjà vu dans SeenIt depuis 24 h n'est plus listé.
  const shows = useShowsStore(state => state.shows);
  // Revue Codex #928 : une demande suivie d'un film ou d'un épisode vu depuis 24 h suit la même règle.
  const watching = watchingRequests.filter(entry => !seenWatchedRequest(entry, shows));
  const items = hideSeenWanted((snapshot?.programmed?.items || []).filter(item => !hidden.has(`${item.kind}:${item.id}`)), shows);
  const failures = snapshot?.programmed?.failures || [];
  const [busy, setBusy] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [layout, setLayout] = useState<ProgrammedLayout>(() => readUserScopedJson<ProgrammedLayout>(auth.currentUser?.uid, LAYOUT_FIELD, 'compact') === 'detailed' ? 'detailed' : 'compact');
  // Choix explicite d'ouvrir ou de replier les épisodes, par vue (`compact:s5`, `detailed:s5`). Un choix fait reste
  // tel quel même si le nombre d'épisodes change ensuite (annulation) ; sans choix, l'état par défaut s'applique.
  const [episodesChoice, setEpisodesChoice] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  useEffect(() => { void useArrSyncStore.getState().sync(); }, [refreshKey, scope]);

  // Film suivi absent du calendrier : ses dates, sa qualité et son identifiant Radarr font partie de la copie
  // synchronisée (même compte, même serveur, relus à chaque synchronisation — revue Codex #918).
  const watchedMovieIds = watching.filter(entry => entry.mediaType === 'movie' && Number(entry.tmdbId) > 0 && !items.some(item => coveredBy(item, entry))).map(entry => Number(entry.tmdbId));
  const watchedKey = watchedMovieIds.join(',');
  useEffect(() => { useArrSyncStore.getState().watchMovies(watchedKey ? watchedKey.split(',').map(Number) : []); }, [watchedKey]);
  const watchedMovies: Record<number, WatchedMovie> = snapshot?.watched || {};

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
    // Retour terrain du 09/11 sur la v1.4.285 (« la photo disparaît quand je retire un épisode ») : le toast garde
    // l'affiche du titre, comme ceux du lancement et de la programmation.
    const first = targets[0];
    const posterPath = first.posterUrl || null;
    const media = first.tmdbId ? { tmdbId: first.tmdbId, mediaType: first.kind === 'movie' ? 'movie' as const : 'tv' as const } : null;
    try {
      for (const item of targets) await unprogramItem(config, item);
      setHidden(previous => new Set([...previous, ...targets.map(item => `${item.kind}:${item.id}`)]));
      // État synchronisé et fiche relus ensemble : l'épisode ou le film redevient programmable dans sa fiche.
      notifyArrWrite({ tmdbId: first.tmdbId, tvdbId: first.kind === 'episode' ? first.tvdbId : undefined, mediaType: first.kind === 'movie' ? 'movie' : 'tv' });
      toast({ title: first.kind === 'episode' ? first.seriesTitle : first.title, subtitle: first.kind === 'episode' && targets.length === 1 ? `S${first.season} | E${first.episode}` : undefined, action: targets.length > 1 ? `${targets.length} épisodes ne sont plus programmés.` : 'N’est plus programmé.', posterPath, media }, 'info');
    } catch (error: unknown) {
      toast({ title: label, action: error instanceof Error ? error.message : 'Impossible de déprogrammer.', posterPath, media }, 'error');
      notifyArrWrite();
    } finally {
      setBusy(null);
    }
  };
  const changeQuality = async (target: { kind: 'movie'; id: number } | { kind: 'series'; id: number }, preference: '1080p' | '4k', label: string, media: { tmdbId?: number; mediaType: 'tv' | 'movie' }, posterPath?: string | null) => {
    if (busy || !sameScope()) return;
    setBusy(label);
    setMenu(null);
    try {
      await changeProgrammedQuality(useDownloadConfigStore.getState(), target, preference);
      toast({ title: label, action: `Qualité : ${preference === '4k' ? '4K' : '1080p'}`, posterPath, media: media.tmdbId ? { tmdbId: media.tmdbId, mediaType: media.mediaType } : null }, 'success');
      notifyArrWrite(media);
    } catch (error: unknown) {
      toast({ title: label, action: error instanceof Error ? error.message : 'Qualité inchangée.', posterPath, media: media.tmdbId ? { tmdbId: media.tmdbId, mediaType: media.mediaType } : null }, 'error');
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
  // Retour terrain du 09/11 : « supprime Sonarr et Radarr sous le titre, y a pas besoin » — type, qualité, nombre.
  const meta = (...parts: Array<string | undefined | false>) => parts.filter(Boolean).join(' · ');
  const compact = layout === 'compact';
  const episodesOpen = (card: ProgrammedCard) => Boolean(card.episodes) && (episodesChoice.get(`${layout}:${card.key}`) ?? episodesOpenByDefault(layout, card.episodes!.count));
  const toggleEpisodes = (card: ProgrammedCard) => { const open = episodesOpen(card); setEpisodesChoice(previous => new Map(previous).set(`${layout}:${card.key}`, !open)); };

  // Chaque carte est décrite une fois puis rendue en vue détaillée ou compacte (v1.4.284).
  const cards: ProgrammedCard[] = [];
  for (const entry of watching) {
    const isTv = entry.mediaType === 'tv';
    const name = entry.movieTitle || entry.seriesTitle || entry.title;
    const item = covering.get(entry.id);
    const details = !isTv && !item && Number(entry.tmdbId) > 0 ? watchedMovies[Number(entry.tmdbId)] : undefined;
    const quality = item?.quality || details?.quality || entry.quality;
    const pill = item ? item.kind === 'movie' ? programmedMoviePill(item) : itemPill(item) : isTv ? 'Pas encore de version' : watchedMoviePill(Number(entry.tmdbId) in watchedMovies ? details : undefined);
    const radarrId = item?.kind === 'movie' ? item.id : details?.id;
    cards.push({ key: `w${entry.id}`, data: { 'data-programmed-request': entry.id }, name, isTv, poster: posterUrl(entry.posterPath), meta: meta(requestScope(entry), quality), pill,
      open: () => entry.tmdbId && onShowClick?.(entry.tmdbId, entry.mediaType), canOpen: Boolean(entry.tmdbId && onShowClick),
      actions: onRemoveWatching ? cardMenu(`w${entry.id}`, name, quality, !isTv && radarrId ? choice => void changeQuality({ kind: 'movie', id: radarrId }, choice, name, { tmdbId: Number(entry.tmdbId) || undefined, mediaType: 'movie' }, posterUrl(entry.posterPath)) : null, () => { setMenu(null); onRemoveWatching(entry); }) : null });
  }
  for (const group of series.values()) {
    const first = group[0];
    const upcoming = group.filter(item => !item.wanted).map(item => item.date).filter((value): value is string => Boolean(value)).sort()[0];
    const wantedCount = group.filter(item => item.wanted).length;
    cards.push({ key: `s${first.seriesId}`, data: { 'data-programmed-series': first.seriesId }, name: first.seriesTitle, isTv: true, poster: first.posterUrl,
      meta: meta('Série', first.quality, `${group.length} épisode${group.length > 1 ? 's' : ''}`),
      pill: upcoming || wantedCount < group.length ? releasePill(upcoming) : WANTED_PILL,
      open: () => first.tmdbId && onShowClick?.(first.tmdbId, 'tv'), canOpen: Boolean(first.tmdbId && onShowClick),
      actions: cardMenu(`s${first.seriesId}`, first.seriesTitle, first.quality, choice => void changeQuality({ kind: 'series', id: first.seriesId }, choice, first.seriesTitle, { tmdbId: first.tmdbId, mediaType: 'tv' }, first.posterUrl), () => void cancel(group, first.seriesTitle), group.length > 1 ? `Ne plus programmer ces ${group.length} épisodes` : 'Annuler la programmation'),
      episodes: { summary: group.length === 1 ? code(first) : `${code(first)}–${code(group[group.length - 1])}`, count: group.length, wanted: wantedCount, rows: <ul className="download-season__rows">
        {group.map(item => <li key={item.id} className="download-season__row" data-programmed-episode={item.id}>
          <span className="download-season__code">{code(item)}</span>
          <span className="programmed__row-text">
            <span className="programmed__row-title" data-untitled={isUntitledEpisode(item) || undefined}>{isUntitledEpisode(item) ? 'Titre à venir' : item.title}</span>
            <span className="programmed__row-date" data-wanted={item.wanted || undefined}>{item.wanted ? `Sorti ${pastDayLabel(item.date)} · recherché` : programmedDateLabel(item.date)}</span>
          </span>
          {rowCancel(item, `${first.seriesTitle} ${code(item)}`)}
        </li>)}
      </ul> } });
  }
  for (const movie of movies) {
    cards.push({ key: `m${movie.id}`, data: { 'data-programmed-movie': movie.id }, name: movie.title, isTv: false, poster: movie.posterUrl, meta: meta('Film', movie.quality), pill: programmedMoviePill(movie),
      open: () => movie.tmdbId && onShowClick?.(movie.tmdbId, 'movie'), canOpen: Boolean(movie.tmdbId && onShowClick),
      actions: cardMenu(`m${movie.id}`, movie.title, movie.quality, choice => void changeQuality({ kind: 'movie', id: movie.id }, choice, movie.title, { tmdbId: movie.tmdbId, mediaType: 'movie' }, movie.posterUrl), () => void cancel([movie], movie.title)) });
  }
  const posterButton = (card: ProgrammedCard, className: string) => <button type="button" className={className} disabled={!card.canOpen} aria-label={`Ouvrir ${card.name}`} onClick={card.open}>{card.poster ? <img src={card.poster} alt="" loading="lazy" decoding="async" /> : card.isTv ? <Tv size={20} /> : <Film size={20} />}</button>;
  const switchLayout = (next: ProgrammedLayout) => { setLayout(next); writeUserScopedJson(auth.currentUser?.uid, LAYOUT_FIELD, next); };

  return <section className="downloads-section" data-programmed data-layout={layout}>
    <div className="programmed-head">
      <h2>Programmés</h2>
      <div className="programmed-layout" role="group" aria-label="Présentation de Programmés">
        <button type="button" aria-label="Programmés en compact" aria-pressed={compact} onClick={() => switchLayout('compact')}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="3.5" rx="1.5" /><rect x="3" y="10.25" width="18" height="3.5" rx="1.5" /><rect x="3" y="16.5" width="18" height="3.5" rx="1.5" /></svg></button>
        <button type="button" aria-label="Programmés en détaillé" aria-pressed={!compact} onClick={() => switchLayout('detailed')}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="8" rx="2.5" /><rect x="3" y="13" width="18" height="8" rx="2.5" /></svg></button>
      </div>
    </div>
    {failures.length > 0 && <p className="download-card__meta" role="status">{failures.join(' et ')} injoignable pour l’instant : la liste peut être incomplète.</p>}
    {cards.map(card => compact
      ? <article key={card.key} className="programmed-compact" {...card.data}>
        <div className="programmed-compact__row">
          {posterButton(card, 'programmed-compact__poster')}
          <div className="programmed-compact__body">
            <button type="button" className="programmed-compact__title" disabled={!card.canOpen} onClick={card.open}>{card.name}</button>
            <p className="programmed__meta">{card.meta}</p>
            <span className="programmed-compact__when">{card.pill}</span>
          </div>
          {card.episodes && <button type="button" className="programmed-compact__expand" aria-expanded={episodesOpen(card)} aria-label={`${episodesOpen(card) ? 'Replier' : 'Voir'} les épisodes de ${card.name} (${card.episodes.summary})`} onClick={() => toggleEpisodes(card)}><ChevronDown size={20} aria-hidden="true" /></button>}
          {card.actions?.button}
        </div>
        {card.actions?.panel}
        {card.episodes && episodesOpen(card) && card.episodes.rows}
      </article>
      : <article key={card.key} className="download-card programmed" {...card.data}>
        <div className="download-card__head">
          {posterButton(card, 'download-card__poster download-season__poster')}
          <div className="download-card__body">
            <button type="button" className="download-card__title" disabled={!card.canOpen} onClick={card.open}>{card.name}</button>
            <p className="programmed__meta">{card.meta}</p>
            <div className="programmed__foot"><When>{card.pill}</When></div>
          </div>
          {card.actions?.button}
        </div>
        {card.actions?.panel}
        {card.episodes && <button type="button" className="programmed__episodes-toggle" aria-expanded={episodesOpen(card)} onClick={() => toggleEpisodes(card)}>
          <span>{episodesToggleLabel(episodesOpen(card), card.episodes.count, card.episodes.wanted)}</span>
          <ChevronDown size={18} aria-hidden="true" />
        </button>}
        {card.episodes && episodesOpen(card) && card.episodes.rows}
      </article>)}
  </section>;
}
