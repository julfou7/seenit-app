import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Show } from '../types';
import type { SeriesCardAction } from '../components/cards/SeriesEpisodeCard';
import { ContinueWatchingCard } from '../components/cards/ContinueWatchingCard';
import { MovieTicketCard } from '../components/cards/MovieTicketCard';
import { resolveWatchCardResume } from '../features/watchlist/watchCardResume';
import { type SeriesCardEpisode } from '../features/watchlist/seriesCardPresentation';
import { mergeWatchGroups, movieRuntime } from '../features/watchlist/watchNext18c';
import { tmdb } from '../features/shows/tmdb';
import { getTodayStr } from '../lib/utils';
import './watchNext18c.css';
import { HomeSwipeCard } from '../components/cards/HomeSwipeCard';
import { ChevronUp, LayoutGrid, List } from 'lucide-react';

interface Props {
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
export function WatchNextSection({ allShows, groups, movies, active, onOpen, onEpisode, onMarkSeries, onMarkMovie, onUnseen, actions }: Props) {
  const candidates = mergeWatchGroups(...groups);
  const latestSeriesOrder = useRef(candidates.map(show => show.id));
  latestSeriesOrder.current = candidates.map(show => show.id);
  const [expandedGroups, setExpandedGroups] = useState<Record<number, boolean>>({});
  const [groupLimits, setGroupLimits] = useState<Record<number, number>>({});
  const [movieGrid, setMovieGrid] = useState(false);
  const memberships = useRef(new Map<string, number>());
  groups.forEach((group, index) => group.forEach(show => memberships.current.set(show.id, index)));
  const [seriesOrder, setSeriesOrder] = useState(() => candidates.map(show => show.id));
  const [retained, setRetained] = useState<Record<string, { episode?: SeriesCardEpisode }>>({});
  const [movieOrder, setMovieOrder] = useState<string[] | null>(null);
  const [runtimes, setRuntimes] = useState<Record<string, number>>({});
  const [now, setNow] = useState(() => Date.now());
  const reset = useCallback(() => { setRetained({}); setMovieOrder(null); setExpandedGroups({}); setGroupLimits({}); setMovieGrid(false); setMovieCount(3); setSeriesOrder(latestSeriesOrder.current); setNow(Date.now()); }, []);
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
  const moviePositions = new Map(movies.map((show, index) => [show.id, index]));
  const sortedMovies = [...movieById.values()].sort((left, right) => {
    const duration = (show: Show) => runtimes[show.id] || movieRuntime(show, tmdb.peekMediaDetails(show.tmdbId, 'movie')) || Infinity;
    return duration(left) - duration(right) || (moviePositions.get(left.id) ?? Infinity) - (moviePositions.get(right.id) ?? Infinity);
  });
  const orderedMovies = movieOrder ? [
    ...movieOrder.flatMap(id => { const show = movieById.get(id); return show ? [show] : []; }),
    ...sortedMovies.filter(show => !movieOrder.includes(show.id)),
  ] : sortedMovies;
  const onRuntime = useCallback((id: string, runtime: number) => setRuntimes(previous => previous[id] === runtime ? previous : { ...previous, [id]: runtime }), []);
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
  const [movieCount, setMovieCount] = useState(3);
  useEffect(() => { if (active) setMovieCount(3); }, [active]);
  useEffect(() => {
    if (!active) return;
    const back = (event: Event) => {
      const group = Object.keys(expandedGroups).find(index => expandedGroups[Number(index)]);
      if (group !== undefined) { event.preventDefault(); setExpandedGroups(previous => ({ ...previous, [Number(group)]: false })); }
      else if (movieGrid || movieCount > 3) { event.preventDefault(); setMovieGrid(false); setMovieCount(3); }
    };
    window.addEventListener('watchlist-back-one-level', back);
    return () => window.removeEventListener('watchlist-back-one-level', back);
  }, [active, expandedGroups, movieGrid, movieCount]);
  const start = now;
  return <section className="watch-next-18c home-watch" aria-label="À regarder">
    {['Continuer à regarder', 'Nouveautés', 'Pas vu depuis un moment'].map((label, index) => {
      const items = series.filter(show => memberships.current.get(show.id) === index);
      if (!items.length) return null;
      const expanded = Boolean(expandedGroups[index]);
      const limit = groupLimits[index] || 12;
      return <section key={label} className="home-series-section" aria-labelledby={`home-section-${index}`}>
        <header className="home-section-heading"><h2 id={`home-section-${index}`}>{label}</h2><button type="button" aria-expanded={expanded} aria-controls={`home-series-${index}`} onClick={() => { setExpandedGroups(previous => ({ ...previous, [index]: !expanded })); setGroupLimits(previous => ({ ...previous, [index]: 12 })); }}>{expanded ? <><ChevronUp size={16} />Revenir en carrousel</> : 'Voir tout'}</button></header>
        <div className={expanded ? 'home-series-list' : 'home-series-rail'} id={`home-series-${index}`}>
          {items.slice(0, expanded ? limit : 3).map(show => {
            const card = <ContinueWatchingCard show={show} layout={expanded ? 'list' : 'rail'} animateSeen showStaleDetail={staleIds.has(show.id)} lastMarkedEpisode={retained[show.id]?.episode} onMarkUnseen={onUnseen} onMarkAsSeen={markSeries} onShowClick={onOpen} onEpisodeClick={onEpisode} actions={actions(show)} />;
            return expanded && index > 0 ? <HomeSwipeCard key={show.id} onArchive={() => actions(show).find(action => action.label.startsWith('Archiver'))?.onSelect()} onRemove={() => actions(show).find(action => action.destructive)?.onSelect()}>{card}</HomeSwipeCard> : <React.Fragment key={show.id}>{card}</React.Fragment>;
          })}
        </div>
        {expanded && items.length > limit && <button type="button" className="watch-next-18c__more-films" onClick={() => setGroupLimits(previous => ({ ...previous, [index]: limit + 12 }))}>Afficher {Math.min(12, items.length - limit)} de plus</button>}
      </section>;
    })}
    {orderedMovies.length > 0 && <>
      <div className="home-section-heading"><h2>Films à voir <span>{movies.length}</span></h2><div className="home-layout-switch" role="group" aria-label="Présentation des films"><button type="button" aria-label="Films en grille" aria-pressed={movieGrid} onClick={() => setMovieGrid(true)}><LayoutGrid size={18} /></button><button type="button" aria-label="Films en liste" aria-pressed={!movieGrid} onClick={() => setMovieGrid(false)}><List size={18} /></button></div></div>
      <div className={movieGrid ? 'movie-ticket-grid' : 'home-movie-list'} id="films-a-voir-18c">
        {orderedMovies.slice(0, movieCount).map(show => <MovieTicketCard key={show.id} show={show} layout={movieGrid ? 'poster' : 'horizontal'} start={start} onOpen={onOpen} onToggle={toggleMovie} onRuntime={onRuntime} />)}
      </div>
      {movieCount < orderedMovies.length && <button type="button" className="watch-next-18c__more-films" onClick={() => setMovieCount(count => count + 3)}>Afficher {Math.min(3, orderedMovies.length - movieCount)} de plus</button>}
    </>}
    {series.length === 0 && orderedMovies.length === 0 && <p className="watch-next-18c__empty">Rien à afficher dans À Regarder pour le moment.</p>}
  </section>;
}
