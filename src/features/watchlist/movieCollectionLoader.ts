import { tmdb } from '../shows/tmdb';
import type { CollectionPart } from './movieCollectionProgress';

const cache = new Map<number, { at: number; parts: CollectionPart[] }>();
const pending = new Map<number, Promise<CollectionPart[]>>();
export async function loadMovieCollection(id: number): Promise<CollectionPart[]> {
  const cached = cache.get(id);
  if (cached && Date.now() - cached.at < 86_400_000) return cached.parts;
  if (pending.has(id)) return pending.get(id)!;
  const request = (async () => {
    let details = tmdb.peekRenderableMediaDetails(id, 'movie');
    if (!details || !('belongs_to_collection' in details)) {
      const result = await tmdb.getMovieDetails(id);
      if (!result.ok) return [];
      details = result.value;
    }
    const collectionId = Number(details?.belongs_to_collection?.id);
    let parts: CollectionPart[] = [];
    if (Number.isInteger(collectionId) && collectionId > 0) {
      const collection = await tmdb.getCollectionDetails(collectionId);
      if (!collection.ok) return [];
      parts = Array.isArray(collection.value?.parts) ? collection.value.parts : [];
    }
    if (cache.size >= 80) cache.delete(cache.keys().next().value!);
    cache.set(id, { at: Date.now(), parts });
    return parts;
  })();
  pending.set(id, request);
  try { return await request; } finally { pending.delete(id); }
}
