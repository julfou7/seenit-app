import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { collectFraction, formatCompactCount, overallPlexPercent, serverStatusLabel } from '../src/features/plex/plexSyncProgressModel.ts';
import { createPlexSyncProgressReporter } from '../src/features/runtime/plexSyncProgressReporter.ts';
import { mapOrderedWithConcurrency } from '../src/features/runtime/orderedConcurrency.ts';
import { describeBackendNetworkFailure, executeBackendAttempts, isBackendTimeoutError } from '../src/lib/nativeBackendRetry.ts';

test('SEENIT-PLEX-012 calcule un vrai pourcentage, jamais inventé, qui ne recule pas', () => {
  assert.equal(overallPlexPercent({ phase: 'collect', processed: 0 }), undefined, 'collecte sans avancement publié : pas de %');
  assert.equal(overallPlexPercent({ phase: 'collect', processed: 0, collectPercent: 50 }), 35, 'la collecte vaut 70 % du total');
  assert.equal(overallPlexPercent({ phase: 'watched', processed: 50, total: 100 }), 81);
  assert.equal(overallPlexPercent({ phase: 'watchlist', processed: 1, total: 2 }), 93);
  assert.equal(overallPlexPercent({ phase: 'done', processed: 0 }), 100);
  assert.equal(overallPlexPercent({ phase: 'error', processed: 0 }), undefined);

  const base = { state: 'running' as const, accountDone: 3, accountTotal: 3, enrichDone: 0, enrichTotal: 0 };
  const servers = [{ id: 'a', name: 'A', owned: true, state: 'scanning' as const, done: 500, total: 1000 }, { id: 'b', name: 'B', owned: false, state: 'skipped' as const, done: 0, total: 0 }, { id: 'c', name: 'C', owned: false, state: 'scanning' as const, done: 40, total: 0 }];
  assert.ok(Math.abs(collectFraction({ ...base, servers }) - (0.15 + 0.7 * (0.5 + 1 + 0) / 3)) < 1e-9, 'serveur sans total connu : 0, jamais estimé');
  assert.equal(collectFraction({ ...base, state: 'done', servers }), 1);

  assert.equal(formatCompactCount(842), '842');
  assert.equal(formatCompactCount(1234), '1,2 k');
  assert.equal(formatCompactCount(25_000), '25 k');
  assert.equal(serverStatusLabel({ watchedItems: 1234 }), '1,2 k vus');
  assert.equal(serverStatusLabel({ reason: 'hors ligne ou délai dépassé' }), 'hors ligne');
  assert.equal(serverStatusLabel({ reason: 'inaccessible' }), 'inaccessible');
  assert.equal(serverStatusLabel({ state: 'scanning', done: 30, total: 100 }), '30 %');
  assert.equal(serverStatusLabel({ state: 'scanning', done: 30, total: 0 }), 'en cours');
});

