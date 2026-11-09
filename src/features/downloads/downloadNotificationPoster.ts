import { getTmdbLocalizedTitle } from '../shows/mediaTitle.ts';

/** Affiche et titre de la fiche TMDB fr-FR d'une notification de téléchargement. */
export interface DownloadNotificationMedia { posterUrl?: string; title?: string }
type ResolverOptions = { apiKey?: () => string | undefined; request?: typeof fetch; now?: () => number };

/**
 * Métadonnées publiques exactes uniquement ; une panne ne bloque jamais le reçu. SEENIT-DOWNLOAD-022 (retour
 * terrain du 09/11 : « titre de la notif Plex en anglais également ») : la même fiche fr-FR donne aussi le titre
 * français, comme dans l'app (« La Prophétie de l'Horloge » et non « The House with a Clock in Its Walls »).
 */
export function createDownloadNotificationMediaResolver({
  apiKey = () => process.env.TMDB_API_KEY,
  request = fetch,
  now = Date.now,
}: ResolverOptions = {}) {
  const cache = new Map<string, { media: DownloadNotificationMedia; expires: number }>();
  const inFlight = new Map<string, Promise<DownloadNotificationMedia>>();
  return async (tmdbId: number, mediaType: string): Promise<DownloadNotificationMedia> => {
    if (!Number.isSafeInteger(tmdbId) || tmdbId <= 0 || !['movie', 'tv'].includes(mediaType)) return {};
    const key = `${mediaType}:${tmdbId}`;
    const entry = cache.get(key);
    if (entry && entry.expires > now()) return entry.media;
    const running = inFlight.get(key);
    if (running) return running;
    if (inFlight.size >= 8) return {};
    const pending = (async () => {
      let url: string | undefined;
      let title: string | undefined;
      try {
        const secret = apiKey()?.trim();
        if (!secret) throw new Error('TMDB_KEY_MISSING');
        const endpoint = new URL(`https://api.themoviedb.org/3/${mediaType}/${tmdbId}`);
        endpoint.searchParams.set('language', 'fr-FR');
        endpoint.searchParams.set('api_key', secret);
        const response = await request(endpoint, { signal: AbortSignal.timeout(2500), redirect: 'error' });
        if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('application/json')) {
          await response.body?.cancel();
          throw new Error('TMDB_UNAVAILABLE');
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
          // Même identité exacte que l'affiche ; jamais un texte qui contiendrait la clé.
          const localized = item.id === tmdbId ? getTmdbLocalizedTitle(data, mediaType as 'movie' | 'tv')?.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim() : undefined;
          if (localized && !localized.includes(secret)) title = localized.slice(0, 180);
        }
      } catch { /* Le reçu et sa vérification Plex restent indépendants de l'image et du titre. */ }
      const media: DownloadNotificationMedia = { ...(url ? { posterUrl: url } : {}), ...(title ? { title } : {}) };
      cache.delete(key);
      cache.set(key, { media, expires: now() + (url || title ? 86_400_000 : 30_000) });
      while (cache.size > 128) cache.delete(cache.keys().next().value!);
      return media;
    })();
    inFlight.set(key, pending);
    try { return await pending; } finally { inFlight.delete(key); }
  };
}

/** Affiche seule (compatibilité) : même cache et mêmes gardes que le résolveur complet. */
export function createDownloadNotificationPosterResolver(options: ResolverOptions = {}) {
  const resolve = createDownloadNotificationMediaResolver(options);
  return async (tmdbId: number, mediaType: string): Promise<string | undefined> => (await resolve(tmdbId, mediaType)).posterUrl;
}
