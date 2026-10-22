import { useEffect, useRef } from 'react';
/** L'intention survit au chargement lazy et n'est consommée qu'une fois par écran actif. */
export function useTabShortcut(request: number | undefined, action: () => void | (() => void)) {
  const actionRef = useRef(action);
  actionRef.current = action;
  const consumed = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (request === undefined || consumed.current === request) return;
    consumed.current = request;
    return actionRef.current();
  }, [request]);
}

export function useNavigationSearchShortcut(request: number | undefined, reveal: () => void, selector: string) {
  useTabShortcut(request, () => {
    reveal();
    const frame = requestAnimationFrame(() => document.querySelector<HTMLInputElement>(selector)?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  });
}
