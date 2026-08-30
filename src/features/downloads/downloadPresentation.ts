export function clampDownloadProgress(value: unknown): number {
  const progress = Number(value ?? 0);
  if (!Number.isFinite(progress)) return 0;
  return Math.min(100, Math.max(0, progress));
}

/**
 * Le suivi conserve sa précision décimale pour la barre et la télémétrie,
 * mais l'interface affiche volontairement un pourcentage entier tronqué.
 */
export function truncateDownloadProgressPercent(value: unknown): number {
  return Math.trunc(clampDownloadProgress(value));
}
