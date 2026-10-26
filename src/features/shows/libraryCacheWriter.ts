/** Coalesce local snapshots; never serialize the whole library in a tap handler. */
export function createLibraryCacheWriter<T>({ currentUid, write, schedule = scheduleLibraryCache }: {
  currentUid: () => string | null | undefined;
  write: (uid: string, value: T) => void;
  schedule?: (task: () => void) => () => void;
}) {
  let pending: { uid: string; value: T } | null = null;
  let cancelScheduled: (() => void) | null = null;
  const cancel = () => { cancelScheduled?.(); cancelScheduled = null; pending = null; };
  const flush = () => {
    const snapshot = pending;
    cancel();
    if (snapshot && snapshot.uid === currentUid()) write(snapshot.uid, snapshot.value);
  };
  return {
    save(uid: string | null | undefined, value: T) {
      if (!uid) return;
      pending = { uid, value };
      cancelScheduled ??= schedule(flush);
    },
    flush,
    cancel,
  };
}

function scheduleLibraryCache(task: () => void) {
  let idle: number | undefined;
  const timer = setTimeout(() => {
    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      idle = window.requestIdleCallback(task, { timeout: 800 });
    } else task();
  }, 120);
  return () => { clearTimeout(timer); if (idle !== undefined) window.cancelIdleCallback(idle); };
}
