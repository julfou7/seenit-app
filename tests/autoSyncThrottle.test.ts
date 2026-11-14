import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isPlexSyncTerminal } from '../src/features/plex/plexSyncPresentation.ts';
import { countPlexSyncErrors, formatPlexSyncResult } from '../src/features/plex/plexSyncProgressModel.ts';

const read = (file: string) => fs.readFileSync(file, 'utf8');

test('SEENIT-PLEX-012 retour du 14/11 : les délais automatiques survivent au lancement et un serveur injoignable n’est pas une erreur', async () => {
  const store = new Map<string, string>();
  Object.assign(globalThis, { localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); }, removeItem: (key: string) => { store.delete(key); } } });
  const { lastAutoSyncRun, readAutoSyncRun, writeAutoSyncRun } = await import('../src/lib/autoSyncThrottle.ts');

  // Un nouveau lancement (mémoire de session vide) retrouve le dernier passage mémorisé, par compte et par type.
  assert.equal(lastAutoSyncRun('alice', 'plex', undefined), undefined);
  writeAutoSyncRun('alice', 'plex', 1_000);
  writeAutoSyncRun('alice', 'details', 5_000);
  assert.equal(lastAutoSyncRun('alice', 'plex', undefined), 1_000, 'le lancement suivant voit l’essai précédent');
  assert.equal(lastAutoSyncRun('alice', 'details', undefined), 5_000, 'écrire un type ne remplace pas l’autre');
  assert.equal(lastAutoSyncRun('bob', 'plex', undefined), undefined, 'aucun partage entre comptes');
  assert.equal(lastAutoSyncRun('alice', 'plex', 9_000), 9_000, 'la mémoire de session plus récente prime');
  assert.equal(readAutoSyncRun('alice', 'plex'), 1_000);

  // Une synchro incomplète (serveurs éteints) n'est pas une erreur ; un vrai échec, si.
  assert.equal(countPlexSyncErrors({ phase: 'incomplete', unresolved: 0 }, 'Synchronisation Plex incomplète — nouvel essai requis'), 0);
  assert.equal(countPlexSyncErrors({ phase: 'incomplete', unresolved: 2 }, 'Synchronisation Plex incomplète'), 2, 'les médias non résolus restent comptés');
  assert.equal(countPlexSyncErrors({ phase: 'error', unresolved: 0 }, 'Erreur lors de l’enregistrement'), 1);
  assert.equal(formatPlexSyncResult({ phase: 'incomplete', changed: 0, dated: 0 }, 'Synchronisation Plex incomplète'), '0 changement · 0 Vu daté · 0 erreur');
  assert.equal(isPlexSyncTerminal('incomplete'), true);
});

test('SEENIT-PLEX-012 retour du 14/11 : le worker lit les délais mémorisés et l’essai automatique incomplet reste silencieux', () => {
  const worker = read('src/hooks/useDetailsSyncWorker.ts');
  assert.match(worker, /lastAutoSyncRun\(uid, 'details', lastRunRef\.current\.get\(uid\)\)/);
  assert.match(worker, /lastAutoSyncRun\(uid, 'plex', lastPlexRunRef\.current\.get\(uid\)\)/);
  assert.match(worker, /writeAutoSyncRun\(uid, 'plex', now\);\n\s+void performPlexSync/, 'l’essai Plex est mémorisé avant de partir');
  assert.match(worker, /if \(result\.success\) writeAutoSyncRun\(uid, 'details'\)/, 'seul un passage terminé retarde le suivant');
  const engine = read('src/features/plex/plexSyncEngine.ts');
  assert.match(engine, /\/erreur\|pause\/i\.test\(message \|\| ''\) \? 'error' : \/incompl\/i\.test\(message \|\| ''\) \? 'incomplete' : 'done'/);
  assert.equal([...engine.matchAll(/if \(!silent && ignoreCooldown\) \{\s+useToastStore\.getState\(\)\.showToast\(`(?:Synchronisation Plex incomplète|Plex sera retenté)/g)].length, 2, 'seule une synchro manuelle annonce un essai incomplet');
  const panel = read('src/components/HomeSyncIndicator.tsx');
  assert.match(panel, /server\.reason \|\| server\.state === 'skipped' \? 'warn'/, 'un serveur éteint est ambre, pas rouge');
});
