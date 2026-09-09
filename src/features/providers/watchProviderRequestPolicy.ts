export const WATCH_PROVIDER_MAX_CONCURRENT = 4;
export const WATCH_PROVIDER_CARD_IDLE_TIMEOUT_MS = 1_000;

const observedProviderCards = new Map<Element, () => void>();
let sharedProviderCardObserver: IntersectionObserver | null = null;

function releaseProviderCard(element: Element): void {
  observedProviderCards.delete(element);
  sharedProviderCardObserver?.unobserve(element);
  if (observedProviderCards.size === 0) {
    sharedProviderCardObserver?.disconnect();
    sharedProviderCardObserver = null;
  }
}

function getProviderCardObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver === 'undefined') return null;
  if (sharedProviderCardObserver) return sharedProviderCardObserver;

  sharedProviderCardObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const callback = observedProviderCards.get(entry.target);
      releaseProviderCard(entry.target);
      callback?.();
    }
  }, { rootMargin: '200px' });
  return sharedProviderCardObserver;
}

export function observeWatchProviderCard(element: Element, callback: () => void): () => void {
  const observer = getProviderCardObserver();
  if (!observer) {
    callback();
    return () => {};
  }

  observedProviderCards.set(element, callback);
  observer.observe(element);
  return () => releaseProviderCard(element);
}

export interface WatchProviderRequestLimiter {
  run<T>(task: () => Promise<T>): Promise<T>;
  getActiveCount(): number;
  getPendingCount(): number;
}

export function createWatchProviderRequestLimiter(
  maxConcurrent: number = WATCH_PROVIDER_MAX_CONCURRENT
): WatchProviderRequestLimiter {
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
    throw new Error('maxConcurrent doit être un entier supérieur ou égal à 1');
  }

  let activeCount = 0;
  const pending: Array<() => void> = [];

  const drain = () => {
    while (activeCount < maxConcurrent && pending.length > 0) {
      const start = pending.shift();
      if (!start) break;
      activeCount += 1;
      start();
    }
  };

  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        pending.push(() => {
          Promise.resolve()
            .then(task)
            .then(resolve, reject)
            .finally(() => {
              activeCount -= 1;
              drain();
            });
        });
        drain();
      });
    },
    getActiveCount: () => activeCount,
    getPendingCount: () => pending.length,
  };
}

type IdleScheduler = {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
  setTimeout: (callback: () => void, delay: number) => ReturnType<typeof setTimeout> | number;
  clearTimeout: (handle: ReturnType<typeof setTimeout> | number) => void;
};

function getDefaultScheduler(): IdleScheduler {
  const globalScheduler = globalThis as typeof globalThis & Partial<IdleScheduler>;
  return {
    requestIdleCallback: globalScheduler.requestIdleCallback?.bind(globalScheduler),
    cancelIdleCallback: globalScheduler.cancelIdleCallback?.bind(globalScheduler),
    setTimeout: globalScheduler.setTimeout.bind(globalScheduler),
    clearTimeout: globalScheduler.clearTimeout.bind(globalScheduler),
  };
}

export function scheduleWatchProviderCardEnrichment(
  task: () => void,
  scheduler: IdleScheduler = getDefaultScheduler()
): () => void {
  let cancelled = false;
  const run = () => {
    if (!cancelled) task();
  };

  if (scheduler.requestIdleCallback) {
    const handle = scheduler.requestIdleCallback(run, { timeout: WATCH_PROVIDER_CARD_IDLE_TIMEOUT_MS });
    return () => {
      cancelled = true;
      scheduler.cancelIdleCallback?.(handle);
    };
  }

  const handle = scheduler.setTimeout(run, 50);
  return () => {
    cancelled = true;
    scheduler.clearTimeout(handle);
  };
}
