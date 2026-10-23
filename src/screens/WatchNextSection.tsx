import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Show } from '../types';
import type { SeriesCardAction } from '../components/cards/SeriesEpisodeCard';
import { ContinueWatchingCard } from '../components/cards/ContinueWatchingCard';
import { MovieTicketCard } from '../components/cards/MovieTicketCard';
import { resolveWatchCardResume } from '../features/watchlist/watchCardResume';
import { type SeriesCardEpisode } from '../features/watchlist/seriesCardPresentation';
import { mergeWatchGroups, orderWatchMovies } from '../features/watchlist/watchNext18c';
import { tmdb } from '../features/shows/tmdb';
import { selectTicketActor, type TicketActor } from '../features/people/movieActors';
import { useMovieActors } from '../hooks/useMovieActors';
import { useFavoritePeopleStore } from '../store/favoritePeopleStore';
import { MovieActorSheet } from '../components/MovieActorSheet';
import { HOME_PAGE_SIZE } from '../features/watchlist/homePresentation';
import { getTodayStr } from '../lib/utils';
import './watchNext18c.css';
import { HomeSwipeCard } from '../components/cards/HomeSwipeCard';
import { HomeLayoutSwitch } from '../components/cards/HomeLayoutSwitch';
import { ArrowDown, ChevronUp } from 'lucide-react';

