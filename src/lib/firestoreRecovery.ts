export const FIRESTORE_RECOVERY_WINDOW_MS = 5 * 60 * 1000;
export const FIRESTORE_RECOVERY_STORAGE_KEY = 'seenit_firestore_recovery_v1';
export const FIRESTORE_RECOVERY_DIAGNOSTIC_ID = 'seenit-firestore-recovery-diagnostic';

export type FirestoreRecoveryPhase = 'prepare' | 'reload' | 'failed';
export type FirestoreRecoveryDecision = 'attempt' | 'follow' | 'stop';

export interface FirestoreRecoveryConfig {
  projectId: string;
  databaseId: string;
}

export interface FirestoreRecoveryState extends FirestoreRecoveryConfig {
  version: 1;
  attemptId: string;
  startedAt: number;
  phase: FirestoreRecoveryPhase;
}

export interface IndexedDbDatabaseInfoLike {
  name?: string;
}

export function buildFirestoreIndexedDbName(
  projectId: string,
  databaseId: string,
  persistenceKey = '[DEFAULT]'
): string {
  const databaseSegment = databaseId === '(default)'
    ? projectId
    : `${projectId}.${databaseId}`;
  return `firestore/${persistenceKey}/${databaseSegment}/main`;
}

export function selectCurrentFirestoreDatabaseNames(
  databases: IndexedDbDatabaseInfoLike[],
  config: FirestoreRecoveryConfig
): string[] {
  const expected = buildFirestoreIndexedDbName(config.projectId, config.databaseId);
  return databases
    .map(database => database.name)
    .filter((name): name is string => name === expected);
}

export function parseFirestoreRecoveryState(raw: string | null): FirestoreRecoveryState | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<FirestoreRecoveryState>;
    if (
      value.version !== 1 ||
      typeof value.projectId !== 'string' ||
      typeof value.databaseId !== 'string' ||
      typeof value.attemptId !== 'string' ||
      typeof value.startedAt !== 'number' ||
      !['prepare', 'reload', 'failed'].includes(String(value.phase))
    ) {
      return null;
    }
    return value as FirestoreRecoveryState;
  } catch {
    return null;
  }
}

export function decideFirestoreRecovery(
  existing: FirestoreRecoveryState | null,
  now: number,
  config: FirestoreRecoveryConfig
): FirestoreRecoveryDecision {
  if (!existing) return 'attempt';
  if (existing.projectId !== config.projectId || existing.databaseId !== config.databaseId) {
    return 'attempt';
  }
  if (now - existing.startedAt >= FIRESTORE_RECOVERY_WINDOW_MS) {
    return 'attempt';
  }
  return existing.phase === 'prepare' ? 'follow' : 'stop';
}

export function isFirestoreIndexedDbCorruption(reason: unknown): boolean {
  const message = typeof reason === 'string'
    ? reason
    : typeof (reason as { message?: unknown } | null)?.message === 'string'
      ? String((reason as { message: string }).message)
      : '';
  return message.includes('INTERNAL ASSERTION FAILED');
}

function sameRecoveryTarget(
  state: FirestoreRecoveryState | null,
  config: FirestoreRecoveryConfig
): state is FirestoreRecoveryState {
  return Boolean(
    state &&
    state.projectId === config.projectId &&
    state.databaseId === config.databaseId
  );
}

function createAttemptId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function showRecoveryDiagnostic(
  documentRef: Document,
  message: string,
  isError = false
): void {
  let element = documentRef.getElementById(FIRESTORE_RECOVERY_DIAGNOSTIC_ID);
  if (!element) {
    element = documentRef.createElement('div');
    element.id = FIRESTORE_RECOVERY_DIAGNOSTIC_ID;
    element.setAttribute('aria-live', 'assertive');
    element.style.cssText = [
      'position:fixed',
      'left:16px',
      'right:16px',
      'top:max(16px, env(safe-area-inset-top))',
      'z-index:2147483647',
      'padding:14px 16px',
      'border-radius:16px',
      'background:#17171b',
      'border:1px solid rgba(229,169,61,.45)',
      'box-shadow:0 16px 50px rgba(0,0,0,.55)',
      'color:#f5f5f7',
      'font:600 14px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'
    ].join(';');
    (documentRef.body || documentRef.documentElement).appendChild(element);
  }
  element.setAttribute('role', isError ? 'alert' : 'status');
  element.textContent = message;
}

function readSharedState(storage: Storage): FirestoreRecoveryState | null {
  try {
    return parseFirestoreRecoveryState(storage.getItem(FIRESTORE_RECOVERY_STORAGE_KEY));
  } catch {
    return null;
  }
}

function writeSharedState(storage: Storage, state: FirestoreRecoveryState): boolean {
  try {
    storage.setItem(FIRESTORE_RECOVERY_STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

async function resolveCurrentDatabaseNames(
  factory: IDBFactory,
  config: FirestoreRecoveryConfig
): Promise<string[]> {
  const expected = buildFirestoreIndexedDbName(config.projectId, config.databaseId);
  const listDatabases = (factory as IDBFactory & { databases?: () => Promise<IndexedDbDatabaseInfoLike[]> }).databases;
  if (typeof listDatabases !== 'function') return [expected];
  try {
    const databases = await listDatabases.call(factory);
    const exact = selectCurrentFirestoreDatabaseNames(databases, config);
    return exact.length > 0 ? exact : [expected];
  } catch {
    return [expected];
  }
}

function deleteIndexedDbDatabase(
  factory: IDBFactory,
  name: string,
  timeoutMs = 5000
): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(false), timeoutMs);
    try {
      const request = factory.deleteDatabase(name);
      request.onsuccess = () => finish(true);
      request.onerror = () => finish(false);
      request.onblocked = () => {
        // Les autres onglets reçoivent d'abord le signal prepare et libèrent Firestore.
        // On laisse la requête ouverte jusqu'au succès ou au timeout borné.
      };
    } catch {
      finish(false);
    }
  });
}

