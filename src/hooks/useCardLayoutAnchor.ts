import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

interface Anchor {
  container: HTMLElement;
  attribute: string;
  id: string;
  top: number;
  list: boolean;
  scroller: HTMLElement;
  host: HTMLElement;
  minHeight: string;
  restore: () => void;
}

/** Keep the reading point when a horizontal rail becomes a vertical list. */
export function useCardLayoutAnchor() {
  const pending = useRef<Anchor | null>(null);
  const containers = useRef(new Set<HTMLElement>());
  const hosts = useRef(new Map<HTMLElement, { padding: string; pixels: number }>());
  const release = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    const anchor = pending.current;
    if (!anchor) return;
    pending.current = null;
    const { container, attribute, id, scroller } = anchor;
    const target = Array.from(container.querySelectorAll<HTMLElement>(`[${attribute}]`)).find(card => card.getAttribute(attribute) === id);
    if (target) {
      if (!anchor.list) {
        const padding = parseFloat(getComputedStyle(container).paddingLeft) || 0;
        const gap = parseFloat(getComputedStyle(container).columnGap) || 0;
        // A final, narrow movie must also be able to align with the start edge.
        container.style.setProperty('--layout-anchor-tail', `${Math.max(0, container.clientWidth - target.getBoundingClientRect().width - padding * 2 - gap)}px`);
        container.scrollLeft += target.getBoundingClientRect().left - container.getBoundingClientRect().left - padding;
      } else container.scrollLeft = 0;
      scroller.scrollTop += target.getBoundingClientRect().top - anchor.top;
      const desired = scroller.scrollTop;
      anchor.host.style.minHeight = anchor.minHeight;
      const original = hosts.current.get(anchor.host)!;
      anchor.host.style.paddingBottom = original.padding;
      const viewport = scroller === document.scrollingElement ? window.innerHeight : scroller.clientHeight;
      const deficit = Math.max(0, desired + viewport - scroller.scrollHeight);
      if (deficit) anchor.host.style.paddingBottom = `${original.pixels + deficit}px`;
      scroller.scrollTop = desired;
    }
    let second = 0;
    const frame = requestAnimationFrame(() => { second = requestAnimationFrame(anchor.restore); });
    release.current = () => { cancelAnimationFrame(frame); cancelAnimationFrame(second); anchor.restore(); };
  });
  useEffect(() => {
    const reset = () => {
      release.current?.(); pending.current?.restore(); pending.current = null;
      for (const [host, original] of hosts.current) host.style.paddingBottom = original.padding;
      for (const container of containers.current) { container.style.removeProperty('--layout-anchor-tail'); container.scrollLeft = 0; }
    };
    window.addEventListener('watchlist-reset-all', reset);
    return () => { window.removeEventListener('watchlist-reset-all', reset); reset(); };
  }, []);
  return useCallback((containerId: string, attribute: string, list: boolean, change: (index: number) => void) => {
    release.current?.();
    const container = document.getElementById(containerId);
    if (!container) { change(0); return; }
    containers.current.add(container);
    let scroller = container.parentElement;
    while (scroller && !(/auto|scroll/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
    scroller ||= document.scrollingElement as HTMLElement;
    const viewportTop = Math.max(0, scroller.getBoundingClientRect().top, document.querySelector('.home-header')?.getBoundingClientRect().bottom || 0);
    const bounds = container.getBoundingClientRect();
    const padding = parseFloat(getComputedStyle(container).paddingLeft) || 0;
    const cards = Array.from(container.querySelectorAll<HTMLElement>(`[${attribute}]`));
    const index = cards.findIndex(card => {
      const rect = card.getBoundingClientRect();
      return list ? rect.right > bounds.left + padding + rect.width / 2 && rect.left < bounds.right : rect.bottom > viewportTop + Math.min(20, rect.height / 2);
    });
    const target = cards[Math.max(0, index)];
    if (target) {
      const original = scroller.style.overflowAnchor;
      const host = container.closest<HTMLElement>('.watch-next-18c')!;
      if (!hosts.current.has(host)) hosts.current.set(host, { padding: host.style.paddingBottom, pixels: parseFloat(getComputedStyle(host).paddingBottom) || 0 });
      const minHeight = host.style.minHeight;
      host.style.minHeight = `${host.getBoundingClientRect().height}px`;
      scroller.style.overflowAnchor = 'none';
      pending.current = { container, attribute, id: target.getAttribute(attribute)!, top: target.getBoundingClientRect().top, list, scroller, host, minHeight,
        restore: () => { scroller.style.overflowAnchor = original; host.style.minHeight = minHeight; } };
    }
    change(Math.max(0, index));
  }, []);
}