interface Props {
  onExplore?: () => void;
  onPerson?: (id: number) => void;
  onOpenMedia?: (id: number, type: 'tv' | 'movie') => void;
  allShows: Show[];
  groups: [Show[], Show[], Show[]];
  movies: Show[];
  active: boolean;
  onOpen: (id: string, type?: 'tv' | 'movie') => void;
  onEpisode: (show: Show, season: number, episode: number) => void;
  onMarkSeries: (show: Show) => void | boolean | Promise<void | boolean>;
  onMarkMovie: (show: Show) => void | boolean | Promise<void | boolean>;
  onUnseen: (show: Show, episode: SeriesCardEpisode | null) => Promise<void | boolean>;
  actions: (show: Show) => SeriesCardAction[];
}
export function WatchNextSection({ onExplore, onPerson, onOpenMedia, allShows, groups, movies, active, onOpen, onEpisode, onMarkSeries, onMarkMovie, onUnseen, actions }: Props) {
  const { index: actorIndex, metadata: actorMetadata } = useMovieActors(allShows);
  const favorites = useFavoritePeopleStore(state => state.people);
  const [actorSheet, setActorSheet] = useState<{ actor: TicketActor; origin: Show } | null>(null);
  const candidates = mergeWatchGroups(...groups);
  const latestSeriesOrder = useRef(candidates.map(show => show.id));
  latestSeriesOrder.current = candidates.map(show => show.id);
  const [expandedGroups, setExpandedGroups] = useState<Record<number, boolean>>({});
  const [groupLimits, setGroupLimits] = useState<Record<number, number>>({});
  const [movieList, setMovieList] = useState(false);
  const memberships = useRef(new Map<string, number>());
  groups.forEach((group, index) => group.forEach(show => memberships.current.set(show.id, index)));
  const [seriesOrder, setSeriesOrder] = useState(() => candidates.map(show => show.id));
  const [retained, setRetained] = useState<Record<string, { episode?: SeriesCardEpisode }>>({});
  const [movieOrder, setMovieOrder] = useState<string[] | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const reset = useCallback(() => { setActorSheet(null); setRetained({}); setMovieOrder(null); setExpandedGroups({}); setGroupLimits({}); setMovieList(false); setMovieCount(12); setSeriesOrder(latestSeriesOrder.current); setNow(Date.now()); }, []);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    const refresh = () => { setNow(Date.now()); };
    window.addEventListener('focus', refresh);
    window.addEventListener('watchlist-reset-all', reset);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('watchlist-reset-all', reset); };
  }, [reset]);
  useEffect(() => { if (active) reset(); }, [active, reset]);
  const allById = new Map(allShows.map(show => [show.id, show]));
  const seriesById = new Map(candidates.map(show => [show.id, show]));
  const movieById = new Map(movies.map(show => [show.id, show]));
  for (const id of Object.keys(retained)) {
    const show = allById.get(id);
    if (!show || show.isArchived || show.status === 'dropped') continue;
    (show.mediaType === 'movie' ? movieById : seriesById).set(id, show);
  }
  const orderSet = new Set(seriesOrder);
  const seriesIds = [...seriesOrder.filter(id => seriesById.has(id)), ...[...seriesById.keys()].filter(id => !orderSet.has(id))];
  const seriesKey = seriesIds.join('\0');
  useEffect(() => { setSeriesOrder(seriesKey ? seriesKey.split('\0') : []); }, [seriesKey]);
  const series = seriesIds.flatMap(id => { const show = seriesById.get(id); return show ? [show] : []; });
  const staleIds = new Set(groups[2].map(show => show.id));
  const sortedMovies = orderWatchMovies([...movieById.values()]);
  const orderedMovies = movieOrder ? [
    ...movieOrder.flatMap(id => { const show = movieById.get(id); return show ? [show] : []; }),
    ...sortedMovies.filter(show => !movieOrder.includes(show.id)),
  ] : sortedMovies;
  const onRuntime = useCallback(() => {}, []);
  const markSeries = async (show: Show) => {
    const resume = resolveWatchCardResume(show, getTodayStr());
    if (!resume.episode || resume.upToDate) return false;
    const previousReceipt = retained[show.id];
    const restoreReceipt = () => setRetained(previous => {
      const next = { ...previous };
      if (previousReceipt) next[show.id] = previousReceipt;
      else delete next[show.id];
      return next;
    });
    setRetained(previous => ({ ...previous, [show.id]: { episode: resume.episode! } }));
    try { const result = await onMarkSeries(show); if (result === false) restoreReceipt(); return result; }
    catch (error) { restoreReceipt(); throw error; }
  };
  const toggleMovie = async (show: Show) => {
    setMovieOrder(previous => previous || orderedMovies.map(movie => movie.id));
    setRetained(previous => ({ ...previous, [show.id]: {} }));
    try { return show.seenEpisodes.includes('movie') ? await onUnseen(show, null) : await onMarkMovie(show); }
    catch (error) { setRetained(previous => { const next = { ...previous }; delete next[show.id]; return next; }); throw error; }
  };
  const [movieCount, setMovieCount] = useState(12);
  useEffect(() => { if (active) setMovieCount(12); }, [active]);
  useEffect(() => {
    if (!active) return;
    const back = (event: Event) => {
      const group = Object.keys(expandedGroups).find(index => expandedGroups[Number(index)]);
      if (group !== undefined) { event.preventDefault(); setExpandedGroups(previous => ({ ...previous, [Number(group)]: false })); }
      else if (movieList || movieCount > 12) { event.preventDefault(); setMovieList(false); setMovieCount(12); }
    };
    window.addEventListener('watchlist-back-one-level', back);
    return () => window.removeEventListener('watchlist-back-one-level', back);
  }, [active, expandedGroups, movieList, movieCount]);
  const start = now;
  const renderSeriesGroup = (index: number) => {
      const label = ['Continuer à regarder', 'Nouveautés', 'Pas vu depuis un moment'][index];
      const items = series.filter(show => memberships.current.get(show.id) === index);
      if (!items.length) return null;
      const expanded = Boolean(expandedGroups[index]);
      const limit = groupLimits[index] || 12;
      return <section key={label} className="home-series-section" aria-labelledby={`home-section-${index}`}>
        <header className="home-section-heading"><h2 id={`home-section-${index}`}>{label} <span>{items.length}</span></h2><HomeLayoutSwitch label={label} list={expanded} onChange={value => { setExpandedGroups(previous => ({ ...previous, [index]: value })); setGroupLimits(previous => ({ ...previous, [index]: 12 })); }} /></header>
        <div className={expanded ? 'home-series-list' : 'home-series-rail'} id={`home-series-${index}`}>
          {items.slice(0, expanded ? limit : HOME_PAGE_SIZE).map(show => {
            const card = <ContinueWatchingCard show={show} layout={expanded ? 'list' : 'rail'} animateSeen showStaleDetail={staleIds.has(show.id)} lastMarkedEpisode={retained[show.id]?.episode} onMarkUnseen={onUnseen} onMarkAsSeen={markSeries} onShowClick={onOpen} onEpisodeClick={onEpisode} actions={actions(show)} />;
            return expanded && index > 0 ? <HomeSwipeCard key={show.id} onArchive={() => actions(show).find(action => action.label.startsWith('Archiver'))?.onSelect()} onRemove={() => actions(show).find(action => action.destructive)?.onSelect()}>{card}</HomeSwipeCard> : <React.Fragment key={show.id}>{card}</React.Fragment>;
          })}
          {!expanded && items.length > HOME_PAGE_SIZE && <button type="button" className="home-rail-more" onClick={() => { setExpandedGroups(previous => ({ ...previous, [index]: true })); setGroupLimits(previous => ({ ...previous, [index]: 12 })); }}><ArrowDown size={22} /><span>Voir en liste<small>{items.length} séries</small></span></button>}
        </div>
        {expanded && items.length > limit && <button type="button" className="watch-next-18c__more-films" onClick={() => setGroupLimits(previous => ({ ...previous, [index]: limit + 12 }))}>Afficher {Math.min(12, items.length - limit)} de plus</button>}
        {expanded && <button type="button" className="home-series-collapse" onClick={() => setExpandedGroups(previous => ({ ...previous, [index]: false }))}><ChevronUp size={16} />Revenir en carrousel</button>}
      </section>;
  };
  return <section className="watch-next-18c home-watch" aria-label="À regarder">
    {[0, 1].map(renderSeriesGroup)}
    {orderedMovies.length > 0 && <>
      <div className="home-section-heading"><h2>Films à voir <span>{movies.length}</span></h2><HomeLayoutSwitch label="Films" list={movieList} onChange={setMovieList} /></div>
      <p className="home-movie-order">Ajouts les plus récents</p>
      <div className={movieList ? 'home-movie-list' : 'movie-ticket-rail'} id="films-a-voir-18c">
        {orderedMovies.slice(0, movieList ? movieCount : HOME_PAGE_SIZE).map(show => <MovieTicketCard key={show.id} show={show} layout={movieList ? 'horizontal' : 'poster'} start={start} onOpen={onOpen} onToggle={toggleMovie} onRuntime={onRuntime} actor={selectTicketActor(actorMetadata.get(`movie:${show.tmdbId}`) || tmdb.peekRenderableMediaDetails(show.tmdbId, 'movie'), favorites, actorIndex)} onActor={actor => setActorSheet({ actor, origin: show })} />)}
        {!movieList && orderedMovies.length > HOME_PAGE_SIZE && <button type="button" className="home-rail-more home-rail-more--movies" onClick={() => { setMovieList(true); setMovieCount(12); }}><ArrowDown size={22} /><span>Voir en liste<small>{orderedMovies.length} films</small></span></button>}
      </div>
      {movieList && movieCount < orderedMovies.length && <button type="button" className="watch-next-18c__more-films" onClick={() => setMovieCount(count => count + 12)}>Afficher {Math.min(12, orderedMovies.length - movieCount)} de plus</button>}
    </>}
    {actorSheet && <MovieActorSheet actor={{ ...actorSheet.actor, seen: actorIndex[actorSheet.actor.id]?.seen || [] }} origin={actorSheet.origin} shows={allShows} onClose={() => setActorSheet(null)} onPerson={id => onPerson?.(id)} onOpen={(id, type) => { const known = allShows.find(show => show.tmdbId === id && show.mediaType === type); if (known) onOpen(known.id, type); else onOpenMedia?.(id, type); }} />}
    {renderSeriesGroup(2)}
    {series.length === 0 && orderedMovies.length === 0 && <div className="home-empty"><h2>Rien à regarder pour le moment</h2>{onExplore && <button type="button" className="home-explore" onClick={onExplore}>Explorer</button>}</div>}
  </section>;
}