export interface InstallFirestoreRecoveryOptions extends FirestoreRecoveryConfig {
  terminateFirestore: () => Promise<unknown>;
  windowRef?: Window;
  documentRef?: Document;
  indexedDbFactory?: IDBFactory;
  storage?: Storage;
  now?: () => number;
  reload?: () => void;
}

export function installFirestoreIndexedDbRecovery(
  options: InstallFirestoreRecoveryOptions
): () => void {
  const windowRef = options.windowRef ?? window;
  const documentRef = options.documentRef ?? document;
  const factory = options.indexedDbFactory ?? indexedDB;
  const storage = options.storage ?? windowRef.localStorage;
  const now = options.now ?? (() => Date.now());
  const reload = options.reload ?? (() => windowRef.location.reload());
  const config: FirestoreRecoveryConfig = {
    projectId: options.projectId,
    databaseId: options.databaseId
  };
  let followerTerminated = false;
  let handling = false;

  const terminateSafely = async () => {
    if (followerTerminated) return;
    followerTerminated = true;
    await options.terminateFirestore().catch(() => undefined);
  };

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== FIRESTORE_RECOVERY_STORAGE_KEY) return;
    const state = parseFirestoreRecoveryState(event.newValue);
    if (!sameRecoveryTarget(state, config)) return;

    if (state.phase === 'prepare') {
      showRecoveryDiagnostic(
        documentRef,
        'SeenIt répare le cache Firestore dans un autre onglet. Cet onglet attend la fin de la réparation…'
      );
      void terminateSafely();
    } else if (state.phase === 'reload') {
      showRecoveryDiagnostic(documentRef, 'Cache Firestore réparé. SeenIt redémarre…');
      windowRef.setTimeout(reload, 250);
    } else {
      showRecoveryDiagnostic(
        documentRef,
        'La réparation du cache Firestore n’a pas pu se terminer. Ferme les autres onglets SeenIt puis relance l’application.',
        true
      );
    }
  };

  const handleUnhandledRejection = async (event: PromiseRejectionEvent) => {
    if (handling || !isFirestoreIndexedDbCorruption(event.reason)) return;
    handling = true;
    event.preventDefault();

    const existing = readSharedState(storage);
    const decision = decideFirestoreRecovery(existing, now(), config);

    if (decision === 'stop') {
      showRecoveryDiagnostic(
        documentRef,
        'SeenIt a déjà tenté de réparer le cache Firestore. Le redémarrage automatique est interrompu pour éviter une boucle. Ferme puis rouvre l’application ; sur le Web, ferme aussi les autres onglets SeenIt.',
        true
      );
      handling = false;
      return;
    }

    if (decision === 'follow') {
      showRecoveryDiagnostic(
        documentRef,
        'SeenIt répare le cache Firestore dans un autre onglet. Cet onglet attend la fin de la réparation…'
      );
      await terminateSafely();
      handling = false;
      return;
    }

    const attempt: FirestoreRecoveryState = {
      version: 1,
      ...config,
      attemptId: createAttemptId(),
      startedAt: now(),
      phase: 'prepare'
    };

    const shared = writeSharedState(storage, attempt);
    if (shared) {
      await Promise.resolve();
      const winner = readSharedState(storage);
      if (!winner || winner.attemptId !== attempt.attemptId) {
        showRecoveryDiagnostic(
          documentRef,
          'SeenIt répare le cache Firestore dans un autre onglet. Cet onglet attend la fin de la réparation…'
        );
        await terminateSafely();
        handling = false;
        return;
      }
    }

    showRecoveryDiagnostic(
      documentRef,
      'SeenIt a détecté un problème dans le cache Firestore local. Réparation sécurisée en cours…'
    );

    await terminateSafely();
    // Laisse aux autres onglets le temps de recevoir le signal localStorage et de libérer leur connexion.
    await new Promise(resolve => windowRef.setTimeout(resolve, 150));

    const names = await resolveCurrentDatabaseNames(factory, config);
    const results = await Promise.all(names.map(name => deleteIndexedDbDatabase(factory, name)));
    const repaired = results.every(Boolean);

    if (!repaired) {
      const failed: FirestoreRecoveryState = { ...attempt, phase: 'failed' };
      writeSharedState(storage, failed);
      showRecoveryDiagnostic(
        documentRef,
        'La réparation du cache Firestore n’a pas pu se terminer. Ferme les autres onglets SeenIt puis relance l’application.',
        true
      );
      handling = false;
      return;
    }

    const completed: FirestoreRecoveryState = { ...attempt, phase: 'reload' };
    writeSharedState(storage, completed);
    showRecoveryDiagnostic(documentRef, 'Cache Firestore réparé. SeenIt redémarre…');
    windowRef.setTimeout(reload, 700);
  };

  windowRef.addEventListener('storage', handleStorage);
  windowRef.addEventListener('unhandledrejection', handleUnhandledRejection);

  return () => {
    windowRef.removeEventListener('storage', handleStorage);
    windowRef.removeEventListener('unhandledrejection', handleUnhandledRejection);
  };
}
