import { resolveSeenItApiUrl } from '../../lib/seenitApi.ts';
import {
  CLIENT_OPERATIONAL_SIGNAL_CODES,
  CLIENT_OPERATIONAL_SIGNAL_MAX_COUNT,
  type ClientOperationalSignalCode,
} from './clientOperationalSignals.ts';

export const CLIENT_OPERATIONAL_SIGNAL_FLUSH_COOLDOWN_MS = 30 * 60_000;
const CLIENT_OPERATIONAL_SIGNAL_STORAGE_PREFIX = 'seenit_client_operational_signals_v1:';
const CLIENT_OPERATIONAL_SIGNAL_PERSIST_DELAY_MS = 500;
const CLIENT_OPERATIONAL_SIGNAL_LOCAL_MAX_COUNT = 500;

interface PersistedClientOperationalSignals {
  version: 1;
  lastAttemptAt: number;
  counts: Partial<Record<ClientOperationalSignalCode, number>>;
}

let activeStorageKey: string | null = null;
let currentState: PersistedClientOperationalSignals = createEmptyState();
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let flushInFlight: Promise<boolean> | null = null;

function createEmptyState(): PersistedClientOperationalSignals {
  return { version: 1, lastAttemptAt: 0, counts: {} };
}

function getStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function sanitizeState(value: unknown): PersistedClientOperationalSignals {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return createEmptyState();
  const candidate = value as Partial<PersistedClientOperationalSignals>;
  const counts: Partial<Record<ClientOperationalSignalCode, number>> = {};
  const rawCounts = candidate.counts && typeof candidate.counts === 'object' ? candidate.counts : {};
  for (const code of CLIENT_OPERATIONAL_SIGNAL_CODES) {
    const count = Number((rawCounts as Record<string, unknown>)[code]);
    if (Number.isFinite(count) && count > 0) {
      counts[code] = Math.min(CLIENT_OPERATIONAL_SIGNAL_LOCAL_MAX_COUNT, Math.floor(count));
    }
  }
  const lastAttemptAt = Number(candidate.lastAttemptAt);
  return {
    version: 1,
    lastAttemptAt: Number.isFinite(lastAttemptAt) && lastAttemptAt > 0 ? lastAttemptAt : 0,
    counts,
  };
}

function loadState(storageKey: string | null): PersistedClientOperationalSignals {
  if (!storageKey) return createEmptyState();
  const storage = getStorage();
  if (!storage) return createEmptyState();
  try {
    const raw = storage.getItem(storageKey);
    return raw ? sanitizeState(JSON.parse(raw)) : createEmptyState();
  } catch {
    return createEmptyState();
  }
}

function cancelPersistTimer(): void {
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
}

function persistState(): void {
  cancelPersistTimer();
  if (!activeStorageKey) return;
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(activeStorageKey, JSON.stringify(currentState));
  } catch {
    // Le diagnostic ne doit jamais perturber le parcours utilisateur.
  }
}

function schedulePersist(): void {
  if (persistTimer !== null) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistState();
  }, CLIENT_OPERATIONAL_SIGNAL_PERSIST_DELAY_MS);
}

function pendingSignalCount(): number {
  return CLIENT_OPERATIONAL_SIGNAL_CODES.reduce(
    (sum, code) => sum + Math.max(0, Number(currentState.counts[code] || 0)),
    0
  );
}

export function activateClientOperationalSignalScope(uid?: string | null): void {
  persistState();
  const normalizedUid = String(uid || '').trim();
  activeStorageKey = normalizedUid
    ? `${CLIENT_OPERATIONAL_SIGNAL_STORAGE_PREFIX}${normalizedUid}`
    : null;
  currentState = loadState(activeStorageKey);
}

export function recordClientOperationalSignal(code: ClientOperationalSignalCode): void {
  if (!activeStorageKey || !CLIENT_OPERATIONAL_SIGNAL_CODES.includes(code)) return;
  const current = Number(currentState.counts[code] || 0);
  currentState.counts[code] = Math.min(CLIENT_OPERATIONAL_SIGNAL_LOCAL_MAX_COUNT, current + 1);
  schedulePersist();
}

export async function flushClientOperationalSignals(
  idToken: string,
  options: { now?: number; fetchImpl?: typeof fetch } = {}
): Promise<boolean> {
  if (flushInFlight) return flushInFlight;
  if (!activeStorageKey || pendingSignalCount() === 0 || idToken.length < 20) return false;

  const now = options.now ?? Date.now();
  if (now - currentState.lastAttemptAt < CLIENT_OPERATIONAL_SIGNAL_FLUSH_COOLDOWN_MS) return false;

  const snapshot = CLIENT_OPERATIONAL_SIGNAL_CODES
    .map(code => ({
      code,
      count: Math.min(
        CLIENT_OPERATIONAL_SIGNAL_MAX_COUNT,
        Math.max(0, Math.floor(Number(currentState.counts[code] || 0)))
      ),
    }))
    .filter(item => item.count > 0);

  if (snapshot.length === 0) return false;
  currentState.lastAttemptAt = now;
  persistState();

  const fetchImpl = options.fetchImpl || fetch;
  flushInFlight = (async () => {
    try {
      const response = await fetchImpl(resolveSeenItApiUrl('/api/diagnostics/client-signals'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ schemaVersion: 1, signals: snapshot }),
      });
      if (!response.ok) return false;

      for (const item of snapshot) {
        const remaining = Math.max(0, Number(currentState.counts[item.code] || 0) - item.count);
        if (remaining > 0) currentState.counts[item.code] = remaining;
        else delete currentState.counts[item.code];
      }
      persistState();
      return true;
    } catch {
      return false;
    } finally {
      flushInFlight = null;
    }
  })();

  return flushInFlight;
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', persistState);
}
