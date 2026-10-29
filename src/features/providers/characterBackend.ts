import type { Application, Request, RequestHandler } from 'express';
import { hasFrenchTheatricalCinemaEvidence } from '../shows/cinemaPolicy.ts';
import { getManifestGroupsForMedia, type MediaKey } from '../shows/mediaRelations.ts';
import { buildCharacters, characterId, characterRoleMatches, normalizeCharacterName, type CharacterCast, type CharacterMedia, type CharacterRecord } from '../discover/characters.ts';

interface Dependencies { authenticate: RequestHandler; fetch?: typeof fetch; secrets?: () => { TMDB_API_KEY?: string }; now?: () => number }
type Json = Record<string, unknown>;
const record = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
const array = (value: unknown): Json[] => Array.isArray(value) ? value.map(record) : [];
const text = (value: unknown) => typeof value === 'string' ? value.slice(0, 240) : '';
const positive = (value: unknown) => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const KEY = /^(tv|movie):([1-9]\d{0,9})$/;
export const CHARACTER_CACHE_TTL = 24 * 60 * 60_000;
export const CHARACTER_BATCH_MAX = 16;
export const CHARACTER_EPISODE_MAX = 240;
export const CHARACTER_UPSTREAM_CONCURRENCY = 4;

async function boundedJson(response: Response): Promise<Json> {
 if (!response.ok || !response.body) throw Error('SOURCE_UNAVAILABLE');
 const reader = response.body.getReader(), chunks: Uint8Array[] = [];
 let size = 0;
 try {
  for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 2 * 1024 * 1024) throw Error('SOURCE_TOO_LARGE'); chunks.push(value); }
 } catch (error) { await reader.cancel().catch(() => {}); throw error; } finally { reader.releaseLock(); }
 const bytes = new Uint8Array(size); let offset = 0;
 for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
 return record(JSON.parse(new TextDecoder().decode(bytes)));
}

function compactMedia(key: string, data: Json): CharacterMedia {
 const [type, rawId] = key.split(':') as ['tv' | 'movie', string];
 const groups = getManifestGroupsForMedia(key as MediaKey);
 const collection = record(data.belongs_to_collection);
 const group = groups.find(item => item.relationKind === 'universe') || groups[0];
 const castSource = type === 'tv' ? record(data.aggregate_credits).cast : record(data.credits).cast;
 const cast: CharacterCast[] = array(castSource).slice(0, 200).flatMap(actor => {
  const id = positive(actor.id);
  if (!id || !text(actor.name)) return [];
  const roles = type === 'tv' ? array(actor.roles).slice(0,24).map(role => ({ name: text(role.character), count: positive(role.episode_count) })) : [{ name: text(actor.character), count: 1 }];
  return [{ id, name: text(actor.name), photo: text(actor.profile_path) || null, roles: roles.filter(role => role.name) }];
 });
 return { key, id: Number(rawId), type, title: text(data.name || data.title), poster: text(data.poster_path) || null,
  releaseDate: text(data.release_date || data.first_air_date), runtime: positive(data.runtime), cinema: type === 'movie' && hasFrenchTheatricalCinemaEvidence(data),
  universeId: group?.groupId || (positive(collection.id) ? 'collection:' + collection.id : key), universe: group?.members[0]?.label || text(collection.name) || text(data.name || data.title), cast, collectionId: positive(collection.id) || undefined,
  coverageComplete: Array.isArray(castSource) && array(castSource).length <= 200 && array(castSource).every(actor => array(actor.roles).length <= 24) && array(data.seasons).length <= 40,
  seasons: array(data.seasons).filter(season => Number.isInteger(Number(season.season_number)) && Number(season.season_number) >= 0 && positive(season.episode_count)).map(season => ({ number: Number(season.season_number), episodes: Number(season.episode_count) })).slice(0, 40) };
}

