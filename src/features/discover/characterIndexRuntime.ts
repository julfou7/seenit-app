import Dexie, { type Table } from 'dexie';
import { authenticatedFetch } from '../../lib/apiAuth';
import { createCharacterIndex, type CharacterIndexEntry, type CharacterIndexResponse, type CharacterIndexStorage } from './characterIndex';

const CHARACTER_INDEX_DATABASE = 'SeenItCharacterIndex';

class CharacterIndexDatabase extends Dexie {
  entries!: Table<CharacterIndexEntry, string>;

  constructor() {
    super(CHARACTER_INDEX_DATABASE);
    this.version(1).stores({ entries: '&key, fetchedAt' });
  }
}

let database: CharacterIndexDatabase | null | undefined;
const getDatabase = () => {
  if (database !== undefined) return database;
  database = typeof indexedDB === 'undefined' ? null : new CharacterIndexDatabase();
  return database;
};

// Données publiques TMDB uniquement : l'index est partagé entre comptes, comme le cache serveur.
const storage: CharacterIndexStorage = {
  async read(keys) {
    const current = getDatabase();
    if (!current) return [];
    return (await current.entries.bulkGet([...keys])).filter((entry): entry is CharacterIndexEntry => Boolean(entry));
  },
  async write(entries) {
    const current = getDatabase();
    if (current) await current.entries.bulkPut([...entries]);
  },
};

async function fetchBatch(keys: readonly string[]): Promise<CharacterIndexResponse> {
  const response = await authenticatedFetch('/api/media/characters/index?ids=' + encodeURIComponent(keys.join(',')));
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('Retry-After'));
    return { media: [], related: {}, failed: [...keys], retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined };
  }
  if (!response.ok) throw new Error('CHARACTER_INDEX_UNAVAILABLE');
  const data = await response.json() as Partial<CharacterIndexResponse>;
  return { media: data.media || [], related: data.related || {}, failed: data.failed || [], retryAfterMs: data.retryAfterMs };
}

export const characterIndex = createCharacterIndex({ storage, fetchBatch });
