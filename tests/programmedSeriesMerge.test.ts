import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Retour terrain du 15/11 (Dexter : Résurrection, 4 épisodes sur 4 cartes) : « pour les séries, fusionner toujours
// les épisodes, là ça prend toute la page pour 4 épisodes ».
test('Programmés : une seule carte par série, épisodes demandés depuis SeenIt compris', () => {
  const section = readFileSync('src/components/ProgrammedSection.tsx', 'utf8');
  const screen = readFileSync('src/screens/DownloadsScreenCore.tsx', 'utf8');
  // Un épisode couvert par une demande SeenIt rejoint le groupe de sa série au lieu d'avoir sa propre carte.
  assert.match(section, /if \(watched && item\.kind === 'episode'\) \{ requestFor\.set\(item\.id, watched\); merged\.add\(watched\.id\); series\.set\(item\.seriesId, /);
  assert.match(section, /for \(const entry of watching\) \{\n\s+if \(merged\.has\(entry\.id\)\) continue;/);
  // La demande reste attachée à sa ligne : annuler l'épisode annule l'attente (avec confirmation).
  assert.match(section, /const request = requestFor\.get\(item\.id\); if \(request && onRemoveWatching\) onRemoveWatching\(request\); else void cancel\(\[item\], label\);/);
  assert.match(section, /if \(request && onForgetWatching && await onForgetWatching\(request\) === false\) kept\+\+;/, 'annuler la série retire aussi les demandes SeenIt');
  assert.match(section, /if \(kept\) toast\(\{ title: label, action: `\$\{kept\} attente/, 'revue Codex #1054 : un échec est signalé');
  assert.match(screen, /onForgetWatching=\{removeDownload\}/);

  // Revue Codex #1054 : annulation groupée confirmée par le dialogue commun (Échap, retour Android, focus sur Garder).
  assert.match(section, /if \(group\.some\(item => requestFor\.has\(item\.id\)\)\) setConfirming\(\{ group, title: first\.seriesTitle \}\); else void cancelEpisodes\(group, first\.seriesTitle\);/);
  assert.match(section, /\{confirming && <DialogLayer onDismiss=\{\(\) => setConfirming\(null\)\} label="Annuler l’attente" historyMode="local" role="alertdialog"/);
  assert.match(section, /<button type="button" onClick=\{\(\) => setConfirming\(null\)\} data-dialog-initial-focus [^>]*>Garder<\/button>/);
  // Revue Codex #1054 : relance en lot par saison (pack de saison partagé, aucun épisode couvert relancé).
  assert.match(section, /onRetryWatchingGroup && requests\.length \? \(\) => \{ setMenu\(null\); onRetryWatchingGroup\(requests\); \} : undefined/);
  assert.match(screen, /const \{ launchArrEpisodeBatch \} = await import\('\.\.\/features\/downloads\/downloadLaunch'\);/);
  assert.match(screen, /season, episodes: group\.map\(launch => launch\.episode!\)\.sort\(\(a, b\) => a - b\)/);
  assert.match(screen, /onRetryWatchingGroup=\{items => void handleRetryWaitingGroup\(items\)\}/);
  // Revue Codex #1054 : jamais deux lots concurrents, un épisode déjà relancé est sauté.
  assert.match(screen, /if \(retryingSeries\.has\(seriesKey\)\) return;/);
  assert.match(screen, /skip: episode => hasActiveDownloadInScope\(useLiveDownloadStore\.getState\(\)\.downloads, \{ mediaType: 'tv', tmdbId: Number\(first\.tmdbId\), seasonNumber: season, episodeNumber: episode \}\)/);
});
