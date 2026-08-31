export function createCachedAsyncLoader<T>(loader: () => Promise<T>): () => Promise<T> {
  let cachedPromise: Promise<T> | null = null;

  return () => {
    if (!cachedPromise) {
      cachedPromise = loader().catch(error => {
        cachedPromise = null;
        throw error;
      });
    }
    return cachedPromise;
  };
}

export async function preloadInBackground(loaders: Array<() => Promise<unknown>>): Promise<void> {
  await Promise.allSettled(loaders.map(loader => loader()));
}
