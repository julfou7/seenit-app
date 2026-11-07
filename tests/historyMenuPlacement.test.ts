import test from 'node:test';
import assert from 'node:assert/strict';
import { localDayKey, placeAnchoredMenu, shiftTime } from '../src/features/history/historyMenuPlacement.ts';

test('SEENIT-UX-015 #9 le menu ancré n’est jamais coupé, même sur un écran court', () => {
  // Assez de place sous la ligne : sous la ligne.
  assert.deepEqual(placeAnchoredMenu({ top: 100, bottom: 196 }, 260, 844), { top: 204, maxHeight: 828 });
  // Pas sous, mais au-dessus : au-dessus.
  assert.deepEqual(placeAnchoredMenu({ top: 600, bottom: 696 }, 260, 844), { top: 332, maxHeight: 828 });
  // Cas Codex : fenêtre de 600 px, ligne entre 200 et 296 px, menu de 260 px → ni dessous ni dessus entier.
  const squeezed = placeAnchoredMenu({ top: 200, bottom: 296 }, 260, 600);
  assert.ok(squeezed.top >= 8 && squeezed.top + Math.min(260, squeezed.maxHeight) <= 592, JSON.stringify(squeezed));
  // Menu plus haut que l'écran : borné et défilable, jamais au-dessus du bord.
  const tall = placeAnchoredMenu({ top: 300, bottom: 396 }, 900, 600);
  assert.deepEqual(tall, { top: 8, maxHeight: 584 });
});

test('SEENIT-UX-015 #9 Hier et Avant-hier suivent le calendrier local, y compris au changement d’heure', () => {
  // Cas Codex : 30 mars 2026 à 00 h 30 (Europe/Paris, lendemain du passage à l'heure d'été).
  const now = new Date(2026, 2, 30, 0, 30);
  assert.deepEqual([0, 1, 2].map(days => localDayKey(days, now)), ['2026-03-30', '2026-03-29', '2026-03-28']);
  const autumn = new Date(2026, 9, 26, 0, 15);
  assert.deepEqual([0, 1].map(days => localDayKey(days, autumn)), ['2026-10-26', '2026-10-25']);
  assert.equal(shiftTime('23:50', 15), '00:05');
  assert.equal(shiftTime('', -15), '19:45');
});
