export function isDownloadToastPresentation(
  type: string,
  ...texts: Array<string | undefined | null>
): boolean {
  if (type === 'download') return true;
  return texts.some((text) => typeof text === 'string' && /téléchargement/i.test(text));
}

const EPISODE_SUBTITLE = /S(\d+)\s*\|\s*E(\d+)/i;

/**
 * #878 — Ligne de détail d'un toast. Le sous-titre se partage : le code d'épisode devient la pastille
 * « S01 | E03 » du toast d'épisode (comme avant #878, retour terrain du 07/11) et le reste du contexte
 * (« non vu sur Plex », bilan, type) rejoint le détail, devant l'action. Rien du message d'origine n'est perdu.
 */
export function toastDetailLine({ subtitle, action }: { subtitle?: string; action?: string }): { episodeLabel?: string; detail: string } {
  const episodeMatch = subtitle?.match(EPISODE_SUBTITLE);
  const episodeLabel = episodeMatch ? `S${episodeMatch[1].padStart(2, '0')} | E${episodeMatch[2].padStart(2, '0')}` : undefined;
  const context = (subtitle || '').replace(EPISODE_SUBTITLE, '').replace(/^[\s•·|:–—-]+|[\s•·|:–—-]+$/g, '');
  const actionText = action || '';
  const detail = [
    context && context !== actionText ? context.charAt(0).toUpperCase() + context.slice(1) : '',
    actionText
  ].filter(Boolean).join(' · ').replace(/\s*\n+\s*/g, ' · ');
  return { episodeLabel, detail };
}

export type ToastSwipeDirection = 'down' | 'right';

/**
 * SEENIT-UX-004 (retour v1.4.300) : tout toast, Plex compris, se ferme en glissant vers le bas ou vers la droite.
 * Un geste vers le haut ou la gauche, ou trop court et lent, ne ferme rien ; l'axe dominant l'emporte.
 */
export function toastSwipeDismissDirection(offsetX: number, offsetY: number, velocityX = 0, velocityY = 0): ToastSwipeDirection | null {
  // Revue Codex #969 : l'axe dominant et son sens sont fixés d'abord ; un geste surtout vers le haut ne ferme jamais,
  // même avec une dérive vers la droite.
  const horizontal = Math.abs(offsetX) === Math.abs(offsetY)
    ? Math.abs(velocityX) > Math.abs(velocityY)
    : Math.abs(offsetX) > Math.abs(offsetY);
  if (horizontal) return offsetX >= 0 && (offsetX > 48 || velocityX > 300) ? 'right' : null;
  return offsetY >= 0 && (offsetY > 24 || velocityY > 250) ? 'down' : null;
}
