/**
 * SEENIT-PROFILE-007 : origine d'un visionnage, posée sur chaque `episodeRecords[clé]` à l'écriture.
 * - `tvtime` : données historiques importées depuis le CSV TV Time ;
 * - `seenit` : Vu marqué dans SeenIt (bouton, fiche, saison, série) ;
 * - `plex` : lecture Plex synchronisée (heure réelle de lecture).
 * Les anciens enregistrements sans étiquette restent lisibles : `plexImported` vaut Plex, `importedFrom: 'tvtime'`
 * (v1.4.295) vaut TV Time, le reste est d'origine inconnue.
 */
export type ViewingSource = 'tvtime' | 'seenit' | 'plex';

export const VIEWING_SOURCE_TVTIME = 'tvtime' as const;
export const VIEWING_SOURCE_SEENIT = 'seenit' as const;
export const VIEWING_SOURCE_PLEX = 'plex' as const;

export function viewingSourceOf(record: unknown): ViewingSource | null {
  if (!record || typeof record !== 'object') return null;
  const value = record as { source?: unknown; plexImported?: unknown; importedFrom?: unknown };
  if (value.source === 'tvtime' || value.source === 'seenit' || value.source === 'plex') return value.source;
  if (value.plexImported === true) return 'plex';
  if (value.importedFrom === 'tvtime') return 'tvtime';
  return null;
}
