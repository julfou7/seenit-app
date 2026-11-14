import { readUserScopedJson, writeUserScopedJson } from './userIsolation.ts';

/**
 * Retour terrain v1.4.308 : les délais des synchronisations automatiques (12 h pour les métadonnées, 1 h après un essai
 * Plex sans succès) n'étaient gardés qu'en mémoire et repartaient de zéro à chaque lancement de l'app, qui relançait donc
 * tout à chaque ouverture. Ils sont désormais mémorisés par compte.
 */
export type AutoSyncKind = 'details' | 'plex';

const FIELD = 'auto_sync_runs_v1';

type Runs = Partial<Record<AutoSyncKind, number>>;

export function readAutoSyncRun(uid: string | null | undefined, kind: AutoSyncKind): number | undefined {
  const value = Number(readUserScopedJson<Runs>(uid, FIELD, {})?.[kind]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export function writeAutoSyncRun(uid: string | null | undefined, kind: AutoSyncKind, at = Date.now()): void {
  writeUserScopedJson(uid, FIELD, { ...readUserScopedJson<Runs>(uid, FIELD, {}), [kind]: at });
}

/** Dernier passage connu : le plus récent entre la mémoire de la session et le dernier lancement mémorisé. */
export function lastAutoSyncRun(uid: string | null | undefined, kind: AutoSyncKind, inMemory?: number): number | undefined {
  const latest = Math.max(inMemory ?? 0, readAutoSyncRun(uid, kind) ?? 0);
  return latest > 0 ? latest : undefined;
}
