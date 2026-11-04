export const WATCH_PROVIDER_MAX_CONCURRENT = 4;
export const WATCH_PROVIDER_CARD_SCROLL_SETTLE_MS = 180;
export const WATCH_PROVIDER_CARD_FALLBACK_DELAY_MS = 50;

/**
 * #853 : une liste qui défile dans son propre conteneur le marque `data-watch-provider-root`. L'observateur prend
 * ce conteneur pour racine, sinon la marge de 200 px serait sans effet (la carte reste coupée par le conteneur).
 */
export const WATCH_PROVIDER_ROOT_ATTRIBUTE = 'data-watch-provider-root';
const observedProviderCards = new Map<Element, { callback: () => void; root: Element | null }>();
const providerCardObservers = new Map<Element | null, IntersectionObserver>();
let lastProviderInteractionAt = 0;
let providerInteractionTrackingInstalled = false;

export function markWatchProviderCardInteraction(now: number = Date.now()): void {
  lastProviderInteractionAt = now;
}

function ensureProviderCardInteractionTracking(): void {
  if (providerInteractionTrackingInstalled || typeof document === 'undefined') return;

  const markInteraction = () => markWatchProviderCardInteraction();
  const options: AddEventListenerOptions = { capture: true, passive: true };
  document.addEventListener('scroll', markInteraction, options);
  document.addEventListener('touchmove', markInteraction, options);
  document.addEventListener('wheel', markInteraction, options);
  providerInteractionTrackingInstalled = true;
}

function releaseProviderCard(element: Element): void {
  const observed = observedProviderCards.get(element);
  if (!observed) return;
  observedProviderCards.delete(element);
  const observer = providerCardObservers.get(observed.root);
  observer?.unobserve(element);
  if (observer && ![...observedProviderCards.values()].some(entry => entry.root === observed.root)) {
    observer.disconnect();
    providerCardObservers.delete(observed.root);
  }
}

function getProviderCardObserver(root: Element | null): IntersectionObserver | null {
  if (typeof IntersectionObserver === 'undefined') return null;
  const existing = providerCardObservers.get(root);
  if (existing) return existing;

  ensureProviderCardInteractionTracking();
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const callback = observedProviderCards.get(entry.target)?.callback;
      releaseProviderCard(entry.target);
      callback?.();
    }
  }, { root, rootMargin: '200px' });
  providerCardObservers.set(root, observer);
  return observer;
}

export function observeWatchProviderCard(element: Element, callback: () => void): () => void {
  const root = typeof element.closest === 'function' ? element.closest(`[${WATCH_PROVIDER_ROOT_ATTRIBUTE}]`) : null;
  const observer = getProviderCardObserver(root);
  if (!observer) {
    callback();
    return () => {};
  }

  observedProviderCards.set(element, { callback, root });
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
  requestIdleCallback?: (callback: () => void) => number;
  cancelIdleCallback?: (handle: number) => void;
  setTimeout: (callback: () => void, delay: number) => ReturnType<typeof setTimeout> | number;
  clearTimeout: (handle: ReturnType<typeof setTimeout> | number) => void;
  now?: () => number;
};

function getDefaultScheduler(): IdleScheduler {
  const globalScheduler = globalThis as typeof globalThis & Partial<IdleScheduler>;
  return {
    requestIdleCallback: globalScheduler.requestIdleCallback?.bind(globalScheduler),
    cancelIdleCallback: globalScheduler.cancelIdleCallback?.bind(globalScheduler),
    setTimeout: globalScheduler.setTimeout.bind(globalScheduler),
    clearTimeout: globalScheduler.clearTimeout.bind(globalScheduler),
    now: Date.now,
  };
}

export function scheduleWatchProviderCardEnrichment(
  task: () => void,
  scheduler: IdleScheduler = getDefaultScheduler()
): () => void {
  ensureProviderCardInteractionTracking();

  let cancelled = false;
  let idleHandle: number | undefined;
  let timeoutHandle: ReturnType<typeof setTimeout> | number | undefined;

  const now = () => scheduler.now?.() ?? Date.now();

  const clearScheduledHandle = () => {
    if (idleHandle !== undefined) {
      scheduler.cancelIdleCallback?.(idleHandle);
      idleHandle = undefined;
    }
    if (timeoutHandle !== undefined) {
      scheduler.clearTimeout(timeoutHandle);
      timeoutHandle = undefined;
    }
  };

  const runIfStillSettled = () => {
    if (cancelled) return;
    if (now() - lastProviderInteractionAt < WATCH_PROVIDER_CARD_SCROLL_SETTLE_MS) {
      arm();
      return;
    }
    task();
  };

  const arm = () => {
    if (cancelled) return;
    clearScheduledHandle();

    const quietFor = now() - lastProviderInteractionAt;
    if (quietFor < WATCH_PROVIDER_CARD_SCROLL_SETTLE_MS) {
      timeoutHandle = scheduler.setTimeout(
        () => {
          timeoutHandle = undefined;
          arm();
        },
        Math.max(1, WATCH_PROVIDER_CARD_SCROLL_SETTLE_MS - quietFor),
      );
      return;
    }

    if (scheduler.requestIdleCallback) {
      idleHandle = scheduler.requestIdleCallback(() => {
        idleHandle = undefined;
        runIfStillSettled();
      });
      return;
    }

    timeoutHandle = scheduler.setTimeout(() => {
      timeoutHandle = undefined;
      runIfStillSettled();
    }, WATCH_PROVIDER_CARD_FALLBACK_DELAY_MS);
  };

  arm();

  return () => {
    cancelled = true;
    clearScheduledHandle();
  };
}
