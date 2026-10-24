import type { ActorCredit, ActorPerson } from './actorCredits';
import type { Show } from '../../types';

export const actorCreditKey = (credit: ActorCredit) => `${credit.media_type}:${credit.id}`;
export function actorRole(role: string | undefined): string {
  return (role || '').replace(/\s*\(voice\)\s*/gi, ' · voix').trim();
}
export function partitionActorCredits(credits: readonly ActorCredit[], seenKeys: ReadonlySet<string>, shows: readonly Pick<Show, 'mediaType' | 'tmdbId'>[], today: string) {
  const unique = [...new Map(credits.map(credit => [actorCreditKey(credit), credit])).values()];
  const tracked = new Set(shows.map(show => `${show.mediaType}:${show.tmdbId}`));
  const seen = unique.filter(credit => seenKeys.has(actorCreditKey(credit)));
  const future = unique.filter(credit => !seenKeys.has(actorCreditKey(credit)) && (credit.release_date || credit.first_air_date || '') > today)
    .sort((a, b) => (a.release_date || a.first_air_date || '').localeCompare(b.release_date || b.first_air_date || ''));
  const used = new Set([...seen, ...future].map(actorCreditKey));
  const todo = unique.filter(credit => !used.has(actorCreditKey(credit)))
    .sort((a, b) => Number(tracked.has(actorCreditKey(b))) - Number(tracked.has(actorCreditKey(a)))).slice(0, 4);
  todo.forEach(credit => used.add(actorCreditKey(credit)));
  return { seen, future, todo, rest: unique.filter(credit => !used.has(actorCreditKey(credit))), total: unique.length };
}
export function actorAge(person: ActorPerson | null, now = new Date()): number | null {
  if (!person?.birthday) return null;
  const birthday = new Date(`${person.birthday}T12:00:00`), end = person.deathday ? new Date(`${person.deathday}T12:00:00`) : now;
  if (!Number.isFinite(birthday.getTime()) || !Number.isFinite(end.getTime())) return null;
  return end.getFullYear() - birthday.getFullYear() - Number(end.getMonth() < birthday.getMonth() || end.getMonth() === birthday.getMonth() && end.getDate() < birthday.getDate());
}
