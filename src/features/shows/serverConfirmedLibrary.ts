/**
 * #843 — Dernière bibliothèque confirmée par le serveur Firestore, par compte.
 *
 * Le store Zustand peut encore refléter un cache local (instantané `fromCache`, écritures en attente, ou un
 * instantané plus récent pas encore appliqué) alors qu'un autre appareil a supprimé un titre. Une décision qui
 * doit être autoritative (le raccourci delta Plex) ne lit donc que cette copie : présente seulement quand le
 * dernier instantané reçu du listener temps réel venait du serveur, sans écriture locale en attente.
 */
type LibraryEntry = { tmdbId?: unknown; mediaType?: unknown };

export interface FirestoreSnapshotMetadata {
  fromCache?: boolean;
  hasPendingWrites?: boolean;
}

let confirmed: { uid: string; shows: readonly LibraryEntry[] } | null = null;

export function isServerConfirmedSnapshot(metadata: FirestoreSnapshotMetadata | null | undefined): boolean {
  return metadata?.fromCache === false && metadata.hasPendingWrites !== true;
}

/** Enregistre l'instantané appliqué : confirmé s'il vient du serveur, sinon la copie confirmée est retirée. */
export function recordAppliedLibrarySnapshot(uid: string, shows: readonly LibraryEntry[], metadata: FirestoreSnapshotMetadata | null | undefined): void {
  confirmed = isServerConfirmedSnapshot(metadata) ? { uid, shows } : null;
}

/** Un instantané plus récent est arrivé, ou le listener s'est arrêté : plus rien n'est confirmé. */
export function invalidateServerConfirmedLibrary(): void {
  confirmed = null;
}

export function getServerConfirmedLibrary(uid: string): readonly LibraryEntry[] | null {
  return confirmed && confirmed.uid === uid ? confirmed.shows : null;
}
