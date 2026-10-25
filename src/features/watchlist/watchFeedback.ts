export const WATCH_BUTTON_MS = 620;
export const WATCH_STAMP_MS = 500;
export const WATCH_ADVANCE_MS = 400;

/** A removed/reset card cannot continue a delayed visual transaction. */
export function waitForWatchFeedback(milliseconds: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise(resolve => {
    const cancel = () => { clearTimeout(timer); resolve(false); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(true); }, milliseconds);
    signal.addEventListener('abort', cancel, { once: true });
  });
}
