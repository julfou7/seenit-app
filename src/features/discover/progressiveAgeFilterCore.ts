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
