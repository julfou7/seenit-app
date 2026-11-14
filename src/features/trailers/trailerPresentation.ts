/** #672 : le bridge Android indique s'il a réellement appliqué l'immersion (téléphone seulement). */
export interface TrailerPresentationResult {
  immersive?: boolean;
}

export interface TrailerPresentationAdapter {
  serialized?: boolean;
  enter: () => Promise<TrailerPresentationResult | void>;
  leave: () => Promise<void>;
}

/** Seul le bridge natif est sérialisé ; le Web doit appeler requestFullscreen dans le geste. */
export function createTrailerPresentationQueue(adapter: TrailerPresentationAdapter): TrailerPresentationAdapter {
  let pending: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(action: () => Promise<T>) => {
    const next = pending.then(action);
    pending = next.catch(() => undefined);
    return next;
  };
  return { serialized: true, enter: () => enqueue(adapter.enter), leave: () => enqueue(adapter.leave) };
}

export function startTrailerPresentation(adapter: TrailerPresentationAdapter) {
  const ready = adapter.enter()
    .then(result => ({ immersive: (result as TrailerPresentationResult | undefined)?.immersive === true }))
    .catch(() => ({ immersive: false }));
  let closing: Promise<void> | undefined;
  return {
    ready,
    close: () => {
      closing ||= (adapter.serialized ? adapter.leave() : ready.then(() => adapter.leave())).catch(() => undefined);
      return closing;
    },
  };
}
