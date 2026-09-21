export const CLIENT_OPERATIONAL_SIGNAL_METADATA = {
  FIRESTORE_CLIENT_SYNC_FAILED: { domain: 'firestore' },
  NOTIFICATION_CLIENT_FAILED: { domain: 'notifications' },
  DOWNLOAD_CLIENT_SYNC_FAILED: { domain: 'downloads' },
  APP_UPDATE_CLIENT_FAILED: { domain: 'release' },
  CACHE_CLIENT_STORAGE_FAILED: { domain: 'cache' },
} as const;

export type ClientOperationalSignalCode = keyof typeof CLIENT_OPERATIONAL_SIGNAL_METADATA;

export const CLIENT_OPERATIONAL_SIGNAL_CODES = Object.freeze(
  Object.keys(CLIENT_OPERATIONAL_SIGNAL_METADATA) as ClientOperationalSignalCode[]
);
export const CLIENT_OPERATIONAL_SIGNAL_MAX_COUNT = 50;
export const CLIENT_OPERATIONAL_SIGNAL_MAX_CODES = CLIENT_OPERATIONAL_SIGNAL_CODES.length;

export interface ClientOperationalSignalBatchItem {
  code: ClientOperationalSignalCode;
  count: number;
}

export interface ClientOperationalSignalBatch {
  schemaVersion: 1;
  signals: ClientOperationalSignalBatchItem[];
}

export function classifyClientOperationalLog(
  category: string,
  level: string,
  message: string
): ClientOperationalSignalCode | null {
  if (level !== 'warn' && level !== 'error') return null;
  const text = String(message || '');

  if (
    category === 'sync'
    && (
      (
        level === 'error'
        && (
          text.startsWith('[showsStore] ❌ Erreur sauvegarde Cloud Firestore')
          || text.startsWith('[showsStore] Erreur fatale lors de fetchShows')
        )
      )
      || text.startsWith('[showsStore] Realtime listener')
      || text.startsWith('[showsStore] Firestore quota exhausted')
    )
  ) {
    return 'FIRESTORE_CLIENT_SYNC_FAILED';
  }

  if (category === 'sync' && text.startsWith('[Downloads Sync]')) {
    return 'DOWNLOAD_CLIENT_SYNC_FAILED';
  }

  if (
    category === 'system'
    && (
      text.startsWith('LocalNotifications native schedule failed')
      || text.startsWith('PushNotifications registration error')
      || text.startsWith('Error in requestNotificationPermission')
    )
  ) {
    return 'NOTIFICATION_CLIENT_FAILED';
  }

  if (
    category === 'system'
    && level === 'error'
    && text.startsWith('Erreur lors de la recherche de mise à jour')
  ) {
    return 'APP_UPDATE_CLIENT_FAILED';
  }

  return null;
}

export function normalizeClientOperationalSignalBatch(
  value: unknown
): ClientOperationalSignalBatchItem[] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as { schemaVersion?: unknown; signals?: unknown };
  if (candidate.schemaVersion !== 1 || !Array.isArray(candidate.signals)) return null;
  if (
    candidate.signals.length === 0
    || candidate.signals.length > CLIENT_OPERATIONAL_SIGNAL_MAX_CODES
  ) return null;

  const merged = new Map<ClientOperationalSignalCode, number>();
  for (const raw of candidate.signals) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const item = raw as { code?: unknown; count?: unknown };
    const code = String(item.code || '') as ClientOperationalSignalCode;
    if (!(code in CLIENT_OPERATIONAL_SIGNAL_METADATA)) return null;
    const count = Number(item.count);
    if (!Number.isInteger(count) || count < 1 || count > CLIENT_OPERATIONAL_SIGNAL_MAX_COUNT) {
      return null;
    }
    merged.set(
      code,
      Math.min(CLIENT_OPERATIONAL_SIGNAL_MAX_COUNT, (merged.get(code) || 0) + count)
    );
  }

  return [...merged.entries()].map(([code, count]) => ({ code, count }));
}
