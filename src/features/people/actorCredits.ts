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
}
const pending = new Map<string, Promise<ActorCredit[]>>();
export async function loadActorCredits(uid: string, id: number): Promise<ActorCredit[]> {
  const field = `home_actor_credits_${id}`;
  const cached = readUserScopedJson<{ at: number; credits: ActorCredit[] } | null>(uid, field, null);
  if (cached && Date.now() - cached.at < 86_400_000 && Array.isArray(cached.credits)) return cached.credits;
  const key = `${uid}:${id}`;
  if (pending.has(key)) return pending.get(key)!;
  const request = (async () => {
    const result = await tmdb.getPersonCredits(id);
    if (!result.ok) throw new Error('Filmographie indisponible');
    const seen = new Set<string>();
    const raw: ActorCredit[] = Array.isArray(result.value?.cast) ? result.value.cast : [];
    const credits = raw.filter(credit => {
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