test('SEENIT-PLEX-012 publie l’avancement au plus toutes les 1,5 s, après 2 s, sans jamais reculer', () => {
  let clock = 0;
  const writes: Array<{ percent: number; state: string; servers: Array<{ state: string }> }> = [];
  const timers: Array<{ at: number; run: () => void; cancelled: boolean }> = [];
  const reporter = createPlexSyncProgressReporter({ syncId: 'sync-12345678', mode: 'full', now: () => clock, write: async doc => { writes.push(doc); }, schedule: (run, delay) => { const timer = { at: clock + delay, run, cancelled: false }; timers.push(timer); return { cancel: () => { timer.cancelled = true; } }; } });
  const advance = (ms: number) => { clock += ms; for (const timer of timers.filter(entry => !entry.cancelled && entry.at <= clock)) { timer.cancelled = true; timer.run(); } };
  reporter.accountStep();
  reporter.setServers([{ id: 'a', name: 'A', owned: true }, { id: 'b', name: 'B', owned: false }]);
  assert.equal(writes.length, 0, 'aucune écriture avant 2 s (une delta rapide reste sans écriture)');
  advance(2000);
  assert.equal(writes.length, 1);
  reporter.serverScanning('a');
  reporter.serverItems('a', 300, 1000);
  advance(500);
  assert.equal(writes.length, 1, 'regroupé : pas plus d’une écriture par 1,5 s');
  advance(1000);
  assert.equal(writes.length, 2);
  const before = writes[1].percent;
  reporter.serverRestart('a');
  advance(1500);
  assert.ok(writes[2].percent >= before, 'une connexion relancée ne fait pas reculer le pourcentage');
  reporter.serverSkipped('b', 'hors ligne ou délai dépassé');
  reporter.finish();
  const last = writes.at(-1)!;
  assert.equal(last.state, 'done');
  assert.equal(last.percent, 100);
  reporter.serverItems('a', 10);
  advance(5000);
  assert.equal(writes.at(-1), last, 'plus rien après la fin');

  const silent: unknown[] = [];
  const quick = createPlexSyncProgressReporter({ syncId: 'sync-quick-1', mode: 'delta', now: () => 0, write: async doc => { silent.push(doc); }, schedule: () => ({ cancel: () => {} }) });
  quick.accountStep();
  quick.finish();
  assert.equal(silent.length, 0, 'une delta finie en moins de 2 s n’écrit rien');
  const anonymous: unknown[] = [];
  const noId = createPlexSyncProgressReporter({ syncId: null, mode: 'full', now: () => 10_000, write: async doc => { anonymous.push(doc); } });
  noId.accountStep();
  noId.finish();
  assert.equal(anonymous.length, 0, 'sans identifiant de synchro (ancienne APK), rien n’est publié');
});

test('SEENIT-PLEX-012 exécute en parallèle borné et rend les résultats dans l’ordre d’origine', async () => {
  let running = 0, peak = 0;
  const delays = [30, 5, 20, 1, 10, 2];
  const results = await mapOrderedWithConcurrency(delays, 3, async (delay, index) => {
    running++; peak = Math.max(peak, running);
    await new Promise(resolve => setTimeout(resolve, delay));
    running--;
    return `server-${index}`;
  });
  assert.deepEqual(results, ['server-0', 'server-1', 'server-2', 'server-3', 'server-4', 'server-5']);
  assert.equal(peak, 3);
  assert.deepEqual(await mapOrderedWithConcurrency([], 3, async () => 1), []);
});

test('SEENIT-PLEX-012 ne relance jamais une collecte expirée et le dit clairement', async () => {
  const transport = readFileSync('src/features/plex/plexHistoryTransport.ts', 'utf8');
  assert.match(transport, /isRetryable: isRetryablePlexCollectError/);
  assert.match(transport, /isRetryableBackendNetworkError\(error\) && !isBackendTimeoutError\(error\)/);
  assert.match(transport, /PLEX_FULL_REQUEST_TIMEOUT_MS = 12 \* 60_000/);
  assert.match(transport, /createRequestLifecycle\(isNative, delta\)/, 'une collecte complète continue en arrière-plan');
  assert.match(transport, /payload = \{ clientId, delta, since, syncId \}/);

  let calls = 0;
  const timeout = new Error('Délai de synchronisation Plex dépassé (timeout 720 s)');
  await assert.rejects(executeBackendAttempts({ attempts: [{ transport: 'natif Android', request: async () => { calls++; throw timeout; } }, { transport: 'WebView', request: async () => { calls++; return 'ok'; } }], isRetryable: error => !isBackendTimeoutError(error) }), /Délai/);
  assert.equal(calls, 1, 'un délai dépassé n’ouvre pas une seconde collecte');
  calls = 0;
  assert.equal(await executeBackendAttempts({ attempts: [{ transport: 'natif Android', request: async () => { calls++; throw new Error('Unable to resolve host'); } }, { transport: 'WebView', request: async () => { calls++; return 'ok'; } }], isRetryable: error => !isBackendTimeoutError(error) }), 'ok');
  assert.equal(calls, 2, 'une panne DNS essaie toujours le transport suivant');
  assert.match(describeBackendNetworkFailure(timeout), /trop de temps/);
  assert.match(describeBackendNetworkFailure(new Error('Unable to resolve host')), /DNS/);
});

