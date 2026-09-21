import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  classifyClientOperationalLog,
  normalizeClientOperationalSignalBatch,
} from '../src/features/logging/clientOperationalSignals.ts';

test('SEENIT-OBSERVABILITY-001 classe uniquement les erreurs client actionnables', () => {
  assert.equal(
    classifyClientOperationalLog(
      'sync',
      'error',
      '[showsStore] ❌ Erreur sauvegarde Cloud Firestore: permission-denied'
    ),
    'FIRESTORE_CLIENT_SYNC_FAILED'
  );
  assert.equal(
    classifyClientOperationalLog('sync', 'warn', '[showsStore] Realtime listener interrompu'),
    'FIRESTORE_CLIENT_SYNC_FAILED'
  );
  assert.equal(
    classifyClientOperationalLog('sync', 'warn', '[Downloads Sync] Écoute Firestore interrompue'),
    'DOWNLOAD_CLIENT_SYNC_FAILED'
  );
  assert.equal(
    classifyClientOperationalLog('system', 'warn', 'PushNotifications registration error'),
    'NOTIFICATION_CLIENT_FAILED'
  );
  assert.equal(
    classifyClientOperationalLog('system', 'error', 'Erreur lors de la recherche de mise à jour: réseau'),
    'APP_UPDATE_CLIENT_FAILED'
  );

  assert.equal(
    classifyClientOperationalLog('system', 'warn', 'Notification permission not granted.'),
    null
  );
  assert.equal(
    classifyClientOperationalLog('system', 'warn', 'Retry réussi immédiatement'),
    null
  );
  assert.equal(
    classifyClientOperationalLog('auth', 'warn', '[showsStore] fetchShows ignoré car aucun utilisateur n’est connecté'),
    null
  );
});

test('SEENIT-OBSERVABILITY-001 borne et valide le lot client avant Cloud Logging', () => {
  assert.deepEqual(
    normalizeClientOperationalSignalBatch({
      schemaVersion: 1,
      signals: [
        { code: 'NOTIFICATION_CLIENT_FAILED', count: 2 },
        { code: 'NOTIFICATION_CLIENT_FAILED', count: 3 },
        { code: 'CACHE_CLIENT_STORAGE_FAILED', count: 1 },
      ],
    }),
    [
      { code: 'NOTIFICATION_CLIENT_FAILED', count: 5 },
      { code: 'CACHE_CLIENT_STORAGE_FAILED', count: 1 },
    ]
  );

  assert.equal(
    normalizeClientOperationalSignalBatch({
      schemaVersion: 1,
      signals: [{ code: 'UNKNOWN_CLIENT_SIGNAL', count: 1 }],
    }),
    null
  );
  assert.equal(
    normalizeClientOperationalSignalBatch({
      schemaVersion: 1,
      signals: [{ code: 'APP_UPDATE_CLIENT_FAILED', count: 51 }],
    }),
    null
  );
});

test('SEENIT-OBSERVABILITY-001 agrège localement sans appel réseau par warning', () => {
  const diagnostics = fs.readFileSync(
    'src/features/logging/clientOperationalDiagnostics.ts',
    'utf8'
  );
  const recordFunction = diagnostics.match(
    /export function recordClientOperationalSignal[\s\S]*?\n}/
  )?.[0] || '';

  assert.match(diagnostics, /CLIENT_OPERATIONAL_SIGNAL_FLUSH_COOLDOWN_MS = 30 \* 60_000/);
  assert.match(diagnostics, /\/api\/diagnostics\/client-signals/);
  assert.doesNotMatch(recordFunction, /fetch\s*\(/);

  const server = fs.readFileSync('server.ts', 'utf8');
  assert.match(
    server,
    /app\.post\([\s\S]*'\/api\/diagnostics\/client-signals'[\s\S]*requireAuth[\s\S]*rateLimit\('client-operational-signals', 4, 60 \* 60_000\)/
  );
  assert.match(server, /normalizeClientOperationalSignalBatch\(req\.body\)/);
});