/** Public evidence only. User watch state never enters these shared caches. */
export function registerCharacterRoutes(app: Application, dependencies: Dependencies) {
 const request = dependencies.fetch || fetch, now = dependencies.now || Date.now;
 const cache = new Map<string, { data: Json; expires: number; bytes: number }>();
 const detailed = new Map<string, { data: CharacterRecord; expires: number }>();
 const inFlight = new Map<string, Promise<Json>>();
 const detailsInFlight = new Map<string, Promise<CharacterRecord>>();
 const quotas = new Map<string, { count: number; until: number }>();
 let active = 0, cacheBytes = 0, secret = '';
 const queue: Array<() => void> = [];
 const limited = async <T>(action: () => Promise<T>): Promise<T> => {
  if (active >= CHARACTER_UPSTREAM_CONCURRENCY) await new Promise<void>(resolve => queue.push(resolve));
  else active++;
  try { return await action(); } finally { const next = queue.shift(); if (next) next(); else active--; }
 };
 const take = (uid: string, amount = 1) => {
  const time = now();
  for (const [key, quota] of quotas) if (quota.until <= time) quotas.delete(key);
  if (quotas.size >= 2000 && !quotas.has(uid)) return false;
  const quota = quotas.get(uid) || { count: 0, until: time + 60_000 };
  if (quota.count + amount > 360) return false;
  quota.count += amount; quotas.set(uid, quota); return true;
 };
 const load = async (path: string, uid: string): Promise<Json> => {
  const apiKey = dependencies.secrets?.().TMDB_API_KEY ?? process.env.TMDB_API_KEY;
  if (!apiKey) throw Error('SOURCE_UNAVAILABLE');
  if (apiKey !== secret) { cache.clear(); detailed.clear(); inFlight.clear(); cacheBytes = 0; secret = apiKey; }
  const cached = cache.get(path);
  if (cached && cached.expires > now()) { cache.delete(path); cache.set(path, cached); return cached.data; }
  const running = inFlight.get(path); if (running) return running;
  if (inFlight.size >= 256) throw Error('SOURCE_BUSY');
  if (!take('upstream:' + uid)) throw Error('RATE_LIMIT');
  const pending = limited(async () => {
   const url = new URL('https://api.themoviedb.org/3/' + path);
   url.searchParams.set('api_key', apiKey); url.searchParams.set('language', 'fr-FR');
   const data = await boundedJson(await request(url, { signal: AbortSignal.timeout(10_000) }));
   if (data.status_code || data.success === false) throw Error('INVALID_SOURCE');
   const serialized = JSON.stringify(data);
   if (serialized.includes(apiKey)) throw Error('INVALID_SOURCE');
   const old = cache.get(path); if (old) cacheBytes -= old.bytes;
   cache.set(path, { data, expires: now() + CHARACTER_CACHE_TTL, bytes: serialized.length * 2 }); cacheBytes += serialized.length * 2;
   while (cache.size > 256 || cacheBytes > 16 * 1024 * 1024) { const key = cache.keys().next().value; if (!key) break; cacheBytes -= cache.get(key)!.bytes; cache.delete(key); }
   return data;
  });
  inFlight.set(path, pending);
  try { return await pending; } finally { if (inFlight.get(path) === pending) inFlight.delete(path); }
 };
 const media = async (key: string, uid: string) => {
  const [type, id] = key.split(':');
  const data = await load(type + '/' + id + '?append_to_response=' + (type === 'tv' ? 'aggregate_credits' : 'credits,release_dates'), uid);
  return compactMedia(key, data);
 };
 const universeMedia = async (seeds: string[], uid: string) => {
  const keys = new Set(seeds);
  let truncated = false;
  for (const seed of seeds) {
   const groups = getManifestGroupsForMedia(seed as MediaKey);
   const group = groups.find(item => item.relationKind === 'universe') || groups[0];
   for (const member of group?.members || []) { if (keys.size < 48) keys.add(member.mediaKey); else if (!keys.has(member.mediaKey)) truncated = true; }
  }
  const values = await Promise.allSettled([...keys].map(key => media(key, uid)));
  const items = values.flatMap(value => value.status === 'fulfilled' ? [value.value] : []);
  let complete = !truncated && values.every(value => value.status === 'fulfilled');
  for (const collectionId of new Set(items.map(item => item.collectionId).filter(Boolean))) {
   try {
    const collection = await load('collection/' + collectionId, uid);
    const parts = array(collection.parts).filter(part => positive(part.id));
    if (!parts.some(part => seeds.includes('movie:' + Number(part.id)))) continue;
    for (const part of parts) {
     const key = 'movie:' + Number(part.id);
     if (keys.has(key)) continue;
     if (keys.size >= 48) { complete = false; break; }
     keys.add(key);
     try { items.push(await media(key, uid)); } catch { complete = false; }
    }
   } catch { complete = false; }
  }
  return { media: items, complete };
 };
 const detail = async (character: CharacterRecord, source: CharacterMedia[], uid: string, sourceComplete: boolean): Promise<CharacterRecord> => {
  const cacheKey = character.id + '|' + source.map(item => item.key + ':' + JSON.stringify(item.seasons)).sort().join(',');
  const cached = sourceComplete ? detailed.get(cacheKey) : undefined; if (cached && cached.expires > now()) return cached.data;
  const running = detailsInFlight.get(cacheKey); if (running) return running;
  const pending = (async () => {
   const result: CharacterRecord = { ...character, works: character.works.map(work => ({ ...work, episodes: work.type === 'movie' ? work.episodes || [] : [], complete: work.type === 'movie' ? work.complete : true })), neighbors: [], complete: true };
   const crossed = new Map<string, { id: string; name: string; seed: string; count: number }>();
   let remaining = CHARACTER_EPISODE_MAX;
   const deadline = now() + 40_000;
   for (const work of result.works) {
    const original = source.find(item => item.key === work.key)!;
    const consume = (payload: Json, episodeKey: string, fallbackName = '') => {
     const credits = [...array(record(payload.credits).cast), ...array(payload.guest_stars)];
     if (!credits.some(actor => characterRoleMatches(character, original, Number(actor.id), text(actor.character)))) return;
     work.episodes!.push({ key: episodeKey, name: text(payload.name) || fallbackName, airDate: text(payload.air_date || payload.release_date) || null });
     const episodeNeighbors = new Set<string>();
     for (const actor of credits) {
      const name = text(actor.character).split('/')[0].trim();
      if (!name || /^(self|himself|herself)\b/i.test(name)) continue;
      const id = characterId(character.universeId, name);
      if (id === character.id || episodeNeighbors.has(id)) continue;
      episodeNeighbors.add(id);
      const current = crossed.get(id) || { id, name, seed: work.key, count: 0 };
      current.count++; crossed.set(id, current);
     }
    };
    if (work.type === 'movie') continue;
    if (!original.seasons.length || original.coverageComplete === false) work.complete = false;
    for (const season of original.seasons) {
     if (remaining <= 0 || now() > deadline) { work.complete = false; continue; }
     let episodes: Json[];
     try {
      const seasonPayload = await load('tv/' + work.id + '/season/' + season.number, uid);
      if (!Array.isArray(seasonPayload.episodes)) work.complete = false;
      const sourceEpisodes = array(seasonPayload.episodes);
      if (sourceEpisodes.length < season.episodes) work.complete = false;
      if (sourceEpisodes.some(episode => positive(episode.episode_number) && !text(episode.air_date))) work.complete = false;
      episodes = sourceEpisodes.filter(episode => positive(episode.episode_number) && text(episode.air_date) && text(episode.air_date) <= new Date(now()).toISOString().slice(0,10));
     }
     catch { work.complete = false; continue; }
     if (episodes.length > remaining) work.complete = false;
     const batch = episodes.slice(0, remaining); remaining -= batch.length;
     let cursor = 0;
     await Promise.all(Array.from({ length: Math.min(4, batch.length) }, async () => {
      while (cursor < batch.length) {
       const episode = batch[cursor++];
       if (now() > deadline) { work.complete = false; continue; }
       try {
        const payload = await load('tv/' + work.id + '/season/' + season.number + '/episode/' + Number(episode.episode_number) + '?append_to_response=credits', uid);
        if (!Array.isArray(record(payload.credits).cast)) { work.complete = false; continue; }
        consume(payload, season.number + 'x' + Number(episode.episode_number));
       } catch { work.complete = false; }
      }
     }));
    }
    work.episodes!.sort((left,right) => { const a=left.key.split('x').map(Number),b=right.key.split('x').map(Number);return a[0]-b[0]||a[1]-b[1]; });
   }
   result.complete = result.works.every(work => work.complete);
   const available = new Set(buildCharacters(source).map(item => item.id));
   result.neighbors = [...crossed.values()].map(item => ({ ...item, available: available.has(item.id) })).sort((left,right) => right.count-left.count).slice(0,4);
   if (result.complete && sourceComplete) { detailed.set(cacheKey, { data: result, expires: now()+CHARACTER_CACHE_TTL }); while(detailed.size>64)detailed.delete(detailed.keys().next().value!); }
   return result;
  })();
  detailsInFlight.set(cacheKey,pending);
  try { return await pending; } finally { if(detailsInFlight.get(cacheKey)===pending)detailsInFlight.delete(cacheKey); }
 };
 const authenticated: RequestHandler = (req, res, next) => {
  res.setHeader('Cache-Control','no-store');
  const uid=(req as Request & { user?: { uid?: string } }).user?.uid;
  if(!uid){res.status(401).json({error:'Authentification requise.'});return;}
  if(!take('requests:'+uid,4)){res.setHeader('Retry-After','60');res.status(429).json({error:'Réessaie dans une minute.'});return;}
  next();
 };
 app.get('/api/media/characters', dependencies.authenticate, authenticated, async (req,res) => {
  const raw=typeof req.query.ids==='string'?req.query.ids:'', query=typeof req.query.q==='string'?req.query.q:'';
  const seeds=[...new Set(raw.split(','))];
  if(raw.length>400||!seeds.length||seeds.length>CHARACTER_BATCH_MAX||seeds.some(key=>!KEY.test(key))||normalizeCharacterName(query).length<2||query.length>100){res.status(400).json({error:'Recherche invalide.'});return;}
  const uid=(req as Request & { user: { uid: string } }).user.uid;
  let source: Awaited<ReturnType<typeof universeMedia>>;
  try { source = await universeMedia(seeds,uid); } catch { res.status(503).json({error:'Personnages momentanément indisponibles.'}); return; }
  const needle=normalizeCharacterName(query);
  const results=buildCharacters(source.media).filter(character=>[character.name,...character.aliases].some(name=>normalizeCharacterName(name).includes(needle))).slice(0,40);
  res.json({results,complete:source.complete});
 });
 app.get('/api/media/characters/detail', dependencies.authenticate, authenticated, async (req,res) => {
  const seed=typeof req.query.seed==='string'?req.query.seed:'', name=typeof req.query.name==='string'?req.query.name:'';
  if(!KEY.test(seed)||!name.trim()||name.length>120){res.status(400).json({error:'Personnage invalide.'});return;}
  try {
   const uid=(req as Request & { user: { uid: string } }).user.uid;
   const source=await universeMedia([seed],uid);
   const character=buildCharacters(source.media).find(item=>item.id===characterId(item.universeId,name));
   if(!character){res.status(404).json({error:'Personnage indisponible.'});return;}
   const result=await detail(character,source.media,uid,source.complete);
   res.json({character:{...result,complete:result.complete&&source.complete}});
  } catch {res.status(503).json({error:'Personnage momentanément indisponible.'});}
 });
}
