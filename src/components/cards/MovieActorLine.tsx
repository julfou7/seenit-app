import type { TicketActor } from '../../features/people/movieActors';
import { actorReason, actorShortName } from '../../features/people/movieActors';

export function ActorAvatar({ actor, className = '' }: { actor: Pick<TicketActor, 'name' | 'profile_path' | 'favorite'> & { seen?: unknown[] }; className?: string }) {
  return <span className={`movie-actor-avatar ${actor.favorite ? 'movie-actor-avatar--favorite' : actor.seen?.length ? 'movie-actor-avatar--known' : ''} ${className}`} aria-hidden="true">
    {actor.name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('')}
    {actor.profile_path && <img src={`https://image.tmdb.org/t/p/w185${actor.profile_path}`} alt="" loading="lazy" onError={event => { event.currentTarget.style.display = 'none'; }} />}
  </span>;
}
export function MovieActorLine({ actor, list = false, onOpen }: { actor: TicketActor | null; list?: boolean; onOpen?: (actor: TicketActor) => void }) {
  const reason = actor && actorReason(actor, list);
  return <div className={`movie-actor-slot${list ? ' movie-actor-slot--list' : ''}`}>
    {actor && <button type="button" className={`movie-actor-line${!actor.favorite && !actor.seen.length ? ' movie-actor-line--neutral' : ''}`} aria-label={`Acteur : ${actor.name}`} onClick={event => { event.stopPropagation(); onOpen?.(actor); }}>
      <ActorAvatar actor={actor} /><span><strong>{actorShortName(actor.name)}</strong>{reason && <small>{reason}</small>}</span>
    </button>}
  </div>;
}
