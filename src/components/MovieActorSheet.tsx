import { useEffect, useRef, useState } from 'react';
import { Bookmark, Check, Heart, Plus, X, ChevronRight } from 'lucide-react';
import { DialogLayer } from './ui/DialogLayer';
import { ActorAvatar } from './cards/MovieActorLine';
import { useFavoritePeopleStore } from '../store/favoritePeopleStore';
import { useToastStore } from '../store/toastStore';
import { useShows } from '../hooks/useShows';
import { auth } from '../lib/firebase';
import { tmdb } from '../features/shows/tmdb';
import { loadActorCredits, type ActorCredit } from '../features/people/actorCredits';
import type { TicketActor } from '../features/people/movieActors';
import { movieEndTime, movieRuntime } from '../features/watchlist/watchNext18c';
import { getPlexMediaKey, usePlexAvailabilityStore } from '../features/plex/plexAvailability';
import { readWatchProviderCache } from '../features/providers/watchProviderCache';
import { resolvePassiveProviderState } from '../features/providers/passiveProviderState';
import { extractOfficialStreamingProvider, getFormattedProviderLogo } from '../utils/providerLogos';
import './movieActorSheet.css';
import type { Show } from '../types';

interface Props {
  actor: TicketActor; origin: Show; shows: Show[]; onClose: () => void;
  onOpen: (id: number, type: 'tv' | 'movie') => void; onPerson: (id: number) => void;
}
const image = (path: string | null | undefined, size = 'w185') => path ? (/^https?:|^data:/.test(path) ? path : `https://image.tmdb.org/t/p/${size}${path}`) : undefined;
export function MovieActorSheet({ actor, origin, shows, onClose, onOpen, onPerson }: Props) {
  const uid = auth.currentUser?.uid;
  const favorite = useFavoritePeopleStore(state => state.people.some(person => person.id === actor.id));
  const { addShow } = useShows();
  const [credits, setCredits] = useState<ActorCredit[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [adding, setAdding] = useState<number | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const live = useRef(true);
  const leaving = useRef(false);
  useEffect(() => {
    let current = true; live.current = true;
    if (uid) void loadActorCredits(uid, actor.id).then(value => { if (current && auth.currentUser?.uid === uid) { setCredits(value); setError(false); } }).catch(() => { if (current) setError(true); });
    return () => { current = false; live.current = false; };
  }, [actor.id, uid, attempt]);
  const seen = [...actor.seen].sort((a, b) => (b.minutes || 0) - (a.minutes || 0) || b.episodes - a.episodes);
  const knownHours = seen.length > 0 && seen.every(title => title.minutes !== null) ? Math.round(seen.reduce((sum, title) => sum + (title.minutes || 0), 0) / 60) : null;
  const backdrop = seen[0]?.backdropPath || origin.backdropPath;
  const inList = new Map(shows.map(show => [`${show.mediaType}:${show.tmdbId}`, show]));
  const seenIds = new Set(seen.map(title => `${title.mediaType}:${title.tmdbId}`));
  const originCredit: ActorCredit = { id: origin.tmdbId, media_type: 'movie', title: origin.title, poster_path: origin.posterPath, backdrop_path: origin.backdropPath, character: actor.character };
  const candidates = new Map((credits || []).map(credit => [`${credit.media_type}:${credit.id}`, credit]));
  candidates.set(`movie:${origin.tmdbId}`, originCredit);
  const cachedProvider = (credit: ActorCredit) => {
    const data = tmdb.peekWatchProviders(credit.id, credit.media_type) || readWatchProviderCache(credit.id, credit.media_type, { allowStale: true })?.data;
    const plex = usePlexAvailabilityStore.getState().cache[getPlexMediaKey(credit.id, credit.media_type, uid)];
    return resolvePassiveProviderState(`${credit.media_type}:${credit.id}`, extractOfficialStreamingProvider(data?.results), plex);
  };
  const availability = (credit: ActorCredit) => Boolean(cachedProvider(credit).logo);
  const todo = [...candidates.values()].filter(credit => {
    const key = `${credit.media_type}:${credit.id}`, show = inList.get(key);
    return !seenIds.has(key) && !(show?.seenEpisodes.length);
  }).sort((a, b) => Number(inList.has(`${b.media_type}:${b.id}`)) - Number(inList.has(`${a.media_type}:${a.id}`)) || Number(availability(b)) - Number(availability(a)) || a.id - b.id).slice(0, 3);
  const leave = (action: () => void) => {
    if (leaving.current) return;
    leaving.current = true;
    // Consume this sheet's own history entry before pushing a media/person route.
    const layer = scroll.current?.closest<HTMLElement>('[data-dialog-layer]');
    if (layer && window.history.state?.seenitDialog === layer.dataset.dialogLayer) {
      window.addEventListener('popstate', () => { onClose(); action(); }, { once: true });
      window.history.back();
    } else { onClose(); action(); }
  };
  const navigate = (id: number, type: 'tv' | 'movie') => leave(() => onOpen(id, type));
  const toggleFavorite = () => {
    if (!uid || auth.currentUser?.uid !== uid) return;
    const store = useFavoritePeopleStore.getState();
    if (favorite) store.removePerson(actor.id);
    else store.addPerson({ id: actor.id, name: actor.name, profile_path: actor.profile_path, known_for_department: 'Acting' });
    useToastStore.getState().showToast(favorite ? 'Acteur retiré des favoris' : 'Acteur ajouté aux favoris', 'info');
  };
  const add = async (credit: ActorCredit) => {
    if (!uid || auth.currentUser?.uid !== uid || adding !== null) return;
    setAdding(credit.id);
    try {
      await addShow({ tmdbId: credit.id, title: credit.title || credit.name || '', mediaType: credit.media_type, posterPath: credit.poster_path || null, backdropPath: credit.backdrop_path || null,
        firstAirDate: credit.release_date || credit.first_air_date || '', status: 'plan_to_watch', seenEpisodes: [], episodeRecords: {}, isArchived: false, createdAt: Date.now(), updatedAt: Date.now() });
      if (auth.currentUser?.uid === uid) useToastStore.getState().showToast('Ajouté à ta liste', 'info');
    } catch { if (auth.currentUser?.uid === uid) useToastStore.getState().showToast('Ajout impossible. Réessaie.', 'error'); }
    finally { if (live.current) setAdding(null); }
  };
  return <DialogLayer label={`Acteur : ${actor.name}`} onDismiss={onClose} className="movie-actor-overlay" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="movie-actor-sheet" ref={scroll} onTouchStart={event => { touch.current = scroll.current?.scrollTop === 0 ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null; }} onTouchEnd={event => {
      const start = touch.current; touch.current = null;
      if (start && event.changedTouches[0].clientY - start.y > 90 && Math.abs(event.changedTouches[0].clientX - start.x) < 60) onClose();
    }} onTouchCancel={() => { touch.current = null; }}>
      <div className="movie-actor-sheet__handle" aria-hidden="true" />
      <button type="button" className="movie-actor-sheet__close" aria-label="Fermer la fiche acteur" onClick={onClose}><X size={20} /></button>
      <header className="movie-actor-sheet__banner">
        {backdrop && <img className="movie-actor-sheet__backdrop" src={image(backdrop, 'w780')} alt="" />}
        <button type="button" className="movie-actor-sheet__heart" aria-label={favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'} aria-pressed={favorite} onClick={toggleFavorite}><Heart size={22} fill={favorite ? 'currentColor' : 'none'} /></button>
        <div className="movie-actor-sheet__identity"><ActorAvatar actor={{ ...actor, favorite }} /><div><h2>{actor.name}</h2><p>{actor.character && <span>{actor.character} </span>}dans {origin.title}</p></div></div>
      </header>
      <div className="movie-actor-sheet__chips"><span className={seen.length ? 'is-gold' : ''}>{seen.length ? `${seen.length} titre${seen.length > 1 ? 's' : ''} vu${seen.length > 1 ? 's' : ''}` : 'Nouveau pour toi'}</span>{knownHours !== null && <span className="is-gold">{knownHours} h ensemble</span>}{credits && <span>{credits.length} films et séries</span>}</div>
      {favorite && <p className="movie-actor-sheet__explanation">Favori : il nourrit tes recos et ses nouveaux projets te sont signalés.</p>}
      {seen.length ? <section><h3>Où tu l’as vu</h3><div className="movie-actor-sheet__seen">{seen.map(title => <button type="button" key={`${title.mediaType}:${title.tmdbId}`} onClick={() => navigate(title.tmdbId, title.mediaType)}><span>{title.posterPath && <img src={image(title.posterPath)} alt="" />}<Check size={20} /></span><strong>{title.title}</strong><small>{[title.character, title.mediaType === 'tv' ? `${title.episodes} ép.` : title.minutes ? `${Math.floor(title.minutes / 60)}h${String(title.minutes % 60).padStart(2, '0')}` : ''].filter(Boolean).join(' · ')}</small></button>)}</div></section> : <p className="movie-actor-sheet__explanation">Pas encore croisé dans ce que tu as vu. Commence par ici :</p>}
      <section><h3>Avec lui, à voir</h3><div className="movie-actor-sheet__todo">{todo.map(credit => {
        const show = inList.get(`${credit.media_type}:${credit.id}`);
        const details = tmdb.peekRenderableMediaDetails(credit.id, credit.media_type);
        const end = credit.media_type === 'movie' ? movieEndTime(Date.now(), movieRuntime(show || {} as Show, details)) : null;
        const provider = cachedProvider(credit);
        const logo = getFormattedProviderLogo(provider?.logo, provider?.name);
        const meta = credit.media_type === 'movie' ? end?.label : details?.number_of_seasons ? `${details.number_of_seasons} saisons` : '';
        return <div key={`${credit.media_type}:${credit.id}`}><button type="button" className="movie-actor-sheet__title" onClick={() => navigate(credit.id, credit.media_type)}>{credit.poster_path && <img src={image(credit.poster_path)} alt="" />}<span><strong>{credit.title || credit.name}</strong><small>{logo && <img src={logo} alt={provider?.name || 'Diffuseur'} />}{[credit.id === origin.tmdbId && credit.media_type === 'movie' ? 'Dans ta liste' : credit.character, meta].filter(Boolean).join(' · ')}</small></span></button>{show ? <span className="movie-actor-sheet__bookmark" aria-label="Dans ta liste"><Bookmark size={20} fill="currentColor" /></span> : <button type="button" className="movie-actor-sheet__add" disabled={adding !== null} onClick={() => void add(credit)}><Plus size={16} />{adding === credit.id ? 'Ajout…' : 'À voir'}</button>}</div>;
      })}</div></section>
      {error && <p className="movie-actor-sheet__explanation">Filmographie indisponible. <button type="button" onClick={() => { setError(false); setAttempt(value => value + 1); }}>Réessayer</button></p>}
      <button type="button" className="movie-actor-sheet__filmography" onClick={() => leave(() => onPerson(actor.id))}><span><strong>Sa filmographie</strong><small>{credits ? `${seen.length} / ${credits.length} vus` : 'Voir sa fiche complète'}</small><span className="movie-actor-sheet__progress"><i style={{ width: `${credits?.length ? Math.min(100, seen.length / credits.length * 100) : 0}%` }} /></span></span><ChevronRight size={20} /></button>
    </div>
  </DialogLayer>;
}
