import type { Show } from '../../types';
import { useToastStore } from '../../store/toastStore';
import { type InactivityArchiveFields, inactivityReArchivePatch, inactivityRestorePatch, isInactivityArchive } from './seriesRevival.ts';

type UpdateShow = (id: string, updates: Partial<Show>) => Promise<unknown>;

/**
 * Retour du 27/11 (SEENIT-DATA-008) — seule action « Désarchiver » d'une série rangée pour inactivité, partagée par
 * l'actualité « ARCHIVÉE », l'action de la notification et la fiche : la progression reste intacte, un toast
 * propose d'annuler, et la série n'est pas réarchivée par la synchronisation suivante.
 */
export async function restoreInactivityArchive(target: Show | null | undefined, updateShow: UpdateShow): Promise<boolean> {
  const show = target as (Omit<Show, 'archiveSource'> & InactivityArchiveFields) | null | undefined;
  if (!show?.id || !isInactivityArchive(show)) return false;
  const previous = { ...show };
  // `archiveSource: 'inactivity'` et `inactivityArchivedAt` sont posés par la passe de masse, hors du type `Show`.
  await updateShow(show.id, inactivityRestorePatch(show) as Partial<Show>);
  useToastStore.getState().showToast(`« ${show.title} » est de retour dans ta liste.`, 'success', target, async () => {
    await updateShow(previous.id, inactivityReArchivePatch(previous) as unknown as Partial<Show>);
  });
  return true;
}
