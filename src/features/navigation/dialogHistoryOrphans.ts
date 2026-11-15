/**
 * #640 : un dialogue local pousse sa propre entrée d'historique. S'il navigue de façon synchrone avant
 * de se fermer (PreviewModal : onShowClick() puis onClose()), la destination est empilée au-dessus de
 * cette entrée, que le dialogue ne peut plus dépiler. Elle est alors marquée orpheline, et un Retour qui
 * y aboutit la saute : on revient directement au niveau visible d'en dessous, sans Retour supplémentaire.
 */
const MAX_ORPHANED_ENTRIES = 32;
const orphaned = new Set<string>();

export function markDialogEntryOrphaned(id: string): void {
  orphaned.delete(id);
  orphaned.add(id);
  while (orphaned.size > MAX_ORPHANED_ENTRIES) orphaned.delete(orphaned.values().next().value as string);
}

export function forgetDialogEntry(id: unknown): void {
  if (typeof id === 'string') orphaned.delete(id);
}

/** Saute l'entrée atteinte si c'est celle d'un dialogue fermé ; renvoie vrai si un Retour a été relancé. */
export function skipOrphanedDialogEntry(
  state: unknown,
  isMounted: (id: string) => boolean,
  back: () => void,
): boolean {
  const id = state && typeof state === 'object' ? (state as { seenitDialog?: unknown }).seenitDialog : undefined;
  if (typeof id !== 'string' || !orphaned.has(id) || isMounted(id)) return false;
  orphaned.delete(id);
  back();
  return true;
}
