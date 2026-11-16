export interface ReleaseAudio {
  vff: boolean;
  vfq: boolean;
  multi: boolean;
  label?: string;
}

export type FrenchVariant = 'VFF' | 'VFQ' | 'VFF + VFQ';

const FRENCH = ['MULTI', 'FRENCH', 'TRUEFRENCH', 'VF', 'VFF', 'VFQ', 'VFI', 'VF2', 'VOF'];

/**
 * Retour terrain du 16/11 (#661 : « pour les films Multi ou VF, afficher toujours VFF ou VFQ ») : convention des
 * releases françaises — un doublage québécois est toujours marqué (VFQ, QC, QUEBEC) ; VF2 annonce les deux pistes ;
 * MULTI, FRENCH, VF, VFI ou TRUEFRENCH sans marque québécoise désignent la VFF. Une VOSTFR seule n'a pas de piste française.
 * Qualification audio uniquement : ce texte ne prouve jamais l'identité du média.
 */
export function frenchVariant(releaseTitle?: string): FrenchVariant | null {
  const tokens = new Set((releaseTitle || '').toUpperCase().split(/[^A-Z0-9]+/));
  const both = tokens.has('VF2') || (tokens.has('VFF') && tokens.has('VFQ'));
  if (both) return 'VFF + VFQ';
  if (tokens.has('VFQ') || tokens.has('QC') || tokens.has('QUEBEC')) return 'VFQ';
  return FRENCH.some(token => tokens.has(token)) ? 'VFF' : null;
}

export function getReleaseAudio(releaseTitle?: string): ReleaseAudio {
  const tokens = new Set((releaseTitle || '').toUpperCase().split(/[^A-Z0-9]+/));
  const multi = tokens.has('MULTI');
  const variant = frenchVariant(releaseTitle);
  const label = variant ? `${multi ? 'MULTI ' : ''}${variant}` : undefined;
  // `vff` et `vfq` restent les marques explicites du nom (tri des versions) ; le libellé suit la convention ci-dessus.
  return { vff: tokens.has('VFF') || tokens.has('TRUEFRENCH'), vfq: tokens.has('VFQ'), multi, label };
}