test('SEENIT-PLEX-012 le backend lit les serveurs en parallèle, s’arrête à la déconnexion et à 10 min', () => {
  const server = readFileSync('server.ts', 'utf8');
  const route = server.slice(server.indexOf("app.post(['/api/plex/history', '/api/plex-sync']"), server.indexOf("\n  app.", server.indexOf("app.post(['/api/plex/history'") + 10));
  assert.match(server, /PLEX_FULL_COLLECT_DEADLINE_MS = 10 \* 60_000/);
  assert.match(route, /res\.on\('close', \(\) => \{ if \(!res\.writableFinished\) requestAbort\.abort\(\); \}\)/);
  assert.match(route, /AbortSignal\.any\(\[AbortSignal\.timeout\(timeoutMs\), requestAbort\.signal, collectDeadline\]\)/);
  assert.doesNotMatch(route, /signal: AbortSignal\.timeout\(/, 'chaque appel suit l’annulation et le délai global');
  assert.doesNotMatch(route, /for \(const server of servers\)/, 'plus de boucle séquentielle sur les serveurs');
  assert.match(route, /mapOrderedWithConcurrency\(servers, 3, scanServer\)/);
  assert.match(route, /mapOrderedWithConcurrency\(sections, 3, sec => scanSection/);
  assert.match(route, /if \(collectDeadline\.aborted\) incompleteSources\.add\('délai de collecte dépassé'\)/, 'un résultat tronqué reste incomplet : curseur et cache protégés');
  assert.ok(route.indexOf('const accountHistoryTask = delta ? null : fetchPlexAccountWatchHistory()') < route.indexOf('await Promise.all([watchlistTask, cloudTask])'), 'l’historique du compte part avec la Watchlist et le cloud');
  assert.match(route, /\.plex\.direct/, 'les adresses locales plex.direct sont reconnues');
  assert.match(route, /pageSize: 300/);
  assert.match(route, /adminDb\.doc\(`users\/\$\{progressUid\}\/settings\/plexSyncProgress`\)/);
  // Fusion dans l'ordre d'origine : historique puis bibliothèque, serveur par serveur.
  const merge = route.slice(route.indexOf('for (const scan of serverScans)'), route.indexOf("if (collectDeadline.aborted)"));
  assert.ok(merge.indexOf('allRawItems.push(...scan.historyItems)') < merge.indexOf('allRawItems.push(...scan.libraryItems)'));
});

test('SEENIT-PLEX-012 regroupe les toasts et compacte le panneau de synchro', () => {
  const toasts = readFileSync('src/features/plex/plexSyncToasts.ts', 'utf8');
  assert.match(toasts, /PLEX_ITEM_TOAST_LIMIT = 3/);
  assert.match(readFileSync('src/features/plex/plexSyncEngine.ts', 'utf8'), /announcePlexSyncedItems\(syncedItems\)/);
  const sheet = readFileSync('src/components/HomeSyncIndicator.tsx', 'utf8');
  assert.match(sheet, /overallPlexPercent\(progress\)/);
  assert.match(sheet, /serverStatusLabel\(server\)/);
  for (const removed of [/Tu peux continuer à utiliser SeenIt/, /home-sync-sheet__metrics/, /Scan complet des serveurs accessibles/, /home-sync-sheet__hint/]) assert.doesNotMatch(sheet, removed);
  const css = readFileSync('src/screens/watchListHome.css', 'utf8');
  assert.match(css, /grid-template-columns:8px minmax\(0,1fr\) auto/);
  assert.match(css, /text-overflow:ellipsis/);
});
