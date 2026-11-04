import React, { useId } from 'react';

/**
 * #859 — Célébration du bouton Vu en mode compositeur : anneau or complet et coche, dévoilés par des fenêtres qui
 * tournent ou glissent (transform uniquement, aucune propriété SVG animée). Styles dans seenItCheckButton.css.
 * Module séparé, importé par les fiches (chargées à la demande), pour ne pas alourdir le point d'entrée.
 */
const RING_GRADIENT = [['0%', '#FFF2B8'], ['32%', '#F5C518'], ['70%', '#E5A93D'], ['100%', '#B37812']] as const;

/** Anneau or complet et coche, dévoilés par des fenêtres qui tournent ou glissent (aucune propriété SVG animée). */
export function CompositorCelebration() {
  const id = useId();
  const gradient = <defs><linearGradient id={id} x1="10%" y1="5%" x2="90%" y2="95%">{RING_GRADIENT.map(([offset, color]) => <stop key={offset} offset={offset} stopColor={color} />)}</linearGradient></defs>;
  const ring = <svg viewBox="0 0 100 100">{gradient}<circle cx="50" cy="50" r="38" fill="none" stroke={`url(#${id})`} strokeWidth="10" /></svg>;
  return <span className="seenit-check__sweep" aria-hidden="true">
    <span className="seenit-check__half seenit-check__half--right"><span className="seenit-check__window"><span className="seenit-check__ring">{ring}</span></span></span>
    <span className="seenit-check__half seenit-check__half--left"><span className="seenit-check__window"><span className="seenit-check__ring">{ring}</span></span></span>
    <span className="seenit-check__tick"><span className="seenit-check__tick-window"><span className="seenit-check__tick-ink"><svg viewBox="0 0 100 100"><path d="M36 51 L46 61 L65 40" fill="none" stroke={`url(#${id})`} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" /></svg></span></span></span>
  </span>;
}
