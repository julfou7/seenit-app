import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PLEX_FRAME_BUDGET_MS, resetFrameBudget, yieldToFrame } from '../src/features/plex/plexFrameBudget.ts';

test('SEENIT-PLEX-010 la synchro Plex cède le fil dès que sa tranche dépasse 6 ms', async () => {
  assert.equal(PLEX_FRAME_BUDGET_MS, 6, 'une frame à 120 Hz dure 8,3 ms : 6 ms de travail au plus');
  let clock = 0;
  const now = () => clock;
  resetFrameBudget();
  assert.equal(await yieldToFrame(now), false, 'première tranche : pas de pause');
  clock = 5;
  assert.equal(await yieldToFrame(now), false, 'sous le budget : la boucle continue');
  clock = 7;
  assert.equal(await yieldToFrame(now), true, 'budget dépassé : le fil est rendu au navigateur');
  clock = 9;
  assert.equal(await yieldToFrame(now), false, 'une tranche neuve repart après la pause');

  // Le moteur réel cède dans chacune de ses boucles et dans la pause commune.
  const engine = readFileSync('src/features/plex/plexSyncEngine.ts', 'utf8');
  assert.match(engine, /import \{ yieldToFrame \} from '\.\/plexFrameBudget';/);
  assert.match(engine, /const waitForResume = async \(\) => \{ await yieldToFrame\(\);/);
  for (const loop of ['for (const entry of libraryAvailability) {', 'for (const rawItem of history) {', 'for (const rawItem of watchlist) {', 'for (const state of libraryWatchStates as PlexLibraryWatchState[]) {']) {
    assert.ok(engine.includes(`${loop} await yieldToFrame();`), `boucle découpée : ${loop}`);
  }
});
