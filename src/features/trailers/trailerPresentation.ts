export interface TrailerPresentationAdapter {
  serialized?: boolean;
  enter: () => Promise<void>;
  leave: () => Promise<void>;
}

/** Seul le bridge natif est sérialisé ; le Web doit appeler requestFullscreen dans le geste. */
export function createTrailerPresentationQueue(adapter: TrailerPresentationAdapter): TrailerPresentationAdapter {
  let pending = Promise.resolve();
  const enqueue = (action: () => Promise<void>) => {
    const next = pending.then(action);
    pending = next.catch(() => undefined);
    return next;
  };
  return { serialized: true, enter: () => enqueue(adapter.enter), leave: () => enqueue(adapter.leave) };
}

export function startTrailerPresentation(adapter: TrailerPresentationAdapter) {
  const ready = adapter.enter().catch(() => undefined);
  let closing: Promise<void> | undefined;
  return {
    ready,
    close: () => {
      closing ||= (adapter.serialized ? adapter.leave() : ready.then(() => adapter.leave())).catch(() => undefined);
      return closing;
    },
  };
}
