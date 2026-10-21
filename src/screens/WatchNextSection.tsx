import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Show } from '../types';
import type { SeriesCardAction } from '../components/cards/SeriesEpisodeCard';
import { ContinueWatchingCard } from '../components/cards/ContinueWatchingCard';
import { MovieTicketCard } from '../components/cards/MovieTicketCard';
import { resolveWatchCardResume } from '../features/watchlist/watchCardResume';
import { imageUrl, type SeriesCardEpisode } from '../features/watchlist/seriesCardPresentation';
import { mergeWatchGroups, movieRuntime, selectedMovieStart, seriesMoreLabel } from '../features/watchlist/watchNext18c';
import { tmdb } from '../features/shows/tmdb';
import { getTodayStr } from '../lib/utils';
import './watchNext18c.css';

interface Props {
  allShows: Show[];
  groups: [Show[], Show[], Show[]];
  movies: Show[];
  active: boolean;
  filmsExpanded: boolean;
  filmCount: number;
  onToggleFilms: () => void;
  onMoreFilms: () => void;
  onOpen: (id: string, type?: 'tv' | 'movie') => void;
  onEpisode: (show: Show, season: number, episode: number) => void;
  onMarkSeries: (show: Show) => void | boolean | Promise<void | boolean>;
  onMarkMovie: (show: Show) => void | boolean | Promise<void | boolean>;
  onUnseen: (show: Show, episode: SeriesCardEpisode | null) => Promise<void | boolean>;
  actions: (show: Show) => SeriesCardAction[];
}
export function WatchNextSection({ allShows, groups, movies, active, filmsExpanded, filmCount, onToggleFilms, onMoreFilms, onOpen, onEpisode, onMarkSeries, onMarkMovie, onUnseen, actions }: Props) {
  const candidates = mergeWatchGroups(...groups);
  const latestSeriesOrder = useRef(candidates.map(show => show.id));
  latestSeriesOrder.current = candidates.map(show => show.id);
  const [seriesCount, setSeriesCount] = useState(3);
  const [seriesOrder, setSeriesOrder] = useState(() => candidates.map(show => show.id));
  const [retained, setRetained] = useState<Record<string, { episode?: SeriesCardEpisode }>>({});
  const [movieOrder, setMovieOrder] = useState<string[] | null>(null);
  const [runtimes, setRuntimes] = useState<Record<string, number>>({});
  const [now, setNow] = useState(() => Date.now());
  const [launchTime, setLaunchTime] = useState<string | null>(null);
  const reset = useCallback(() => { setRetained({}); setMovieOrder(null); setSeriesCount(3); setSeriesOrder(latestSeriesOrder.current); setNow(Date.now()); }, []);
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
    setRetained(previous => ({ ...previous, [show.id]: { episode: resume.episode! } }));
    try { return await onMarkSeries(show); }
    catch (error) { setRetained(previous => { const next = { ...previous }; delete next[show.id]; return next; }); throw error; }
  };
  const toggleMovie = async (show: Show) => {
    setMovieOrder(previous => previous || orderedMovies.map(movie => movie.id));
    setRetained(previous => ({ ...previous, [show.id]: {} }));
    try { return show.seenEpisodes.includes('movie') ? await onUnseen(show, null) : await onMarkMovie(show); }
    catch (error) { setRetained(previous => { const next = { ...previous }; delete next[show.id]; return next; }); throw error; }
  };
  const remaining = Math.max(0, series.length - seriesCount);
  const start = selectedMovieStart(now, launchTime);
  const thumbnails = (shows: Show[], fan = false) => <span className={fan ? 'watch-next-18c__fan' : 'watch-next-18c__avatars'} aria-hidden="true">{shows.slice(0, 3).map((show, index) => <span key={show.id} style={fan ? { transform: `rotate(${(index - 1) * 8}deg)` } : undefined}>{show.posterPath && <img src={imageUrl(show.posterPath, 'w185')!} alt="" loading="lazy" onError={event => { event.currentTarget.style.visibility = 'hidden'; }} />}</span>)}</span>;
  return <section className="watch-next-18c" aria-label="À Regarder">
    {series.length > 0 && <>
      <h2>Continuer à regarder <span>{series.length}</span></h2>
      <div className="watch-next-18c__series" id="watch-next-series">
        {series.slice(0, seriesCount).map(show => <ContinueWatchingCard key={show.id} show={show} layout="list" animateSeen showStaleDetail={staleIds.has(show.id)} lastMarkedEpisode={retained[show.id]?.episode} onMarkUnseen={onUnseen} onMarkAsSeen={markSeries} onShowClick={onOpen} onEpisodeClick={onEpisode} actions={actions(show)} />)}
      </div>
      {remaining > 0 && <button type="button" className="watch-next-18c__more" aria-controls="watch-next-series" aria-label={`Afficher ${Math.min(3, remaining)} séries de plus, ${remaining} en attente`} onClick={() => setSeriesCount(count => count + 3)}>{thumbnails(series.slice(seriesCount))}<strong>{seriesMoreLabel(remaining)}</strong><span>{remaining} en attente</span></button>}
      {seriesCount > 3 && <button type="button" className="watch-next-18c__reduce" onClick={() => setSeriesCount(3)}>Réduire ⌃</button>}
    </>}
    {orderedMovies.length > 0 && <>
      <div className="watch-next-18c__movie-heading"><h2>🎬 Films à voir <span>{movies.length}</span></h2><button type="button" onClick={onToggleFilms}>{filmsExpanded ? 'Réduire' : 'Voir tout'}</button></div>
      <div className="watch-next-18c__launch"><span>Je lance à</span>{[null, '20:30', '21:00', '22:30'].map(time => <button key={time || 'now'} type="button" aria-pressed={launchTime === time} onClick={() => { setLaunchTime(time); setNow(Date.now()); }}>{time || 'Maintenant'}</button>)}<label className="sr-only" htmlFor="movie-start-time">Autre heure de lancement</label><input id="movie-start-time" type="time" aria-label="Autre heure de lancement" value={launchTime || ''} onChange={event => { setLaunchTime(event.target.value || null); setNow(Date.now()); }} /></div>
      <div className={filmsExpanded ? 'movie-ticket-grid' : 'movie-ticket-rail'} id="films-a-voir-18c">
        {orderedMovies.slice(0, filmsExpanded ? filmCount : 8).map(show => <MovieTicketCard key={show.id} show={show} start={start} onOpen={onOpen} onToggle={toggleMovie} onRuntime={onRuntime} />)}
        {!filmsExpanded && <button type="button" className="watch-next-18c__all-films" onClick={onToggleFilms}>{thumbnails(orderedMovies, true)}<span>Voir les<br />{movies.length} films</span></button>}
      </div>
      {filmsExpanded && filmCount < orderedMovies.length && <button type="button" className="watch-next-18c__more-films" onClick={onMoreFilms}>Afficher plus de films</button>}
    </>}
    {series.length === 0 && orderedMovies.length === 0 && <p className="watch-next-18c__empty">Rien à afficher dans À Regarder pour le moment.</p>}
  </section>;
}
