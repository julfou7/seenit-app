import { tmdb } from '../shows/tmdb';
import { readUserScopedJson, writeUserScopedJson } from '../../lib/userIsolation';

export interface ActorCredit {
  id: number;
  media_type: 'tv' | 'movie';
  title?: string;
  name?: string;
  character?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  popularity?: number;
}
const pending = new Map<string, Promise<ActorCredit[]>>();
export async function loadActorCredits(uid: string, id: number): Promise<ActorCredit[]> {
  const field = `home_actor_credits_v4_fr_${id}`;
  const cached = readUserScopedJson<{ at: number; credits: ActorCredit[] } | null>(uid, field, null);
  if (cached && Date.now() - cached.at < 86_400_000 && Array.isArray(cached.credits)) return cached.credits;
  const key = `${uid}:${id}`;
  if (pending.has(key)) return pending.get(key)!;
  const request = (async () => {
    const result = await tmdb.getPersonCredits(id);
    if (!result.ok) throw new Error('Filmographie indisponible');
    const seen = new Set<string>();
    const raw: ActorCredit[] = Array.isArray(result.value?.cast) ? result.value.cast : [];
    const credits = [...raw].sort((a, b) => (b.popularity || 0) - (a.popularity || 0)).filter(credit => {
      const identity = `${credit.media_type}:${credit.id}`;
      if (!Number.isInteger(credit.id) || credit.id <= 0 || !['tv', 'movie'].includes(credit.media_type) || seen.has(identity)) return false;
      seen.add(identity); return true;
    });
    writeUserScopedJson(uid, field, { at: Date.now(), credits });
    return credits;
  })();
  pending.set(key, request);
  try { return await request; } finally { pending.delete(key); }
}

export interface ActorPerson { name?: string; profile_path?: string | null; birthday?: string | null; deathday?: string | null; place_of_birth?: string | null; known_for_department?: string; biography?: string }
const pendingPeople = new Map<string, Promise<ActorPerson>>();
export function cachedActorPerson(uid: string | undefined, id: number): ActorPerson | null {
  const cached = readUserScopedJson<{ at: number; person: ActorPerson } | null>(uid, `home_actor_person_fr_${id}`, null);
  return cached && Date.now() - cached.at < 86_400_000 ? cached.person : null;
}
export async function loadActorPerson(uid: string, id: number): Promise<ActorPerson> {
  const cached = cachedActorPerson(uid, id);
  if (cached) return cached;
  const key = `${uid}:${id}`;
  if (pendingPeople.has(key)) return pendingPeople.get(key)!;
  const request = (async () => {
    const result = await tmdb.getPersonDetails(id);
    if (!result.ok) throw new Error('Biographie indisponible');
    const person: ActorPerson = result.value;
    writeUserScopedJson(uid, `home_actor_person_fr_${id}`, { at: Date.now(), person });
    return person;
  })();
  pendingPeople.set(key, request);
  try { return await request; } finally { pendingPeople.delete(key); }
}
