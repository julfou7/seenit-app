export interface ReleaseAudio {
  vff: boolean;
  vfq: boolean;
  multi: boolean;
  label?: string;
}

/** Qualification audio uniquement : ce texte ne prouve jamais l'identité du média. */
export function getReleaseAudio(releaseTitle?: string): ReleaseAudio {
  const tokens = new Set((releaseTitle || '').toUpperCase().split(/[^A-Z0-9]+/));
  const vff = tokens.has('VFF');
  const vfq = tokens.has('VFQ');
  const multi = tokens.has('MULTI');
  const variant = [vff ? 'VFF' : '', vfq ? 'VFQ' : ''].filter(Boolean).join(' + ');
  const label = variant ? `${multi ? 'MULTI ' : ''}${variant}`
    : multi ? 'MULTI · variante inconnue'
    : tokens.has('FRENCH') || tokens.has('VF') ? 'FR · variante inconnue' : undefined;
  return { vff, vfq, multi, label };
}
