import { useLayoutEffect, useRef, useState } from 'react';
import { searchKeyboardGeometry } from '../features/discover/searchKeyboardDock';

export function useSearchKeyboardDock(focused: boolean, onKeyboardClosed: () => void) {
  const baseline = useRef({ height: window.innerHeight, width: window.innerWidth });
  const wasOpen = useRef(false);
  const onClosed = useRef(onKeyboardClosed);
  onClosed.current = onKeyboardClosed;
  const [geometry, setGeometry] = useState({ bottom: 0, keyboard: false });
  useLayoutEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      const rotated = baseline.current.width !== window.innerWidth;
      if (!focused || rotated) {
        baseline.current = { height: window.innerHeight, width: window.innerWidth };
        wasOpen.current = false;
      }
      const next = focused ? searchKeyboardGeometry(window.innerHeight, viewport?.height ?? window.innerHeight,
        viewport?.offsetTop ?? 0, baseline.current.height) : { bottom: 0, keyboard: false };
      const closed = wasOpen.current && !next.keyboard;
      wasOpen.current = next.keyboard;
      setGeometry(previous => previous.bottom === next.bottom && previous.keyboard === next.keyboard ? previous : next);
      if (closed) onClosed.current();
    };
    update();
    window.addEventListener('resize', update);
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    return () => { window.removeEventListener('resize', update); viewport?.removeEventListener('resize', update); viewport?.removeEventListener('scroll', update); };
  }, [focused]);
  return geometry;
}
