import './watchListHome.css';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Show } from '../types';
import type { SeriesCardAction } from '../components/cards/SeriesEpisodeCard';
import { ContinueWatchingCard } from '../components/cards/ContinueWatchingCard';
import { MovieTicketCard } from '../components/cards/MovieTicketCard';
import { resolveWatchCardResume } from '../features/watchlist/watchCardResume';
import { type SeriesCardEpisode } from '../features/watchlist/seriesCardPresentation';
import { mergeWatchGroups, orderWatchMovies } from '../features/watchlist/watchNext18c';
import { tmdb } from '../features/shows/tmdb';
import { selectTicketActor, type TicketActor } from '../features/people/movieActors';
import { useCardLayoutAnchor } from '../hooks/useCardLayoutAnchor';
import { useMovieActors } from '../hooks/useMovieActors';
import { useFavoritePeopleStore } from '../store/favoritePeopleStore';
import { MovieActorProfile } from '../components/MovieActorProfile';
import { HOME_PAGE_SIZE } from '../features/watchlist/homePresentation';
import { getTodayStr } from '../lib/utils';
import './watchNext18c.css';
import { HomeSwipeCard } from '../components/cards/HomeSwipeCard';
import { HomeLayoutSwitch } from '../components/cards/HomeLayoutSwitch';
import { HomeLoadMore } from '../components/cards/HomeLoadMore';

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
function useLatestCallback<Args extends unknown[], Result>(callback: (...args: Args) => Result) {
  const latest = useRef(callback);
  useLayoutEffect(() => { latest.current = callback; });
  return useCallback((...args: Args) => latest.current(...args), []);
}

