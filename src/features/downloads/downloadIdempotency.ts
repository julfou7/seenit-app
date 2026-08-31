export interface TimedMutationResult<T> {
  expiresAt: number;
  payload: T;
}

/**
 * Partage une mutation déjà en vol et conserve brièvement son résultat.
 * Une erreur n'est jamais mémorisée : l'utilisateur peut ensuite relancer
 * explicitement l'action avec le même identifiant si elle a réellement échoué.
 */
export async function executeIdempotentMutation<T>(options: {
  key: string;
  cache: Map<string, TimedMutationResult<T>>;
  inFlight: Map<string, Promise<T>>;
  operation: () => Promise<T>;
  ttlMs: number;
  now?: () => number;
}): Promise<T> {
  const now = options.now || Date.now;
  if (options.cache.size > 5_000) {
    const instant = now();
    for (const [cacheKey, entry] of options.cache) {
      if (entry.expiresAt <= instant) options.cache.delete(cacheKey);
    }
  }
  const cached = options.cache.get(options.key);
  if (cached?.expiresAt && cached.expiresAt > now()) return cached.payload;
  if (cached) options.cache.delete(options.key);

  const existing = options.inFlight.get(options.key);
  const request = existing || options.operation();
  if (!existing) options.inFlight.set(options.key, request);

  try {
    const payload = await request;
    options.cache.set(options.key, { expiresAt: now() + options.ttlMs, payload });
    return payload;
  } finally {
    if (options.inFlight.get(options.key) === request) {
      options.inFlight.delete(options.key);
    }
  }
}
