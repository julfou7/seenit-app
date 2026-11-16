import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatStallDuration, NO_SOURCE_AFTER_SECONDS, noSourceMessage, noSourceSeconds } from '../src/features/downloads/noSourceStall.ts';
import { downloadGroup, downloadProblem } from '../src/features/downloads/downloadGroups.ts';

const now = 1_800_000_000;

// #1077 (audit du 16/11) : un transfert sans source restait « En attente de sources » sans limite ni action.
test('un transfert sans aucune source depuis 30 min est reconnu, avec sa durée', () => {
  const dead = { state: 'stalledDL', num_seeds: 0, num_complete: 0, added_on: now - 2 * 3600, last_activity: 0 };
  assert.equal(noSourceSeconds(dead, now), 2 * 3600);
  assert.equal(noSourceMessage(2 * 3600), 'Aucune source depuis 2 h');
  assert.equal(noSourceSeconds({ ...dead, added_on: now - 10 * 60 }, now), null, 'moins de 30 min : on attend encore');
  assert.equal(noSourceSeconds({ ...dead, num_seeds: 1 }, now), null, 'une source connectée');
  assert.equal(noSourceSeconds({ ...dead, num_complete: 3 }, now), null, 'des sources connues de l’essaim');
  assert.equal(noSourceSeconds({ ...dead, state: 'downloading' }, now), null, 'transfert qui avance');
  assert.equal(noSourceSeconds({ ...dead, last_activity: now - 5 * 60 }, now), null, 'activité récente : le délai repart');
  assert.equal(noSourceSeconds({ ...dead, state: 'metaDL' }, now), 2 * 3600, 'métadonnées jamais reçues');
  assert.equal(noSourceSeconds({ state: 'stalledDL', num_seeds: 0, num_complete: 0 }, now), null, 'date inconnue : rien n’est affirmé');
  assert.equal(NO_SOURCE_AFTER_SECONDS, 1800);
  assert.deepEqual([formatStallDuration(45 * 60), formatStallDuration(3 * 86_400)], ['45 min', '3 j']);

  assert.equal(downloadGroup({ status: 'warning', progress: 0, errorMessage: 'Aucune source depuis 2 h' }), 'attention', 'dans « À régler »');
  assert.deepEqual(downloadProblem('Aucune source depuis 2 h'), { title: 'Aucune source depuis 2 h', hint: 'Personne ne partage ce fichier en ce moment : choisis une autre version, ou attends qu’une source revienne.' });
});

test('le suivi qBittorrent passe un transfert sans source en « À régler », le refus du tracker restant prioritaire', () => {
  const live = readFileSync('src/services/sonarrRadarrLive.ts', 'utf8');
  assert.match(live, /const stalledFor = !isQbitError && !isDone \? noSourceSeconds\(t\) : null;/);
  assert.match(live, /refusals\.get\(String\(t\.hash\)\) \?\? \(stalledFor !== null \? noSourceMessage\(stalledFor\) : undefined\)/, 'tracker d’abord');
});
