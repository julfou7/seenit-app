/**
 * SEENIT-PLEX-012 — décision du propriétaire du 13/11 : la synchro Plex automatique ne se relance pas en permanence,
 * au plus une fois toutes les 6 h après une synchro réussie. Les boutons « Synchro rapide » et « Complète » restent
 * immédiats.
 */
export const PLEX_AUTO_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Après un essai automatique sans succès, attente avant le suivant (le délai de reprise du backend prime). */
export const PLEX_AUTO_SYNC_RETRY_MS = 60 * 60 * 1000;