// Keep unchanged cards outside sibling feedback and actor-index renders.
const WatchSeriesItem = React.memo(function WatchSeriesItem({ show, today, layout, stale, receipt, onOpen, onEpisode, onMark, onUnseen, onComplete, actions }: {
  show: Show; today: string; layout: 'list' | 'rail'; stale: boolean; receipt?: SeriesCardEpisode;
  onOpen: Props['onOpen']; onEpisode: Props['onEpisode']; onMark: Props['onMarkSeries'];
  onUnseen: Props['onUnseen']; onComplete: (show: Show, completed: boolean) => void; actions: Props['actions'];
}) {
  return <ContinueWatchingCard show={show} today={today} layout={layout} animateSeen showStaleDetail={stale} lastMarkedEpisode={receipt}
    onMarkUnseen={onUnseen} onMarkAsSeen={onMark} onSeenFeedbackComplete={onComplete} onShowClick={onOpen} onEpisodeClick={onEpisode} actions={actions(show)} />;
});
export function WatchNextSection({ onExplore, onOpenMedia, allShows, groups, movies, active, onOpen, onEpisode, onMarkSeries, onMarkMovie, onUnseen, actions }: Props) {
  const { index: actorIndex, metadata: actorMetadata } = useMovieActors(allShows, active);
  const favorites = useFavoritePeopleStore(state => state.people);
  const [actorSheet, setActorSheet] = useState<{ actor: TicketActor; origin: Show } | null>(null);
  const candidates = mergeWatchGroups(...groups);
  const latestSeriesOrder = useRef(candidates.map(show => show.id));
  latestSeriesOrder.current = candidates.map(show => show.id);
  const preserveLayout = useCardLayoutAnchor();
  const [railLimits, setRailLimits] = useState<Record<number, number>>({});
  const [movieRailLimit, setMovieRailLimit] = useState(HOME_PAGE_SIZE);
  const revealAnchor = useRef<{ rail: string; left: number; top: number } | null>(null);
  const rememberReveal = (id: string) => { const rail = document.getElementById(id); if (rail) { rail.style.scrollSnapType = 'none'; revealAnchor.current = { rail: id, left: rail.scrollLeft, top: window.scrollY }; } };
  useLayoutEffect(() => {
    const anchor = revealAnchor.current;
    if (!anchor) return;
    revealAnchor.current = null;
    const rail = document.getElementById(anchor.rail);
    if (!rail) return;
    const oldTail = parseFloat(rail.style.getPropertyValue('--layout-anchor-tail')) || 0;
    rail.style.setProperty('--layout-anchor-tail', `${Math.max(0, anchor.left - (rail.scrollWidth - rail.clientWidth - oldTail))}px`);
    rail.scrollLeft = anchor.left;
    // Re-snap only on the next deliberate gesture, never while replacing the tile.
    const resumeSnap = () => { rail.style.scrollSnapType = ''; rail.removeEventListener('pointerdown', resumeSnap); rail.removeEventListener('wheel', resumeSnap); };
    rail.addEventListener('pointerdown', resumeSnap, { once: true });
    rail.addEventListener('wheel', resumeSnap, { once: true, passive: true });
  }, [railLimits, movieRailLimit]);
  const [expandedGroups, setExpandedGroups] = useState<Record<number, boolean>>({});
  const [groupLimits, setGroupLimits] = useState<Record<number, number>>({});
  const [movieList, setMovieList] = useState(false);
  const activeRef = useRef(active); activeRef.current = active;
  const mounted = useRef(true);
  const originLocks = useRef(new Map<string, number>());
  const pendingScroll = useRef<string | null>(null);
  const [arrivals, setArrivals] = useState<Set<string>>(() => new Set());
  const memberships = useRef(new Map<string, number>());
  groups.forEach((group, index) => group.forEach(show => { if (!originLocks.current.has(show.id) && !arrivals.has(show.id)) memberships.current.set(show.id, index); }));
  const [seriesOrder, setSeriesOrder] = useState(() => candidates.map(show => show.id));
  const [retained, setRetained] = useState<Record<string, { episode?: SeriesCardEpisode }>>({});
  const [movieOrder, setMovieOrder] = useState<string[] | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const today = getTodayStr();
  const clearTransfers = useCallback(() => { originLocks.current.clear(); pendingScroll.current = null; }, []);
  const reset = useCallback(() => { clearTransfers(); setArrivals(new Set()); setActorSheet(null); setRetained({}); setMovieOrder(null); setExpandedGroups({}); setGroupLimits({}); setRailLimits({}); setMovieRailLimit(HOME_PAGE_SIZE); setMovieList(false); setMovieCount(3); setSeriesOrder(latestSeriesOrder.current); setNow(Date.now()); }, [clearTransfers]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; clearTransfers(); }; }, [clearTransfers]);
  useEffect(() => { if (!active) clearTransfers(); }, [active, clearTransfers]);
  useLayoutEffect(() => {
    if (!pendingScroll.current || !active) return;
    pendingScroll.current = null;
    const rail = document.getElementById('home-series-0');
    if (!rail) return;
    rail.scrollLeft = 0;
    const heading = rail.previousElementSibling as HTMLElement | null;
    if (heading) {
      heading.style.scrollMarginTop = `${(document.querySelector('.home-header')?.getBoundingClientRect().height || 0) + 12}px`;
      heading.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion:reduce)').matches ? 'instant' : 'smooth' });
    }
  }, [arrivals, active]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    const refresh = () => { setNow(Date.now()); };
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('watchlist-reset-all', reset);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', visible); window.removeEventListener('watchlist-reset-all', reset); };
  }, [reset]);
  // Leaving a tab is not an explicit refresh: keep the local watched receipts.
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
    const origin = memberships.current.get(show.id) || 0;
    originLocks.current.set(show.id, origin);
    const restoreReceipt = () => setRetained(previous => {
      const next = { ...previous };
      if (previousReceipt) next[show.id] = previousReceipt;
      else delete next[show.id];
      return next;
    });
    setRetained(previous => ({ ...previous, [show.id]: { episode: resume.episode! } }));
    try {
      const result = await onMarkSeries(show);
      if (result === false) { originLocks.current.delete(show.id); restoreReceipt(); return result; }
      if (origin === 0) originLocks.current.delete(show.id);
      return result;
    }
    catch (error) { originLocks.current.delete(show.id); restoreReceipt(); throw error; }
  };
  const finishSeriesFeedback = (show: Show, completed: boolean) => {
    const origin = originLocks.current.get(show.id);
    originLocks.current.delete(show.id);
    if (!completed || origin === undefined || origin === 0 || !mounted.current || !activeRef.current) return;
    memberships.current.set(show.id, 0);
    pendingScroll.current = show.id;
    setSeriesOrder(previous => [show.id, ...previous.filter(id => id !== show.id)]);
    setArrivals(previous => new Set([...previous, show.id]));
  };
  const seriesHandlers = {
    onOpen: useLatestCallback(onOpen), onEpisode: useLatestCallback(onEpisode),
    onMark: useLatestCallback(markSeries), onUnseen: useLatestCallback(onUnseen),
    onComplete: useLatestCallback(finishSeriesFeedback), actions: useLatestCallback(actions),
  };
  const toggleMovie = async (show: Show) => {
    setMovieOrder(previous => previous || orderedMovies.map(movie => movie.id));
    setRetained(previous => ({ ...previous, [show.id]: {} }));
    try { return show.seenEpisodes.includes('movie') ? await onUnseen(show, null) : await onMarkMovie(show); }
    catch (error) { setRetained(previous => { const next = { ...previous }; delete next[show.id]; return next; }); throw error; }
  };
  const [movieCount, setMovieCount] = useState(3);
  useEffect(() => {
    if (!active) return;
    const back = (event: Event) => {
      const group = Object.keys(expandedGroups).find(index => expandedGroups[Number(index)]);
      if (group !== undefined) { event.preventDefault(); preserveLayout(`home-series-${group}`, 'data-series-id', false, () => { setExpandedGroups(previous => ({ ...previous, [Number(group)]: false })); setRailLimits(previous => ({ ...previous, [Number(group)]: HOME_PAGE_SIZE })); }); }
      else if (movieList) { event.preventDefault(); switchMovies(false); }
      else if (movieCount > 3) { event.preventDefault(); setMovieCount(3); }
    };
    window.addEventListener('watchlist-back-one-level', back);
    return () => window.removeEventListener('watchlist-back-one-level', back);
  }, [active, expandedGroups, movieList, movieCount]);
  const switchMovies = (value: boolean) => {
    if (value === movieList) return;
    preserveLayout('films-a-voir-18c', 'data-movie-ticket', value, first => {
      if (value) setMovieCount(Math.max(3, first + 1));
      else setMovieRailLimit(Math.max(HOME_PAGE_SIZE, first + 1));
      setMovieList(value);
    });
  };
  const start = now;
  const renderSeriesGroup = (index: number) => {
      const label = ['Continuer à regarder', 'Nouveautés', 'Pas vu depuis un moment'][index];
      const items = series.filter(show => memberships.current.get(show.id) === index).sort((a, b) => index === 2 ? Number(Boolean(b.seenEpisodes?.length)) - Number(Boolean(a.seenEpisodes?.length)) : 0);
      if (!items.length) return null;
      const expanded = Boolean(expandedGroups[index]);
      const limit = expanded ? groupLimits[index] || 3 : railLimits[index] || HOME_PAGE_SIZE;
      const switchLayout = (value: boolean) => {
        if (value === expanded) return;
        preserveLayout(`home-series-${index}`, 'data-series-id', value, first => {
          setExpandedGroups(previous => ({ ...previous, [index]: value }));
          if (value) setGroupLimits(previous => ({ ...previous, [index]: Math.max(3, first + 1) }));
          else setRailLimits(previous => ({ ...previous, [index]: Math.max(HOME_PAGE_SIZE, first + 1) }));
        });
      };
      return <section key={label} className="home-series-section" aria-labelledby={`home-section-${index}`}>
        <header className="home-section-heading"><h2 id={`home-section-${index}`}><span className="home-section-name">{label}</span><span className="home-count">{items.length}</span></h2><HomeLayoutSwitch label={label} list={expanded} onChange={switchLayout} /></header>
        {index === 2 && <p className="home-stale-subtitle">En pause ou jamais commencées, depuis plus de 2 mois</p>}
        <div className={expanded ? 'home-series-list' : 'home-series-rail'} id={`home-series-${index}`}>
          {items.slice(0, limit).map(show => {
            const card = <WatchSeriesItem show={show} today={today} layout={expanded ? 'list' : 'rail'} stale={index === 2} receipt={retained[show.id]?.episode} {...seriesHandlers} />;
            return expanded && index > 0 ? <HomeSwipeCard key={show.id} onArchive={() => actions(show).find(action => action.label.startsWith('Archiver'))?.onSelect()} onRemove={() => actions(show).find(action => action.destructive)?.onSelect()}>{card}</HomeSwipeCard> : <div key={show.id} className={arrivals.has(show.id) ? 'home-series-arrival' : undefined}>{card}</div>;
          })}
          {!expanded && <HomeLoadMore tile items={items.slice(limit)} onLoad={() => { rememberReveal(`home-series-${index}`); setRailLimits(previous => ({ ...previous, [index]: limit + HOME_PAGE_SIZE })); }} />}
        </div>
        {expanded && <HomeLoadMore items={items.slice(limit)} onLoad={() => setGroupLimits(previous => ({ ...previous, [index]: limit + HOME_PAGE_SIZE }))} />}
      </section>;
  };
  return <section className="watch-next-18c home-watch" aria-label="À regarder">
    {[0, 1].map(renderSeriesGroup)}
    {orderedMovies.length > 0 && <>
      <div className="home-section-heading"><h2><span className="home-section-name">Films à voir</span><span className="home-count">{movies.length}</span></h2><HomeLayoutSwitch label="Films" list={movieList} onChange={switchMovies} /></div>
      <p className="home-movie-order">Ajouts les plus récents</p>
      <div className={movieList ? 'home-movie-list' : 'movie-ticket-rail'} id="films-a-voir-18c">
        {orderedMovies.slice(0, movieList ? movieCount : movieRailLimit).map(show => <MovieTicketCard key={show.id} show={show} layout={movieList ? 'horizontal' : 'poster'} start={start} onOpen={onOpen} onToggle={toggleMovie} onRuntime={onRuntime} actor={selectTicketActor(actorMetadata.get(`movie:${show.tmdbId}`) || tmdb.peekRenderableMediaDetails(show.tmdbId, 'movie'), favorites, actorIndex)} onActor={actor => setActorSheet({ actor, origin: show })} />)}
        {!movieList && <HomeLoadMore tile items={orderedMovies.slice(movieRailLimit)} onLoad={() => { rememberReveal('films-a-voir-18c'); setMovieRailLimit(count => count + HOME_PAGE_SIZE); }} />}
      </div>
      {movieList && <HomeLoadMore items={orderedMovies.slice(movieCount)} onLoad={() => setMovieCount(count => count + HOME_PAGE_SIZE)} />}
    </>}
    {actorSheet && <MovieActorProfile actor={{ ...actorSheet.actor, seen: actorIndex[actorSheet.actor.id]?.seen || [] }} origin={actorSheet.origin} shows={allShows} onClose={() => setActorSheet(null)} onOpen={(id, type) => { const known = allShows.find(show => show.tmdbId === id && show.mediaType === type); if (known) onOpen(known.id, type); else onOpenMedia?.(id, type); }} />}
    {renderSeriesGroup(2)}
    {series.length === 0 && orderedMovies.length === 0 && <div className="home-empty"><h2>Rien à regarder pour le moment</h2>{onExplore && <button type="button" className="home-explore" onClick={onExplore}>Explorer</button>}</div>}
  </section>;
}
