export type SwipeActionDirection = 'left' | 'right';

/**
 * Rend les actions de swipe accessibles au clavier sans déclencher une action
 * depuis un champ ou un bouton enfant. Les flèches conservent la direction
 * visuelle du geste ; Suppr/Retour arrière choisit l'action destructive
 * historique (gauche), ou l'unique action disponible.
 */
export function resolveSwipeKeyboardAction(
  key: string,
  hasLeftAction: boolean,
  hasRightAction: boolean
): SwipeActionDirection | null {
  if (key === 'ArrowLeft') return hasLeftAction ? 'left' : null;
  if (key === 'ArrowRight') return hasRightAction ? 'right' : null;
  if (key !== 'Delete' && key !== 'Backspace') return null;
  if (hasLeftAction) return 'left';
  return hasRightAction ? 'right' : null;
}

export function describeSwipeKeyboardActions(
  leftTitle: string | undefined,
  rightTitle: string | undefined
): string {
  const actions: string[] = [];
  if (leftTitle) actions.push(`flèche gauche : ${leftTitle}`);
  if (rightTitle) actions.push(`flèche droite : ${rightTitle}`);
  const destructiveTitle = leftTitle || rightTitle;
  if (destructiveTitle) actions.push(`touche Suppr : ${destructiveTitle}`);
  return actions.length ? `Actions de la carte — ${actions.join(' ; ')}.` : '';
}
