import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Bookmark, Heart, Plus } from 'lucide-react';
import { DialogLayer } from './ui/DialogLayer';
import { UpcomingShowCard } from './cards/UpcomingShowCard';
import { useFavoritePeopleStore } from '../store/favoritePeopleStore';
import { useToastStore } from '../store/toastStore';
import { useShows } from '../hooks/useShows';
import { auth } from '../lib/firebase';
import { getTodayStr } from '../lib/utils';
import { tmdb } from '../features/shows/tmdb';
import { cachedActorPerson, loadActorCredits, loadActorPerson, type ActorCredit } from '../features/people/actorCredits';
import { actorAge, actorCreditKey, actorRole, partitionActorCredits } from '../features/people/actorProfile';
import type { TicketActor } from '../features/people/movieActors';
import { historyLastWatchedAt } from '../features/history/historyRecords';
import { movieEndTime, movieRuntime } from '../features/watchlist/watchNext18c';
import { imageUrl } from '../features/watchlist/seriesCardPresentation';
import { getPlexMediaKey, usePlexAvailabilityStore } from '../features/plex/plexAvailability';
import { readWatchProviderCache } from '../features/providers/watchProviderCache';
import { resolvePassiveProviderState } from '../features/providers/passiveProviderState';
import { extractOfficialStreamingProvider, getFormattedProviderLogo } from '../utils/providerLogos';
import type { Show } from '../types';
import './movieActorProfile.css';

interface Props {
  actor: TicketActor; origin: Show; shows: Show[]; onClose: () => void;
  onOpen: (id: number, type: 'tv' | 'movie') => void;
}
function SeenGlyph() { return <svg viewBox="0 0 100 74" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="6" y="4" width="88" height="56" rx="16" /><path d="M36 70H64M33 32 45 44 67 21" /></svg>; }
const fromShow = (show: Show): ActorCredit => ({ id: show.tmdbId, media_type: show.mediaType, title: show.title, poster_path: show.posterPath, backdrop_path: show.backdropPath, release_date: show.firstAirDate });

function Biography({ text }: { text: string }) {
  const paragraph = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false), [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const node = paragraph.current;
    if (!node || expanded) return;
    const measure = () => setOverflows(node.scrollHeight > node.clientHeight + 1);
    measure(); const observer = new ResizeObserver(measure); observer.observe(node);
    return () => observer.disconnect();
  }, [text, expanded]);
  return <section className="actor-profile__bio"><h3>Bio</h3><p ref={paragraph} className={expanded ? '' : 'is-clamped'}>{text}</p>{(expanded || overflows) && <button type="button" onClick={() => setExpanded(value => !value)}>{expanded ? 'Réduire' : 'Lire la suite'}</button>}</section>;
}

