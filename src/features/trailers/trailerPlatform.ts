import { Capacitor, registerPlugin } from '@capacitor/core';
import { createTrailerPresentationQueue, type TrailerPresentationAdapter } from './trailerPresentation.ts';

const nativeTrailer = registerPlugin<TrailerPresentationAdapter>('SeenItTrailer');
const nativeQueue = createTrailerPresentationQueue(nativeTrailer);
type LockableOrientation = ScreenOrientation & { lock?: (orientation: string) => Promise<void> };

export const isNativeTrailer = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

export function trailerPresentationAdapter(element: HTMLElement): TrailerPresentationAdapter {
  if (isNativeTrailer()) return nativeQueue;
  const orientation = screen.orientation as LockableOrientation | undefined;
  let ownsFullscreen = false;
  let ownsOrientation = false;
  return {
    enter: async () => {
      if (document.fullscreenElement || !element.requestFullscreen) return;
      await element.requestFullscreen();
      ownsFullscreen = document.fullscreenElement === element;
      if (ownsFullscreen && orientation?.lock) {
        try { await orientation.lock('landscape'); ownsOrientation = true; } catch { /* Repli libre. */ }
      }
    },
    leave: async () => {
      if (ownsOrientation) orientation?.unlock();
      if (ownsFullscreen && document.fullscreenElement === element) await document.exitFullscreen();
    },
  };
}

export function shouldAutoPresentTrailer(): boolean {
  return isNativeTrailer() || (window.matchMedia('(pointer: coarse)').matches && navigator.userActivation?.isActive === true);
}
