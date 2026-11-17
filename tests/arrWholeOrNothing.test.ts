import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { arrUnavailableNote, wholeOrNothing } from '../src/features/downloads/arrWholeOrNothing.ts';

// Retour terrain du 17/11 (Programmés, Sonarr/Radarr injoignables : « j'ai une liste incomplète, je ne sais pas d'où
// elle sort ; je préférerais avoir tout ou rien »).
type List = { items: string[]; failures: string[]; staleAt?: number };
const good: List = { items: ['dexter', 'harry', 'chat'], failures: [] };
const failed: List = { items: ['sonarr-seul'], failures: ['Radarr'] };
const syncedAt = Date.parse('2026-11-17T18:57:00Z');

test('SEENIT-DOWNLOAD-016 tout ou rien : une lecture en échec garde la dernière liste complète, datée', () => {
  const kept = wholeOrNothing(failed, good, syncedAt)!;
  assert.deepEqual(kept.items, good.items, 'tout : la liste complète précédente, jamais la lecture partielle');
  assert.deepEqual(kept.failures, ['Radarr']);
  assert.equal(kept.staleAt, syncedAt);
  const again = wholeOrNothing<List>({ items: [], failures: ['Sonarr/Radarr'] }, kept, syncedAt + 60_000)!;
  assert.deepEqual(again.items, good.items, 'échecs successifs : toujours la même liste complète');
  assert.equal(again.staleAt, syncedAt, 'datée de la dernière synchronisation réussie');
});

test('sans liste complète connue, rien n’est montré', () => {
  const none = wholeOrNothing(failed, null, undefined)!;
  assert.deepEqual(none.items, [], 'rien plutôt qu’une liste partielle');
  assert.equal(none.staleAt, undefined);
  assert.deepEqual(wholeOrNothing<List>(failed, { items: ['x'], failures: ['Sonarr'] }, syncedAt)!.items, [], 'une liste déjà partielle n’est pas « complète »');
});

test('une lecture réussie remplace tout et efface la date', () => {
  const fresh = wholeOrNothing<List>({ items: ['nouveau'], failures: [] }, { ...good, staleAt: syncedAt }, syncedAt)!;
  assert.deepEqual(fresh.items, ['nouveau']);
  assert.equal(fresh.staleAt, undefined);
  assert.equal(wholeOrNothing(null, good, syncedAt), null);
});

test('le message dit « dernier état connu » ou « liste indisponible »', () => {
  const now = Date.parse('2026-11-17T19:30:00Z');
  assert.match(arrUnavailableNote(['Sonarr', 'Radarr'], syncedAt, now), /^Sonarr et Radarr injoignables pour l’instant : dernier état connu à \d{2}:\d{2}\.$/);
  assert.equal(arrUnavailableNote(['Radarr'], undefined, now), 'Radarr injoignable pour l’instant : liste indisponible.');
  assert.match(arrUnavailableNote(['Sonarr/Radarr'], syncedAt, now + 3 * 86_400_000), /injoignables pour l’instant : dernier état connu du \d+ nov\.? à \d{2}:\d{2}\.$/);
});

test('la synchronisation et les sections appliquent « tout ou rien »', () => {
  const store = readFileSync('src/store/arrSyncStore.ts', 'utf8');
  // Revue Codex #1089 : un échec de la bibliothèque (qui complète Programmés) compte pour Programmés ; « À décider »
  // n'est pas montré pendant une panne.
  assert.match(store, /const programmedRead = labelled\.programmed \? \{ \.\.\.labelled\.programmed, failures: \[\.\.\.new Set\(\[\.\.\.labelled\.programmed\.failures, \.\.\.\(labelled\.imports\?\.failures \|\| \[\]\)\]\)\] \} : null;/);
  assert.match(store, /const wholeProgrammed = wholeOrNothing\(programmedRead, prior\?\.programmed, prior\?\.syncedAt\);/);
  assert.match(store, /const undecided = degraded \? \[\] : labelled\.undecided \|\| \[\];/);
  assert.match(store, /const wholeImports = wholeOrNothing\(labelled\.imports, prior\?\.imports, prior\?\.syncedAt\);/);
  assert.match(store, /programmed: programmed \? \{ items: programmed\.items, failures: programmed\.failures, staleAt: programmed\.staleAt \} : null/, 'la date survit au redémarrage');
  const section = readFileSync('src/components/ProgrammedSection.tsx', 'utf8');
  assert.match(section, /const unavailable = failures\.length > 0 && staleAt === undefined;\s*const watching = unavailable \? \[\] :/, 'rien : pas même les demandes de SeenIt');
  assert.doesNotMatch(section, /la liste peut être incomplète/);
  assert.doesNotMatch(readFileSync('src/components/RecentImportsRail.tsx', 'utf8'), /la liste peut être incomplète/);
});
