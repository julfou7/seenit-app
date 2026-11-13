import { VIEWING_SOURCE_PLEX, viewingSourceOf } from '../history/viewingSource.ts';

/**
 * SEENIT-PLEX-005 (#954) : un film ou épisode déjà vu dans SeenIt mais sans date de visionnage prouvée
 * (import TV Time, film importé sans enregistrement `movie`, heure inconnue) reçoit la date réelle de sa lecture
 * Plex. Un Vu marqué dans SeenIt ou déjà daté par Plex n'est jamais réécrit, et cette date ne donne pas à Plex la
 * propriété de la progression (`plexImported` n'est pas posé).
 */
export function datePlexWatchedRecord(record: unknown, viewedAt: number | null): Record<string, unknown> | null {
  if (viewedAt === null || !Number.isFinite(viewedAt) || viewedAt <= 0) return null;
  const current = record && typeof record === 'object' ? record as Record<string, unknown> : null;
  const source = viewingSourceOf(current);
  if (source === 'seenit') return null;
  // Retour v1.4.302 (journal terrain : « 75 déjà daté (origine inconnue) ») : seule une heure prouvée
  // (`watchedTimeKnown: true`) protège un Vu. Un ancien Vu sans étiquette ni preuve d'heure — souvent l'instant de
  // l'import ou du marquage — reçoit la date prouvée de sa lecture Plex, puis ne bouge plus. Un import TV Time est
  // toujours daté par Plex ; un Vu marqué dans SeenIt ne l'est jamais.
  if (current?.watchedTimeKnown === true && source !== 'tvtime') return null;
  return { ...(current || {}), watchedAt: viewedAt, watchedTimeKnown: true, source: VIEWING_SOURCE_PLEX };
}

/**
 * Retour v1.4.306 : la synchro répare l'index vu d'un titre que SeenIt tient déjà pour vu (statut terminé). Elle ne crée
 * plus jamais un Vu sans enregistrement (15 films « vus » sans date ni origine le 13/11) : il reçoit un enregistrement sans
 * origine ni heure prouvée (dernière date connue du titre), que Plex peut ensuite dater.
 */
export function repairPlexSeenIndex(
  show: { seenEpisodes?: string[]; episodeRecords?: Record<string, unknown>; lastWatchedAt?: number; updatedAt?: number; createdAt?: number },
  key: string,
  now = Date.now()
): { seenEpisodes: string[]; episodeRecords: Record<string, unknown> } {
  const records: Record<string, unknown> = { ...(show.episodeRecords || {}) };
  if (!records[key]) records[key] = { watchedAt: Number(show.lastWatchedAt) || Number(show.updatedAt) || Number(show.createdAt) || now, watchedTimeKnown: false };
  return { seenEpisodes: [...new Set([...(show.seenEpisodes || []), key])], episodeRecords: records };
}

/** Le même titre avec l'enregistrement `key` daté par Plex, ou null s'il n'y a rien à dater. */
export function withPlexDate<T extends { episodeRecords?: Record<string, unknown>; lastWatchedAt?: number; updatedAt?: number }>(show: T, key: string, viewedAt: number | null): T | null {
  const dated = datePlexWatchedRecord(show.episodeRecords?.[key], viewedAt);
  if (!dated || viewedAt === null) return null;
  return { ...show, episodeRecords: { ...(show.episodeRecords || {}), [key]: dated }, lastWatchedAt: Math.max(Number(show.lastWatchedAt) || 0, viewedAt), updatedAt: Date.now() };
}

/** #954 : visionnages lus dans l'historique du compte Plex et non vus explicites, pour le panneau de synchro. */
export function readPlexAccountProgress(stats: unknown): { history: number; unwatched: number; dated: boolean; datedCount: number; mode: string; datingOnly?: number; activity?: number; dateError?: string } | undefined {
  const value = stats && typeof stats === 'object' ? stats as { plexAccountHistoryItems?: unknown; plexAccountCurrentUnwatched?: unknown; plexAccountHistoryMode?: unknown; plexAccountHistoryDated?: unknown; plexAccountHistoryDateError?: unknown; plexAccountHistoryDatingOnly?: unknown; plexAccountActivityItems?: unknown } : null;
  const history = Number(value?.plexAccountHistoryItems) || 0;
  if (history <= 0) return undefined;
  const dated = Number(value?.plexAccountHistoryDated) > 0 || value?.plexAccountHistoryMode === 'dated' || value?.plexAccountHistoryMode === 'activity';
  const dateError = typeof value?.plexAccountHistoryDateError === 'string' && value.plexAccountHistoryDateError ? value.plexAccountHistoryDateError : undefined;
  const datingOnly = Number(value?.plexAccountHistoryDatingOnly) || 0;
  // Retour v1.4.304 : visionnages connus du seul fil Activité (avant le filtre par bibliothèque).
  const activity = Number(value?.plexAccountActivityItems) || 0;
  return { history, unwatched: Number(value?.plexAccountCurrentUnwatched) || 0, dated, datedCount: Number(value?.plexAccountHistoryDated) || 0, mode: typeof value?.plexAccountHistoryMode === 'string' ? value.plexAccountHistoryMode : 'inconnu', ...(datingOnly > 0 ? { datingOnly } : {}), ...(activity > 0 ? { activity } : {}), ...(dateError ? { dateError } : {}) };
}

/** #954 diagnostic : pourquoi un Vu déjà connu n'a pas reçu de date Plex, pour la ligne de bilan. */
export function describePlexDatingSkip(title: unknown, record: unknown, viewedAt: number | null): string {
  const current = record && typeof record === 'object' ? record as Record<string, unknown> : null;
  const source = viewingSourceOf(current);
  const reason = viewedAt === null ? 'sans date Plex prouvée' : source === 'seenit' ? 'Vu SeenIt' : `heure déjà prouvée (${source || 'origine inconnue'})`;
  return `${typeof title === 'string' && title ? title : 'Titre'} : ${reason}`;
}

/** Résumé compact des Vus non datés : compte par raison puis quelques titres, pour tenir dans une ligne de journal. */
export function summarizePlexDatingSkips(skips: readonly string[], limit = 12): string {
  if (!skips.length) return '';
  const byReason = new Map<string, number>();
  for (const skip of skips) { const reason = skip.slice(skip.lastIndexOf(' : ') + 3); byReason.set(reason, (byReason.get(reason) || 0) + 1); }
  const counts = [...byReason].map(([reason, count]) => `${count} ${reason}`).join(', ');
  const examples = [...new Set(skips)].slice(0, limit).join(' ; ');
  return ` Non datés : ${counts} — ${examples}${skips.length > limit ? ' ; …' : ''}`;
}
