import type { Show } from '../../types.ts';

/** #398 : `works` = clés exactes des œuvres où cet acteur est crédité pour ce rôle (jamais déduit du titre). */
export interface CharacterActor { id: number; name: string; photo: string | null; works?: string[] }
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
  let performer = character.actors.find(existing => existing.id === actor.id);
  if (!performer) { performer = { id: actor.id, name: actor.name, photo: actor.photo, works: [] }; character.actors.push(performer); }
  if (!performer.works?.includes(work.key)) performer.works = [...(performer.works || []), work.key];
  const existing = character.works.find(item => item.key === work.key);
  if (!existing) character.works.push({ key: work.key, id: work.id, type: work.type, title: work.title, poster: work.poster, creditCount: role.count, releaseDate: work.releaseDate, runtime: work.runtime, cinema: work.cinema, ...(work.type === 'movie' ? { complete: work.coverageComplete !== false, episodes: [{ key: 'movie', name: work.title, airDate: work.releaseDate || null }] } : {}) });
  else existing.creditCount = null; // Alias counts may overlap; only episode evidence can resolve this.
 }
 for (const character of results.values()) {
  character.works.sort((a,b) => (a.releaseDate || '9999').localeCompare(b.releaseDate || '9999')); character.complete = character.works.every(work => work.complete);
  // #398 : l'interprète le plus crédité d'abord ; ordre d'apparition conservé à égalité.
  character.actors.sort((a, b) => (b.works?.length || 0) - (a.works?.length || 0));
 }
 return [...results.values()];
}
/**
 * Retour terrain du 21/11 : sous-titre d'un personnage dans la recherche. Deux personnages de même nom dans deux
 * univers restent distincts (jamais fusionnés sur un nom) ; sans univers nommé (groupe du catalogue), l'œuvre où il
 * apparaît les distingue, au lieu de deux lignes « Eddie Brock · Tom Hardy » identiques.
 */
export function characterSearchSubtitle(character: Pick<CharacterRecord, 'universe' | 'works' | 'actors'>): string {
 const where = character.universe || character.works[0]?.title || '';
 return [where, character.actors[0]?.name].filter(Boolean).join(' · ');
}
/**
 * Retour terrain du 21/11 : ligne d'un interprète sur la fiche personnage. Un titre seul reste nommé ; au-delà, un
 * décompte (« 8 films », « 2 séries », « 9 œuvres ») remplace la liste complète des titres, qui faisait un gros bloc.
 */
export function performerWorkSummary(actor: CharacterActor, works: readonly CharacterWork[]): string {
 const own = works.filter(work => actor.works?.includes(work.key));
 if (own.length <= 1) return own[0]?.title || '';
 const kind = own.every(work => work.type === 'movie') ? 'films' : own.every(work => work.type === 'tv') ? 'séries' : 'œuvres';
 return own.length + ' ' + kind;
}
/** Libellé du total de la fiche : films seuls, épisodes seuls, ou apparitions quand films et séries se mêlent. */
export function characterTotalLabel(works: readonly Pick<CharacterWork, 'type'>[], complete: boolean): string {
 if (works.length > 0 && works.every(work => work.type === 'movie')) return 'films';
 if (works.some(work => work.type === 'movie')) return complete ? 'apparitions' : 'crédits';
 return complete ? 'épisodes' : 'ép. crédités';
}
/** #398 : œuvres où un interprète joue ce personnage, par clé exacte, dans l'ordre du parcours. */
export const performerWorkTitles = (actor: CharacterActor, works: readonly CharacterWork[]) =>
 works.filter(work => actor.works?.includes(work.key)).map(work => work.title).join(' · ');
export function characterRoleMatches(character: CharacterRecord, work: CharacterMedia, actorId: number, role: string): boolean {
 return character.actors.some(actor => actor.id === actorId) && characterAliases(role).some(alias =>
  characterId(work.universeId, alias) === character.id || character.aliases.some(name => normalizeCharacterName(name) === normalizeCharacterName(alias)));
}
/**
 * #872 — Nom d'univers affiché pour un personnage : seulement une source exacte. Un groupe du catalogue n'a
 * pas de nom propre (son premier membre, « Iron Man » pour le MCU, n'est pas l'univers de Daredevil) :
 * l'univers est alors masqué. Sinon le nom de la collection TMDB, ou à défaut l'œuvre elle-même.
 */
export function characterUniverseLabel(inCatalogGroup: boolean, collectionName: string, ownTitle: string): string {
 if (inCatalogGroup) return '';
 return collectionName || ownTitle;
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
