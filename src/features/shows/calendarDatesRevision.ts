/**
 * #407 — Révision des dates calendaires d'une série enregistrée. Avant la v1.4.267, les dates TMDB de
 * certains réseaux (Paramount+, HBO, Apple TV+…) étaient décalées de +1 jour avant d'être copiées dans la
 * bibliothèque (`nextEpisodeToAir`, progression de saison). La révision 2 marque une série resynchronisée
 * avec les dates canoniques ; une série plus ancienne est resynchronisée une fois, même si son prochain
 * épisode (décalé) paraît encore futur.
 */
export const CALENDAR_DATES_REVISION = 2;

/** Champ facultatif d'un document de série (absent avant la v1.4.269). */
export function needsCalendarDatesRefresh(show: object): boolean {
  const revision = (show as { calendarDatesRevision?: unknown }).calendarDatesRevision;
  return (Number(revision) || 0) < CALENDAR_DATES_REVISION;
}