export function MovieActorProfile({ actor, origin, shows, onClose, onOpen }: Props) {
  const uid = auth.currentUser?.uid;
  const favorite = useFavoritePeopleStore(state => state.people.some(person => person.id === actor.id));
  const { addShow } = useShows();
  const [person, setPerson] = useState(() => cachedActorPerson(uid, actor.id));
  const [credits, setCredits] = useState<ActorCredit[]>([]);
  const [error, setError] = useState(false), [attempt, setAttempt] = useState(0);
  const [adding, setAdding] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'movie' | 'tv'>('all');
  const [onlyUnseen, setOnlyUnseen] = useState(false), [limit, setLimit] = useState(9);
  const scroll = useRef<HTMLDivElement>(null), live = useRef(true), leaving = useRef(false);
  useEffect(() => {
    let current = true; live.current = true;
    if (uid) {
      const allowed = () => current && auth.currentUser?.uid === uid;
      void loadActorPerson(uid, actor.id).then(value => { if (allowed()) setPerson(value); }).catch(() => { if (allowed()) setError(true); });
      void loadActorCredits(uid, actor.id).then(value => { if (allowed()) { setCredits(value); setError(false); } }).catch(() => { if (allowed()) setError(true); });
    }
    return () => { current = false; live.current = false; };
  }, [actor.id, uid, attempt]);
  const inList = new Map(shows.map(show => [`${show.mediaType}:${show.tmdbId}`, show]));
  const seenKeys = new Set(actor.seen.map(title => `${title.mediaType}:${title.tmdbId}`));
  shows.filter(show => show.mediaType === 'movie' ? show.seenEpisodes.includes('movie') : show.seenEpisodes.length > 0)
    .forEach(show => seenKeys.add(`${show.mediaType}:${show.tmdbId}`));
  const candidates = useMemo(() => {
    const result = new Map(credits.map(credit => [actorCreditKey(credit), credit]));
    if (!result.has(`${origin.mediaType}:${origin.tmdbId}`)) result.set(`${origin.mediaType}:${origin.tmdbId}`, { ...fromShow(origin), character: actor.character });
    for (const title of actor.seen) {
      const key = `${title.mediaType}:${title.tmdbId}`;
      if (!result.has(key)) result.set(key, { id: title.tmdbId, media_type: title.mediaType, title: title.title, character: title.character, poster_path: title.posterPath, backdrop_path: title.backdropPath });
    }
    return [...result.values()];
  }, [credits, origin, actor]);
  const sections = partitionActorCredits(candidates, seenKeys, shows, getTodayStr());
  const seenStats = sections.seen.map(credit => {
    const known = actor.seen.find(title => title.tmdbId === credit.id && title.mediaType === credit.media_type);
    const show = inList.get(actorCreditKey(credit));
    const details = tmdb.peekRenderableMediaDetails(credit.id, credit.media_type);
    const runtime = credit.media_type === 'movie' ? details?.runtime : details?.episode_run_time?.[0];
    const episodes = credit.media_type === 'movie' ? 1 : show?.seenEpisodes.length || known?.episodes || 0;
    const minutes = known?.minutes ?? (Number(runtime) > 0 ? Number(runtime) * episodes : null);
    return { credit, minutes, at: show ? historyLastWatchedAt(show.episodeRecords, show.seenEpisodes) || show.lastWatchedAt || 0 : 0 };
  });
  const knownMinutes = seenStats.length && seenStats.every(title => title.minutes !== null) ? seenStats.reduce((sum, title) => sum + (title.minutes || 0), 0) : null;
  const latest = [...seenStats].sort((a, b) => b.at - a.at)[0];
  const backdrop = sections.seen[0]?.backdrop_path || origin.backdropPath;
  const percent = sections.seen.length ? Math.max(4, Math.round(sections.seen.length / sections.total * 100)) : 0;
  const firstName = actor.name.split(' ')[0];
  const age = actorAge(person);
  const bothTypes = sections.rest.some(credit => credit.media_type === 'movie') && sections.rest.some(credit => credit.media_type === 'tv');
  const grid = sections.rest.filter(credit => (!bothTypes || filter === 'all' || credit.media_type === filter) && (!onlyUnseen || !seenKeys.has(actorCreditKey(credit))));
  const gridHasSeen = sections.rest.some(credit => seenKeys.has(actorCreditKey(credit)));
  const leave = (action: () => void) => {
    if (leaving.current) return;
    leaving.current = true;
    const layer = scroll.current?.closest<HTMLElement>('[data-dialog-layer]');
    if (layer && window.history.state?.seenitDialog === layer.dataset.dialogLayer) {
      window.addEventListener('popstate', () => { onClose(); action(); }, { once: true }); window.history.back();
    } else { onClose(); action(); }
  };
  const navigate = (credit: ActorCredit) => leave(() => onOpen(credit.id, credit.media_type));
  const toggleFavorite = () => {
    if (!uid || auth.currentUser?.uid !== uid) return;
    const store = useFavoritePeopleStore.getState();
    if (favorite) store.removePerson(actor.id);
    else store.addPerson({ id: actor.id, name: actor.name, profile_path: actor.profile_path, known_for_department: person?.known_for_department || 'Acting' });
    useToastStore.getState().showToast(favorite ? 'Acteur retiré des favoris' : 'Acteur ajouté aux favoris', 'info');
  };
  const track = async (credit: ActorCredit): Promise<Show> => {
    if (!uid || auth.currentUser?.uid !== uid) throw new Error('Session changée');
    const existing = inList.get(actorCreditKey(credit));
    if (existing) return existing;
    const date = credit.release_date || credit.first_air_date || '';
    const data: Omit<Show, 'id' | 'userId'> = { tmdbId: credit.id, title: credit.title || credit.name || '', mediaType: credit.media_type, posterPath: credit.poster_path || null, backdropPath: credit.backdrop_path || null,
      firstAirDate: date, status: 'plan_to_watch', seenEpisodes: [], episodeRecords: {}, isArchived: false, createdAt: Date.now(), updatedAt: Date.now(),
      ...(credit.media_type === 'tv' && date > getTodayStr() ? { nextEpisodeToAir: { season_number: 1, episode_number: 1, air_date: date } } : {}) };
    const id = await addShow(data);
    if (!id || auth.currentUser?.uid !== uid) throw new Error('Ajout non confirmé');
    return { ...data, id, userId: uid };
  };
  const add = async (credit: ActorCredit) => {
    if (adding) return;
    setAdding(actorCreditKey(credit));
    try { await track(credit); if (auth.currentUser?.uid === uid) useToastStore.getState().showToast('Ajouté à ta liste', 'info'); }
    catch { if (auth.currentUser?.uid === uid) useToastStore.getState().showToast('Ajout impossible. Réessaie.', 'error'); }
    finally { if (live.current) setAdding(null); }
  };
  const provider = (credit: ActorCredit) => {
    const data = tmdb.peekWatchProviders(credit.id, credit.media_type) || readWatchProviderCache(credit.id, credit.media_type, { allowStale: true })?.data;
    const plex = usePlexAvailabilityStore.getState().cache[getPlexMediaKey(credit.id, credit.media_type, uid)];
    const result = resolvePassiveProviderState(actorCreditKey(credit), extractOfficialStreamingProvider(data?.results), plex);
    const logo = getFormattedProviderLogo(result.logo, result.name);
    return logo ? <img className="actor-profile__provider" src={logo} alt={result.name || 'Diffuseur'} /> : null;
  };
  return <DialogLayer label={`Acteur : ${actor.name}`} onDismiss={onClose} className="actor-profile-overlay">
    <div className="actor-profile" ref={scroll} data-actor-profile>
      <header className="actor-profile__header">
        {backdrop && <img className="actor-profile__backdrop" src={imageUrl(backdrop, 'w780')!} alt="" />}
        <button type="button" className="actor-profile__back" aria-label="Fermer la fiche acteur" data-dialog-initial-focus onClick={onClose}><ArrowLeft size={22} /></button>
        <button type="button" className={`actor-profile__heart${favorite ? ' is-favorite' : ''}`} aria-label={favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'} aria-pressed={favorite} onClick={toggleFavorite}><Heart size={22} fill={favorite ? 'currentColor' : 'none'} /></button>
        <div className="actor-profile__identity"><div className={`actor-profile__portrait${favorite ? ' is-favorite' : ''}`}>{actor.name[0]}{(person?.profile_path || actor.profile_path) && <img src={imageUrl(person?.profile_path || actor.profile_path, 'w300')!} alt="" />}</div>
        <div><h2>{person?.name || actor.name}</h2><p>{[person?.known_for_department === 'Acting' ? 'Acteur' : person?.known_for_department, age !== null ? `${age} ans` : '', person?.place_of_birth].filter(Boolean).join(' · ')}</p></div></div>
      </header>
      <div className="actor-profile__content">
        <section className="actor-profile__link"><div className="actor-profile__ring" style={{ '--actor-progress': `${percent}%` } as React.CSSProperties}><span><b>{sections.seen.length}</b><small>sur {sections.total}</small></span></div><div><h3>Ton lien avec {firstName}</h3><strong>{sections.seen.length ? `${sections.seen.length} titre${sections.seen.length > 1 ? 's' : ''} vu${sections.seen.length > 1 ? 's' : ''}${knownMinutes !== null ? ` · ${Math.round(knownMinutes / 60)} h ensemble` : ''}` : 'Pas encore croisé'}</strong><p>{sections.seen.length ? latest?.at ? `Dernière rencontre : ${latest.credit.title || latest.credit.name} · ${new Date(latest.at).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}` : 'Retrouve tes titres vus ensemble ci-dessous.' : 'Commence par ce qui est dans ta liste.'}</p>{favorite && <p>En favori : ses projets nourrissent tes recommandations et tes alertes.</p>}</div></section>
        {sections.future.length > 0 && <section><h3>Bientôt</h3><div className="actor-profile__upcoming">{sections.future.map(credit => {
          const tracked = inList.get(actorCreditKey(credit));
          const date = credit.release_date || credit.first_air_date || '';
          const show: Show = tracked ? { ...tracked, firstAirDate: date, ...(credit.media_type === 'tv' ? { nextEpisodeToAir: { season_number: 1, episode_number: 1, air_date: date } } : {}) } : { ...origin, id: '', tmdbId: credit.id, mediaType: credit.media_type, title: credit.title || credit.name || '', posterPath: credit.poster_path || null, backdropPath: credit.backdrop_path || null, firstAirDate: date, seenEpisodes: [], episodeRecords: {}, status: 'plan_to_watch', isArchived: false, notificationsEnabled: false, nextEpisodeToWatch: undefined, nextEpisodeToAir: credit.media_type === 'tv' ? { season_number: 1, episode_number: 1, air_date: date } : undefined };
          return <div key={actorCreditKey(credit)} data-actor-credit={actorCreditKey(credit)}><UpcomingShowCard compact show={show} ensureTracked={tracked ? undefined : () => track(credit)} onShowClick={() => navigate(credit)} onEpisodeClick={() => navigate(credit)} /></div>;
        })}</div></section>}
        {sections.todo.length > 0 && <section><h3>À voir avec {firstName}</h3><div className="actor-profile__todo">{sections.todo.map(credit => {
          const show = inList.get(actorCreditKey(credit)), details = tmdb.peekRenderableMediaDetails(credit.id, credit.media_type);
          const end = credit.media_type === 'movie' ? movieEndTime(Date.now(), movieRuntime(show || {} as Show, details)) : null;
          return <div className="actor-profile__todo-row" data-actor-credit={actorCreditKey(credit)} key={actorCreditKey(credit)}><button type="button" className="actor-profile__todo-media" onClick={() => navigate(credit)}>{credit.poster_path && <img src={imageUrl(credit.poster_path)!} alt="" loading="lazy" />}<span><strong>{credit.title || credit.name}</strong><small>{provider(credit)}<span>{[actorRole(credit.character), credit.media_type === 'movie' ? end?.label ? end.label.replace(/^fin /, 'fin à ') : '' : details?.number_of_seasons ? `${details.number_of_seasons} saison${details.number_of_seasons > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ')}</span></small></span></button>{show ? <span className="actor-profile__bookmark" aria-label="Dans ta liste"><Bookmark size={20} fill="currentColor" /></span> : <button type="button" className="actor-profile__add" disabled={adding !== null} onClick={() => void add(credit)}><Plus size={15} />{adding === actorCreditKey(credit) ? 'Ajout…' : 'À voir'}</button>}</div>;
        })}</div></section>}
        {sections.seen.length > 0 && <section><h3>Vus ensemble</h3><div className="actor-profile__seen">{sections.seen.map(credit => <button data-actor-credit={actorCreditKey(credit)} key={actorCreditKey(credit)} type="button" onClick={() => navigate(credit)}><span className="actor-profile__seen-poster">{credit.poster_path && <img src={imageUrl(credit.poster_path)!} alt="" loading="lazy" />}<SeenGlyph /></span><strong>{credit.title || credit.name}</strong><small>{actorRole(credit.character)}</small></button>)}</div></section>}
        {sections.rest.length > 0 && <section className="actor-profile__filmography"><h3>Sa filmographie</h3>{bothTypes && <div className="actor-profile__tabs" aria-label="Type de filmographie">{(['all', 'movie', 'tv'] as const).map(type => <button key={type} type="button" aria-pressed={filter === type} onClick={() => { setFilter(type); setLimit(9); }}>{type === 'all' ? 'Tout' : type === 'movie' ? 'Films' : 'Séries'}</button>)}</div>}{gridHasSeen && <label><input type="checkbox" checked={onlyUnseen} onChange={event => { setOnlyUnseen(event.target.checked); setLimit(9); }} /> Non vus</label>}<div className="actor-profile__grid">{grid.slice(0, limit).map(credit => <button data-actor-credit={actorCreditKey(credit)} key={actorCreditKey(credit)} type="button" onClick={() => navigate(credit)}><span>{credit.poster_path && <img src={imageUrl(credit.poster_path)!} alt="" loading="lazy" />}{seenKeys.has(actorCreditKey(credit)) ? <SeenGlyph /> : inList.has(actorCreditKey(credit)) ? <Bookmark size={18} /> : null}</span><strong>{credit.title || credit.name}</strong><small>{actorRole(credit.character)}</small><small>{(credit.release_date || credit.first_air_date || '').slice(0, 4)}</small></button>)}</div>{grid.length > limit && <button type="button" className="actor-profile__more" onClick={() => setLimit(value => value + 9)}>Afficher {Math.min(9, grid.length - limit)} de plus</button>}</section>}
        {error && <p className="actor-profile__error">Certains détails sont indisponibles. <button type="button" onClick={() => { setError(false); setAttempt(value => value + 1); }}>Réessayer</button></p>}
        {person?.biography && <Biography text={person.biography} />}
      </div>
    </div>
  </DialogLayer>;
}
