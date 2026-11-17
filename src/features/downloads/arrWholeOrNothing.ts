/**
 * Retour terrain du 17/11 (Programmés et Téléchargés, Sonarr/Radarr injoignables : « j'ai une liste incomplète, je ne
 * sais pas d'où elle sort ; je préférerais avoir tout ou rien »). Cause : une synchronisation en échec remplaçait la
 * dernière liste complète par une liste vide, et seules les demandes propres à SeenIt restaient affichées.
 *
 * Règle : une lecture en échec ne remplace jamais la dernière liste complète. Elle est gardée en entier, datée de sa
 * synchronisation (`staleAt`) ; sans liste complète connue, rien n'est montré (`items` vide, aucune carte partielle).
 */
export interface ArrList { items: readonly unknown[]; failures: string[]; staleAt?: number }

export function wholeOrNothing<T extends ArrList>(fresh: T | null, previous: T | null | undefined, previousSyncedAt?: number): T | null {
  if (!fresh) return fresh;
  if (!fresh.failures.length) return { ...fresh, staleAt: undefined };
  // Dernière liste complète connue (synchronisée sans échec, ou déjà gardée telle quelle) : elle est conservée en entier.
  if (previous && (!previous.failures.length || previous.staleAt !== undefined)) {
    const staleAt = previous.staleAt ?? previousSyncedAt;
    if (staleAt !== undefined) return { ...previous, failures: fresh.failures, staleAt };
  }
  return { ...fresh, items: [] as unknown as T['items'], staleAt: undefined };
}

/** Phrase sous le titre de la section quand Sonarr/Radarr ne répondent pas. */
export function arrUnavailableNote(failures: readonly string[], staleAt: number | undefined, now = Date.now()): string {
  const who = failures.join(' et ');
  const plural = failures.length > 1 || failures.some(name => name.includes('/'));
  const head = `${who} ${plural ? 'injoignables' : 'injoignable'} pour l’instant`;
  if (staleAt === undefined) return `${head} : liste indisponible.`;
  const at = new Date(staleAt);
  const sameDay = new Date(now).toDateString() === at.toDateString();
  const time = at.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${head} : dernier état connu ${sameDay ? `à ${time}` : `du ${at.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} à ${time}`}.`;
}
