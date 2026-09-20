const DEFAULT_PREFIX_CONCURRENCY = 2;

export function createSupersedingAbortController(): () => AbortController {
  let current: AbortController | null = null;
  return () => {
    current?.abort();
    current = new AbortController();
    return current;
  };
}

export async function filterResolvedPrefixes<TItem, TResolved, TAccepted>(
  items: TItem[],
  prefixSize: number,
  resolvePrefix: (items: TItem[]) => Promise<TResolved[]>,
  acceptResolved: (item: TItem, resolved: TResolved | undefined) => TAccepted | null,
  onPartial?: (accepted: TAccepted[]) => void,
  maxConcurrentPrefixes: number = DEFAULT_PREFIX_CONCURRENCY,
): Promise<TAccepted[]> {
  if (!Number.isInteger(prefixSize) || prefixSize <= 0) {
    throw new Error('PROGRESSIVE_PREFIX_SIZE_INVALID');
  }
  if (!Number.isInteger(maxConcurrentPrefixes) || maxConcurrentPrefixes <= 0) {
    throw new Error('PROGRESSIVE_PREFIX_CONCURRENCY_INVALID');
  }

  const acceptedByIndex = new Map<number, TAccepted>();
  let lastPublishedIndexes = '';
  let nextOffset = 0;

  const publishResolved = () => {
    if (!onPartial || acceptedByIndex.size === 0) return;
    const orderedIndexes = Array.from(acceptedByIndex.keys()).sort((left, right) => left - right);
    const signature = orderedIndexes.join(',');
    if (signature === lastPublishedIndexes) return;
    lastPublishedIndexes = signature;
    onPartial(orderedIndexes.map(index => acceptedByIndex.get(index)!));
  };

  const processNextPrefix = async (): Promise<void> => {
    while (true) {
      const offset = nextOffset;
      if (offset >= items.length) return;
      nextOffset += prefixSize;

      const prefix = items.slice(offset, offset + prefixSize);
      const resolved = await resolvePrefix(prefix);
      for (let index = 0; index < prefix.length; index += 1) {
        const candidate = acceptResolved(prefix[index], resolved[index]);
        if (candidate !== null) acceptedByIndex.set(offset + index, candidate);
      }
      publishResolved();
    }
  };

  const prefixCount = Math.ceil(items.length / prefixSize);
  const workerCount = Math.min(maxConcurrentPrefixes, prefixCount);
  await Promise.all(Array.from({ length: workerCount }, () => processNextPrefix()));

  return Array.from(acceptedByIndex.entries())
    .sort(([left], [right]) => left - right)
    .map(([, candidate]) => candidate);
}

export interface StableProgressiveDisplay<T> {
  items: T[];
  order: string[];
}

export function stabilizeProgressiveDisplayItems<T>(
  currentItems: T[],
  previousOrder: string[],
  keyOf: (item: T) => string,
): StableProgressiveDisplay<T> {
  const currentByKey = new Map<string, T>();
  const currentOrder: string[] = [];

  for (const item of currentItems) {
    const key = keyOf(item);
    if (!key || currentByKey.has(key)) continue;
    currentByKey.set(key, item);
    currentOrder.push(key);
  }

  const order: string[] = [];
  const seen = new Set<string>();

  for (const key of previousOrder) {
    if (!currentByKey.has(key) || seen.has(key)) continue;
    seen.add(key);
    order.push(key);
  }

  for (const key of currentOrder) {
    if (seen.has(key)) continue;
    seen.add(key);
    order.push(key);
  }

  return {
    order,
    items: order.map(key => currentByKey.get(key)!),
  };
}

export function mergeProgressivePageItems<T>(
  settledItems: T[],
  partialItems: T[],
  page: number,
  keyOf: (item: T) => string,
): T[] {
  const source = page <= 1 ? partialItems : [...settledItems, ...partialItems];
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const item of source) {
    const key = keyOf(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

export function shouldApplyProgressivePartial(
  requestGeneration: number,
  currentGeneration: number,
  page: number,
): boolean {
  return Number.isInteger(page) && page >= 1 && requestGeneration === currentGeneration;
}


export interface PrefetchedPage<T> {
  promise: Promise<T>;
  reused: boolean;
}

export function createPagePrefetchWindow<T>(
  ahead: number,
  maxEntries: number = Math.max(4, ahead + 4),
) {
  if (!Number.isInteger(ahead) || ahead < 0) throw new Error('PAGE_PREFETCH_AHEAD_INVALID');
  if (!Number.isInteger(maxEntries) || maxEntries < ahead + 1) throw new Error('PAGE_PREFETCH_MAX_ENTRIES_INVALID');

  let activeKey = '';
  const pages = new Map<number, Promise<T>>();

  const ensureKey = (queryKey: string) => {
    if (queryKey === activeKey) return;
    activeKey = queryKey;
    pages.clear();
  };

  const trim = () => {
    while (pages.size > maxEntries) {
      const oldest = pages.keys().next().value;
      if (oldest === undefined) return;
      pages.delete(oldest);
    }
  };

  const get = (
    queryKey: string,
    page: number,
    loader: (page: number) => Promise<T>,
  ): PrefetchedPage<T> => {
    ensureKey(queryKey);
    const existing = pages.get(page);
    if (existing) return { promise: existing, reused: true };

    const promise = Promise.resolve().then(() => loader(page));
    pages.set(page, promise);
    trim();
    void promise.catch(() => {
      if (pages.get(page) === promise) pages.delete(page);
    });
    return { promise, reused: false };
  };

  const primeAhead = (
    queryKey: string,
    page: number,
    loader: (page: number) => Promise<T>,
  ): number[] => {
    ensureKey(queryKey);
    const started: number[] = [];
    for (let offset = 1; offset <= ahead; offset += 1) {
      const targetPage = page + offset;
      const prefetched = get(queryKey, targetPage, loader);
      if (!prefetched.reused) started.push(targetPage);
    }
    return started;
  };

  return { get, primeAhead };
}
