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

interface StableDownloadSortItem {
  id: string;
  requestId?: string;
  addedAt?: number;
}

/**
 * L'ordre visuel ne doit jamais dépendre de l'ordre des réponses Sonarr/Radarr/qBit,
 * qui peut varier à chaque polling. addedAt est conservé lors des réconciliations ;
 * requestId sert de départage stable si deux demandes sont parties à la même milliseconde.
 */
export function sortDownloadsByAddedAt<T extends StableDownloadSortItem>(
  items: T[],
  direction: 'asc' | 'desc' = 'asc'
): T[] {
  const factor = direction === 'asc' ? 1 : -1;
  return [...items].sort((left, right) => {
    const leftAt = Number(left.addedAt || 0);
    const rightAt = Number(right.addedAt || 0);

    if (leftAt && rightAt && leftAt !== rightAt) {
      return (leftAt - rightAt) * factor;
    }
    if (leftAt !== rightAt) {
      return leftAt ? -1 : 1;
    }

    const leftKey = String(left.requestId || left.id);
    const rightKey = String(right.requestId || right.id);
    return leftKey.localeCompare(rightKey) * factor;
  });
}
