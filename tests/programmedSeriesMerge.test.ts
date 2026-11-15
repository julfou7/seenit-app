import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Retour terrain du 15/11 (Dexter : Résurrection, 4 épisodes sur 4 cartes) : « pour les séries, fusionner toujours
// les épisodes, là ça prend toute la page pour 4 épisodes ».
test('Programmés : une seule carte par série, épisodes demandés depuis SeenIt compris', () => {
  const section = readFileSync('src/components/ProgrammedSection.tsx', 'utf8');
  // Un épisode couvert par une demande SeenIt rejoint le groupe de sa série au lieu d'avoir sa propre carte.
  assert.match(section, /if \(watched && item\.kind === 'episode'\) \{ requestFor\.set\(item\.id, watched\); merged\.add\(watched\.id\); series\.set\(item\.seriesId, /);
  assert.match(section, /for \(const entry of watching\) \{\n\s+if \(merged\.has\(entry\.id\)\) continue;/);
  assert.match(section, /group\.sort\(\(a, b\) => a\.season - b\.season \|\| a\.episode - b\.episode\);/, 'épisodes dans l’ordre de la série');
  // La demande reste attachée à sa ligne : annuler l'épisode annule l'attente (avec confirmation), la carte relance.
  assert.match(section, /const request = requestFor\.get\(item\.id\); if \(request && onRemoveWatching\) onRemoveWatching\(request\); else void cancel\(\[item\], label\);/);
  assert.match(section, /if \(request\) await onForgetWatching\?\.\(request\);/, 'annuler la série retire aussi les demandes SeenIt');
  assert.match(section, /onRetryWatching && requests\.length \? \(\) => \{ setMenu\(null\); requests\.forEach\(onRetryWatching\); \} : undefined/);
  assert.match(readFileSync('src/screens/DownloadsScreenCore.tsx', 'utf8'), /onForgetWatching=\{removeDownload\}/);
});
