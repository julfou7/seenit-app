import { buildCharacters, normalizeCharacterName, type CharacterMedia, type CharacterRecord } from './characters.ts';
import { getManifestGroupsForMedia, type MediaKey } from '../shows/mediaRelations.ts';

/**
 * Index local des distributions publiques, par titre. Il est construit une fois en tâche de fond,
 * partagé entre toutes les frappes et relu depuis l'appareil : la recherche de personnages devient
 * une correspondance locale au lieu d'un balayage réseau de toute la bibliothèque à chaque requête.
 * Aucune donnée privée (vus, favoris) n'y entre.
 */
export const CHARACTER_INDEX_TTL_MS = 14 * 24 * 60 * 60_000;
export const CHARACTER_INDEX_BATCH_SIZE = 24;
export const CHARACTER_INDEX_CONCURRENCY = 2;
export const CHARACTER_INDEX_UNIVERSE_MAX = 48;
export const CHARACTER_INDEX_RETRY_MS = 60_000;
export const CHARACTER_INDEX_MAX_RETRIES = 3;

export interface CharacterIndexEntry {
  key: string;
  media: CharacterMedia;
  related: string[];
  fetchedAt: number;
}

export interface CharacterIndexResponse {
  media: CharacterMedia[];
  related: Record<string, string[]>;
  failed: string[];
  retryAfterMs?: number;
}

export interface CharacterIndexStorage {
  read(keys: readonly string[]): Promise<CharacterIndexEntry[]>;
  write(entries: readonly CharacterIndexEntry[]): Promise<void>;
}

export interface CharacterIndexSnapshot {
  revision: number;
  indexing: boolean;
  partial: boolean;
}

const KEY = /^(tv|movie):[1-9]\d{0,9}$/;

/** Titres de la bibliothèque, puis membres d'univers prouvés (manifeste) et parties de collection TMDB. */
export function expandCharacterIndexKeys(keys: readonly string[], entries: ReadonlyMap<string, CharacterIndexEntry>): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const add = (key: string) => { if (KEY.test(key) && !seen.has(key)) { seen.add(key); ordered.push(key); } };
  for (const key of keys) add(key);
  for (const key of keys) {
    let budget = CHARACTER_INDEX_UNIVERSE_MAX;
    const groups = getManifestGroupsForMedia(key as MediaKey);
    const group = groups.find(item => item.relationKind === 'universe') || groups[0];
    for (const member of group?.members || []) { if (budget-- <= 0) break; add(member.mediaKey); }
    for (const related of entries.get(key)?.related || []) { if (budget-- <= 0) break; add(related); }
  }
  return ordered;
}

export function staleCharacterIndexKeys(keys: readonly string[], entries: ReadonlyMap<string, CharacterIndexEntry>, now: number): string[] {
  return keys.filter(key => {
    const entry = entries.get(key);
    return !entry || now - entry.fetchedAt > CHARACTER_INDEX_TTL_MS;
  });
}

/** Même règle de correspondance que la route serveur : nom ou alias normalisé contenant la requête. */
export function matchIndexedCharacters(characters: readonly CharacterRecord[], query: string): CharacterRecord[] {
  const needle = normalizeCharacterName(query);
  if (needle.length < 2) return [];
  return characters.filter(character => [character.name, ...character.aliases].some(name => normalizeCharacterName(name).includes(needle)));
}

