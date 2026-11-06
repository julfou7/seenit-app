/** Métadonnées publiques exactes uniquement ; une panne d'image ne bloque jamais le reçu. */
export function createDownloadNotificationPosterResolver({
  apiKey = () => process.env.TMDB_API_KEY,
  request = fetch,
  now = Date.now,
}: { apiKey?: () => string | undefined; request?: typeof fetch; now?: () => number } = {}) {
  const cache = new Map<string, { url?: string; expires: number }>();
  const inFlight = new Map<string, Promise<string | undefined>>();
  return async (tmdbId: number, mediaType: string): Promise<string | undefined> => {
    if (!Number.isSafeInteger(tmdbId) || tmdbId <= 0 || !['movie', 'tv'].includes(mediaType)) return undefined;
    const key = `${mediaType}:${tmdbId}`;
    const entry = cache.get(key);
    if (entry && entry.expires > now()) return entry.url;
    if (inFlight.has(key)) return inFlight.get(key);
    if (inFlight.size >= 8) return undefined;
    const pending = (async () => {
      let url: string | undefined;
      try {
        const secret = apiKey()?.trim();
        if (!secret) return undefined;
        const endpoint = new URL(`https://api.themoviedb.org/3/${mediaType}/${tmdbId}`);
        endpoint.searchParams.set('language', 'fr-FR');
        endpoint.searchParams.set('api_key', secret);
        const response = await request(endpoint, { signal: AbortSignal.timeout(2500), redirect: 'error' });
        if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('application/json')) {
          await response.body?.cancel();
          return undefined;
        }
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 64 * 1024) throw new Error('POSTER_METADATA_TOO_LARGE');
            chunks.push(value);
          }
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (data && typeof data === 'object') {
          const item = data as { id?: unknown; poster_path?: unknown };
          if (item.id === tmdbId && typeof item.poster_path === 'string' && !item.poster_path.includes(secret) && /^\/[A-Za-z0-9_-]+\.(?:jpg|png|webp)$/.test(item.poster_path)) {
            url = `https://image.tmdb.org/t/p/w342${item.poster_path}`;
          }
        }
      } catch { /* Le reçu et sa vérification Plex restent indépendants de l'image. */ }
      finally {
        cache.delete(key);
        cache.set(key, { url, expires: now() + (url ? 86_400_000 : 30_000) });
        while (cache.size > 128) cache.delete(cache.keys().next().value!);
      }
      return url;
    })();
    inFlight.set(key, pending);
    try { return await pending; } finally { inFlight.delete(key); }
  };
}
