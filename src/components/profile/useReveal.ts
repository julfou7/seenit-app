import { useEffect, useRef, useState, type RefObject } from 'react';

const prefersCalm = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * SEENIT-PROFILE-005 : un bloc s'anime une seule fois, quand il entre dans l'écran (seuil 0,12). Sans
 * IntersectionObserver ou en mouvement réduit, il est affiché tout de suite dans son état final.
 */
export function useReveal<T extends Element>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(() => prefersCalm() || typeof IntersectionObserver !== 'function');
  useEffect(() => {
    if (seen || !ref.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setSeen(true); observer.disconnect(); }
    }, { threshold: 0.12 });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [seen]);
  return { ref, seen };
}

/**
 * Compte de 0 à la valeur au premier affichage, puis d'une valeur à l'autre ; s'arrête au démontage.
 * Retour terrain v1.4.306 : le texte est écrit directement dans le nœud (aucun état React par image) ; un rendu du
 * cadran entier à chaque image saccadait l'ouverture de Mes chiffres.
 */
export function useCountUp(ref: RefObject<HTMLElement | null>, value: number, play: boolean, { suffix = '', blank = false, duration = 1100 } = {}) {
  const from = useRef(value);
  const started = useRef(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const write = (next: number) => { const text = `${next}${suffix}`; if (node.textContent !== text) node.textContent = text; };
    if (blank) { node.textContent = '–'; return; }
    if (!play || prefersCalm()) { from.current = value; write(value); return; }
    const start = performance.now(), origin = started.current ? from.current : 0, length = started.current ? 380 : duration;
    started.current = true;
    write(origin);
    let frame = 0;
    const step = (time: number) => {
      const progress = Math.min(1, (time - start) / length);
      from.current = Math.round(origin + (value - origin) * (1 - Math.pow(1 - progress, 3)));
      write(from.current);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [ref, value, play, suffix, blank, duration]);
}
