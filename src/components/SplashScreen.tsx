import './brand.css';
import { brandStackedSvg } from '../assets/brandStacked';
import React, { useEffect, useRef, useState } from 'react';

interface SplashScreenProps {
  onComplete: () => void;
  onStartClose?: () => void;
  isReady: boolean;
  /** Fin de l'animation : l'app monte alors son contenu sous le splash, avant le fondu. */
  onAnimationDone?: () => void;
  minimumDisplayTime?: number;
  animate?: boolean;
}

// Dernière image clé à 2 160 ms : 140 ms de signature lisible, au lieu d'un maintien immobile jusqu'à 3,5 s.
export const BRAND_SPLASH_ANIMATION_MS = 2300;

const ringHalf = (id: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="${id}" x1="10%" y1="5%" x2="90%" y2="95%"><stop offset="0%" stop-color="#FFF2B8"/><stop offset="32%" stop-color="#F5C518"/><stop offset="70%" stop-color="#E5A93D"/><stop offset="100%" stop-color="#B37812"/></linearGradient></defs><circle cx="50" cy="50" r="38" fill="none" stroke="url(#${id})" stroke-width="10"/></svg>`;
const RING_BOTTOM = ringHalf('seenit-splash-ring-bottom');
// Anneau complet et coche du symbole, en couches HTML : leur apparition est animée par le compositeur, jamais
// par le fil principal (occupé à monter l'app sous le splash). Le symbole SVG du logo reste masqué jusqu'à la fin.
const ringFull = (id: string) => ringHalf(id);
const tickMark = (id: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="${id}" x1="10%" y1="5%" x2="90%" y2="95%"><stop offset="0%" stop-color="#FFF2B8"/><stop offset="32%" stop-color="#F5C518"/><stop offset="70%" stop-color="#E5A93D"/><stop offset="100%" stop-color="#B37812"/></linearGradient></defs><path d="M36 51 L46 61 L65 40" fill="none" stroke="url(#${id})" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const RING_FULL = ringFull('seenit-splash-ring-full');
const TICK_MARK = tickMark('seenit-splash-tick');
const RING_TOP = ringHalf('seenit-splash-ring-top');

export function SplashScreen({
  onComplete,
  onStartClose,
  isReady,
  onAnimationDone,
  minimumDisplayTime = 0,
  animate = true
}: SplashScreenProps) {
  const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion:reduce)').matches;
  const duration = Math.max(minimumDisplayTime, animate && !reducedMotion ? BRAND_SPLASH_ANIMATION_MS : 0);
  const [timeElapsed, setTimeElapsed] = useState(duration === 0);
  const [isClosing, setIsClosing] = useState(false);
  const onCompleteRef = useRef(onComplete);
  const onStartCloseRef = useRef(onStartClose);
  const onAnimationDoneRef = useRef(onAnimationDone);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    onStartCloseRef.current = onStartClose;
  }, [onStartClose]);

  useEffect(() => {
    onAnimationDoneRef.current = onAnimationDone;
  }, [onAnimationDone]);

  useEffect(() => {
    if (timeElapsed) onAnimationDoneRef.current?.();
  }, [timeElapsed]);

  useEffect(() => {
    if (duration === 0) {
      setTimeElapsed(true);
      return;
    }
    const timer = setTimeout(() => {
      setTimeElapsed(true);
    }, duration);

    return () => clearTimeout(timer);
  }, [duration]);

  useEffect(() => {
    if (!timeElapsed || !isReady || isClosing) return;
    setIsClosing(true);
    onStartCloseRef.current?.();
  }, [timeElapsed, isReady, isClosing]);

  useEffect(() => {
    if (!isClosing) return;
    const closeTimer = setTimeout(() => {
      onCompleteRef.current();
    }, reducedMotion ? 0 : 500);
    return () => clearTimeout(closeTimer);
  }, [isClosing, reducedMotion]);

  return <div id="seenit-splash-screen" className={'seenit-brand-splash'+(isClosing ? ' seenit-brand-splash--closing' : '')} data-ready={timeElapsed || !animate || reducedMotion}>
    <div className="brand-stacked-logo" role="img" aria-label="SeenIt">
      <div dangerouslySetInnerHTML={{__html:brandStackedSvg}} />
      <span className="brand-splash-ring" aria-hidden="true">
        <span className="brand-splash-ring__half brand-splash-ring__half--bottom"><span className="brand-splash-ring__window"><span className="brand-splash-ring__ring" dangerouslySetInnerHTML={{__html:RING_BOTTOM}} /></span></span>
        <span className="brand-splash-ring__half brand-splash-ring__half--top"><span className="brand-splash-ring__window"><span className="brand-splash-ring__ring" dangerouslySetInnerHTML={{__html:RING_TOP}} /></span></span>
          <span className="brand-splash-ring__full" dangerouslySetInnerHTML={{__html:RING_FULL}} />
          <span className="brand-splash-ring__tick" dangerouslySetInnerHTML={{__html:TICK_MARK}} />
      </span>
    </div>
    <div className="seenit-brand-splash__episodes" aria-hidden="true">{Array.from({length:8},(_,index)=><i key={index}/>)}</div>
    <p>Chaque visionnage compte.</p>
  </div>;
}
