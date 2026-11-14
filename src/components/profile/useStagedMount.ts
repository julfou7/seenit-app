import { useEffect, useState } from 'react';

/**
 * Retour terrain v1.4.307 : monter tout Mes chiffres d'un coup bloquait le fil principal ~0,5 s au moment même où le
 * cadran s'anime (compteur figé puis qui saute). Le cadran se monte seul ; les blocs suivants arrivent ensuite, un
 * palier à la fois, une fois l'introduction terminée. Renvoie le palier atteint (0 au premier rendu, puis 1…steps).
 */
export function useStagedMount(steps: number, { start = 1500, gap = 260 } = {}): number {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (level >= steps) return;
    const timer = setTimeout(() => setLevel(current => Math.min(steps, current + 1)), level === 0 ? start : gap);
    return () => clearTimeout(timer);
  }, [level, steps, start, gap]);
  return level;
}
