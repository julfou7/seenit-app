import type { Show } from '../../types.ts';

export interface CharacterActor { id: number; name: string; photo: string | null }
export interface CharacterEpisode { key: string; name: string; airDate: string | null }
export interface CharacterWork {
 key: string; id: number; type: 'tv' | 'movie'; title: string; poster: string | null;
 releaseDate?: string; runtime?: number | null; cinema?: boolean;
 creditCount: number | null; episodes?: CharacterEpisode[]; complete?: boolean;
}
export interface CharacterRecord {
 id: string; name: string; aliases: string[]; universe: string; universeId: string; seed: string;
 actors: CharacterActor[]; works: CharacterWork[];
 neighbors?: Array<{ id: string; name: string; seed: string; count: number; available?: boolean }>;
 complete?: boolean;
}
export interface CharacterCast extends CharacterActor { roles: Array<{ name: string; count: number | null }> }
export interface CharacterMedia {
 key: string; id: number; type: 'tv' | 'movie'; title: string; poster: string | null;
 releaseDate?: string; runtime?: number | null; cinema?: boolean;
 universeId: string; universe: string; cast: CharacterCast[];
 collectionId?: number; coverageComplete?: boolean;
 seasons: Array<{ number: number; episodes: number }>;
}
export const normalizeCharacterName = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export function characterAliases(value: string): string[] {
 return [...new Set(value.split(/\s*\/\s*/).map(name => name.replace(/\s*\((?:voice|uncredited|archive footage)\)\s*/gi, '').trim()).filter(name => name && !/^(self|himself|herself|themselves)(\b|$)/i.test(name)))];
}
function canonicalName(name: string, universeId: string): string {
 const normal = normalizeCharacterName(name);
 // Explicit owner-supplied aliases (4c); never infer a character merely from its actor.
 if (universeId === 'breaking-bad-universe' && ['saul goodman','jimmy mcgill','gene takavic'].includes(normal)) return 'Saul Goodman';
 return name;
}
export function characterId(universeId: string, name: string): string {
 return universeId + ':' + normalizeCharacterName(canonicalName(name, universeId));
}
export function buildCharacters(media: CharacterMedia[]): CharacterRecord[] {
 const results = new Map<string, CharacterRecord>();
 for (const work of media) for (const actor of work.cast) for (const role of actor.roles) {
  const aliases = characterAliases(role.name);
  if (!aliases.length) continue;
  const name = canonicalName(aliases[0], work.universeId);
  const id = characterId(work.universeId, name);
  let character = results.get(id);
  if (!character) {
   character = { id, name, aliases: [], universe: work.universe, universeId: work.universeId, seed: work.key, actors: [], works: [] };
   results.set(id, character);
  }
  for (const alias of aliases) if (!character.aliases.includes(alias)) character.aliases.push(alias);
  if (!character.actors.some(existing => existing.id === actor.id)) character.actors.push({ id: actor.id, name: actor.name, photo: actor.photo });
  const existing = character.works.find(item => item.key === work.key);
  if (!existing) character.works.push({ key: work.key, id: work.id, type: work.type, title: work.title, poster: work.poster, creditCount: role.count, releaseDate: work.releaseDate, runtime: work.runtime, cinema: work.cinema, ...(work.type === 'movie' ? { complete: work.coverageComplete !== false, episodes: [{ key: 'movie', name: work.title, airDate: work.releaseDate || null }] } : {}) });
  else existing.creditCount = null; // Alias counts may overlap; only episode evidence can resolve this.
 }
 for (const character of results.values()) { character.works.sort((a,b) => (a.releaseDate || '9999').localeCompare(b.releaseDate || '9999')); character.complete = character.works.every(work => work.complete); }
 return [...results.values()];
}
export function characterRoleMatches(character: CharacterRecord, work: CharacterMedia, actorId: number, role: string): boolean {
 return character.actors.some(actor => actor.id === actorId) && characterAliases(role).some(alias =>
  characterId(work.universeId, alias) === character.id || character.aliases.some(name => normalizeCharacterName(name) === normalizeCharacterName(alias)));
}
export function characterWorkProgress(work: CharacterWork, shows: readonly Show[]) {
 const show = shows.find(item => item.mediaType === work.type && Number(item.tmdbId) === work.id);
 const episodes = work.episodes || [];
 const watched = new Set(show?.seenEpisodes || []);
 if (work.type === 'movie' && show?.status === 'completed') watched.add('movie');
 const seen = episodes.filter(episode => watched.has(episode.key));
 return { seen: seen.length, total: episodes.length, next: episodes.find(episode => !watched.has(episode.key)) || null, complete: Boolean(work.complete), show };
}
export function characterProgress(character: CharacterRecord, shows: readonly Show[]) {
 const works = character.works.map(work => characterWorkProgress(work, shows));
 const dates = character.works.flatMap(work => (work.episodes || []).map(episode => episode.airDate).filter((date): date is string => Boolean(date))).sort();
 return { seen: works.reduce((sum, work) => sum + work.seen, 0), total: works.reduce((sum, work) => sum + work.total, 0),
  complete: Boolean(character.complete && works.every(work => work.complete)), from: dates[0]?.slice(0,4), to: dates.at(-1)?.slice(0,4) };
}
