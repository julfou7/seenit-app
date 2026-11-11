/**
 * SEENIT-PROFILE-003 : géométrie du cadran des mois (repère SVG de 322 px).
 * Retour terrain v1.4.293 : le secteur choisi ne doit jamais passer sous l'étiquette de son mois, même en
 * diagonale, détaché et pendant le rebond de l'animation d'ouverture.
 */
export const MONTH_DIAL = {
  size: 322,
  center: 161,
  inner: 64,
  maxGrowth: 40,
  /** Décalage radial du secteur choisi. */
  pop: 5,
  /** Rebond maximal de l'animation d'ouverture (courbe cubic-bezier(.2,.9,.3,1.25)). */
  overshoot: 1.06,
  labelRadius: 150,
  labelWidth: 46,
  labelHeight: 44,
  guides: [104, 84],
  /** Rayon de la zone de toucher invisible de chaque secteur, sous les étiquettes. */
  hitRadius: 110,
} as const;

/** Distance au centre du coin intérieur d'une étiquette posée en diagonale (cas le plus proche). */
export function monthDialLabelClearance(geometry = MONTH_DIAL): number {
  const along = geometry.labelRadius * Math.SQRT1_2;
  return Math.hypot(along - geometry.labelWidth / 2, along - geometry.labelHeight / 2);
}

/** Rayon extérieur maximal d'un secteur choisi, rebond compris. */
export function monthDialSectorReach(geometry = MONTH_DIAL): number {
  return (geometry.inner + geometry.maxGrowth) * geometry.overshoot + geometry.pop;
}
