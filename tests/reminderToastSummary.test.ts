import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildReminderToastSummary } from '../src/features/notifications/reminderToastSummary.ts';

const candidate = (key: string, title: string, body: string) => ({ key, title, body });

test('#353 un rappel du jour produit un seul toast structuré sans emoji de présentation', () => {
  const summary = buildReminderToastSummary([
    candidate('tv:1', 'Reacher', '🎉 S03E01 · Persuader disponible aujourd\'hui.'),
  ]);

  assert.ok(summary);
  assert.equal(summary.message.title, 'Reacher');
  assert.equal(summary.message.action, 'S03E01 · Persuader disponible aujourd\'hui.');
  assert.doesNotMatch(`${summary.message.title} ${summary.message.action}`, /[🍿🎉🔔🔕\uFFFD]/u);
});

test('#353 plusieurs rappels du jour sont compactés dans un seul résumé borné', () => {
  const summary = buildReminderToastSummary([
    candidate('tv:1', 'Reacher', 'disponible aujourd\'hui'),
    candidate('tv:2', 'Neagley', 'disponible aujourd\'hui'),
    candidate('tv:3', 'Slow Horses', 'disponible aujourd\'hui'),
    candidate('tv:4', 'The Bear', 'disponible aujourd\'hui'),
  ]);

  assert.ok(summary);
  assert.equal(summary.message.title, '4 nouveautés aujourd’hui');
  assert.equal(summary.message.action, 'Reacher · Neagley · Slow Horses · +1');
});

test('#353 déduplique les candidats et produit une signature stable pour les reprises', () => {
  const first = buildReminderToastSummary([
    candidate('tv:2', 'Neagley', 'x'),
    candidate('tv:1', 'Reacher', 'x'),
    candidate('tv:1', 'Reacher', 'x'),
  ]);
  const second = buildReminderToastSummary([
    candidate('tv:1', 'Reacher', 'x'),
    candidate('tv:2', 'Neagley', 'x'),
  ]);

  assert.ok(first && second);
  assert.equal(first.signature, second.signature);
  assert.equal(first.message.title, '2 nouveautés aujourd’hui');
});

test('#353 un nouvel épisode du jour n’ajoute aucun toast interne mais conserve l’envoi système', () => {
  const source = readFileSync('src/hooks/useRemindersNotifier.ts', 'utf8');
  assert.equal((source.match(/showToast\(/g) || []).length, 1,
    'un seul point d’émission UI doit rester après la boucle des médias');
  assert.match(source, /emitInternalToast: boolean = true/);
  assert.match(source, /if \(emitInternalToast\) \{\s+dueToastCandidates\.push\(/);
  assert.match(
    source,
    /'today',[\s\S]*?episodeCopy\.summaryText,[\s\S]*?episodeCopy\.body,[\s\S]*?true,\s+false\s+\);/,
    'le rappel nouvel épisode doit explicitement désactiver le toast interne'
  );
  assert.match(source, /if \(\(await send\(\)\)\.delivered\) writeUserScopedJson\(uid, notifiedKey, true\)/,
    'la notification système garde son propre reçu et ses retries');
  assert.doesNotMatch(source, /showToast\(`(?:🍿|🎉)/u);
});