export function createCharacterIndex({ storage, fetchBatch, now = Date.now, schedule = (task, delay) => { setTimeout(task, delay); } }: {
  storage: CharacterIndexStorage;
  fetchBatch: (keys: readonly string[]) => Promise<CharacterIndexResponse>;
  now?: () => number;
  schedule?: (task: () => void, delayMs: number) => void;
}) {
  const memory = new Map<string, CharacterIndexEntry>();
  const loaded = new Set<string>();
  const inFlight = new Set<string>();
  const retryAt = new Map<string, number>();
  const listeners = new Set<() => void>();
  const idleWaiters: Array<() => void> = [];
  let queue: string[] = [];
  let workers = 0;
  let retries = 0;
  let retryScheduled = false;
  let lastKeys: readonly string[] = [];
  let snapshot: CharacterIndexSnapshot = { revision: 0, indexing: false, partial: false };
  let charactersCache: { revision: number; signature: string; characters: CharacterRecord[] } | null = null;

  const publish = (patch: Partial<CharacterIndexSnapshot>) => {
    const next = { ...snapshot, ...patch };
    if (next.revision === snapshot.revision && next.indexing === snapshot.indexing && next.partial === snapshot.partial) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const loadStored = async (keys: readonly string[]) => {
    const unknown = keys.filter(key => !loaded.has(key));
    if (!unknown.length) return;
    for (const key of unknown) loaded.add(key);
    let added = false;
    try {
      for (const entry of await storage.read(unknown)) {
        const current = memory.get(entry.key);
        if (!current || current.fetchedAt < entry.fetchedAt) { memory.set(entry.key, entry); added = true; }
      }
    } catch {
      // Un stockage indisponible (navigation privée, quota) laisse seulement le réseau.
    }
    if (added) publish({ revision: snapshot.revision + 1 });
  };

  const isWaiting = (key: string, time: number) => !inFlight.has(key) && (retryAt.get(key) ?? 0) <= time
    && staleCharacterIndexKeys([key], memory, time).length > 0;

  /** File unique partagée entre les frappes ; `priority` fait passer des titres devant sans rien relancer. */
  const enqueue = (keys: readonly string[], priority = false) => {
    const time = now();
    const wanted = keys.filter(key => isWaiting(key, time));
    if (!wanted.length) return;
    if (priority) {
      const front = new Set(wanted);
      queue = [...wanted, ...queue.filter(key => !front.has(key))];
    } else {
      const present = new Set(queue);
      for (const key of wanted) if (!present.has(key)) { present.add(key); queue.push(key); }
    }
  };

  const finish = () => {
    const pending = staleCharacterIndexKeys(expandCharacterIndexKeys(lastKeys, memory), memory, now());
    if (!pending.length) retries = 0;
    publish({ indexing: false, partial: pending.length > 0 });
    for (const resolve of idleWaiters.splice(0)) resolve();
    if (pending.length && !retryScheduled && retries < CHARACTER_INDEX_MAX_RETRIES) {
      const time = now();
      const nextRetry = Math.min(...pending.map(key => retryAt.get(key) ?? time + CHARACTER_INDEX_RETRY_MS));
      retries++;
      retryScheduled = true;
      schedule(() => { retryScheduled = false; void ensure(lastKeys); }, Math.max(1_000, nextRetry - time));
    }
  };

  const work = async () => {
    for (;;) {
      const time = now();
      queue = queue.filter(key => isWaiting(key, time));
      const batch = queue.splice(0, CHARACTER_INDEX_BATCH_SIZE);
      if (!batch.length) break;
      for (const key of batch) inFlight.add(key);
      let response: CharacterIndexResponse | null = null;
      try { response = await fetchBatch(batch); } catch { response = null; }
      const fetchedAt = now();
      const received = new Set<string>();
      const entries: CharacterIndexEntry[] = [];
      for (const media of response?.media || []) {
        if (!batch.includes(media.key) || received.has(media.key)) continue;
        received.add(media.key);
        const related = (response?.related?.[media.key] || []).filter(key => KEY.test(key)).slice(0, CHARACTER_INDEX_UNIVERSE_MAX);
        entries.push({ key: media.key, media, related, fetchedAt });
      }
      for (const entry of entries) memory.set(entry.key, entry);
      for (const key of batch) {
        inFlight.delete(key);
        if (received.has(key)) retryAt.delete(key);
        else retryAt.set(key, fetchedAt + (response?.retryAfterMs || CHARACTER_INDEX_RETRY_MS));
      }
      if (entries.length) {
        void storage.write(entries).catch(() => {});
        publish({ revision: snapshot.revision + 1 });
        // Les parties de collection découvertes rejoignent la file.
        const discovered = entries.flatMap(entry => entry.related).filter(key => !memory.has(key));
        if (discovered.length) { await loadStored(discovered); enqueue(discovered); }
      }
      if (received.size < batch.length) publish({ partial: true });
    }
  };

  const pump = () => {
    while (workers < CHARACTER_INDEX_CONCURRENCY && queue.length) {
      workers++;
      publish({ indexing: true });
      void work().finally(() => { workers--; if (workers === 0 && !queue.length) finish(); else pump(); });
    }
    if (!workers) finish();
  };

  const ensure = async (libraryKeys: readonly string[], priorityKeys: readonly string[] = []) => {
    lastKeys = libraryKeys;
    await loadStored(libraryKeys);
    const keys = expandCharacterIndexKeys(libraryKeys, memory);
    await loadStored(keys);
    enqueue(keys);
    enqueue(priorityKeys, true);
    pump();
  };

  /** Personnages de la bibliothèque et de ses univers, recalculés seulement quand l'index change. */
  const characters = (libraryKeys: readonly string[]): CharacterRecord[] => {
    const keys = expandCharacterIndexKeys(libraryKeys, memory);
    const signature = keys.join(',');
    if (charactersCache && charactersCache.revision === snapshot.revision && charactersCache.signature === signature) return charactersCache.characters;
    const media = keys.flatMap(key => memory.get(key) ? [memory.get(key)!.media] : []);
    const result = buildCharacters(media);
    charactersCache = { revision: snapshot.revision, signature, characters: result };
    return result;
  };

  return {
    ensure,
    prioritize: async (keys: readonly string[]) => { await loadStored(keys); enqueue(keys, true); pump(); },
    characters,
    has: (key: string) => memory.has(key),
    idle: () => workers === 0 && !queue.length ? Promise.resolve() : new Promise<void>(resolve => idleWaiters.push(resolve)),
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
  };
}

export type CharacterIndex = ReturnType<typeof createCharacterIndex>;
