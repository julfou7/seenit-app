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
    <div className="brand-stacked-logo" role="img" aria-label="SeenIt" dangerouslySetInnerHTML={{__html:brandStackedSvg}} />
    <div className="seenit-brand-splash__episodes" aria-hidden="true">{Array.from({length:8},(_,index)=><i key={index}/>)}</div>
    <p>Chaque visionnage compte.</p>
  </div>;
}
