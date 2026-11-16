import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Retour terrain du 16/11 (Dexter S02, mode téléchargement) : « ici rien n'est téléchargeable car déjà programmé ou déjà
// téléchargé, mais visuellement ce n'est pas clair, ça donne envie de cliquer ».
test('mode téléchargement : un épisode qui ne se coche pas est visiblement inerte', () => {
  const mode = readFileSync('src/screens/mediaDetail/downloadMode.tsx', 'utf8');
  // Inerte = ni cochable (disponible, à régler, à venir) ni en cours (progression lisible) : déjà là, programmé, vu.
  assert.match(mode, /export const isEpisodeInertInMode = \(state: EpisodeModeState\) => !isEpisodePickable\(state\) && state !== 'active';/);
  assert.match(mode, /export const isEpisodeSelectable = \(state: EpisodeModeState\) => state === 'available' \|\| state === 'attention';/);
  assert.match(mode, /if \(state === 'present'\) return <PassiveModeLabel label=\{`Épisode \$\{episode\} déjà téléchargé`\}>✓ Téléchargé<\/PassiveModeLabel>;/, 'plus de rond blanc à flèche');
  assert.match(mode, /if \(state === 'programmed'\) return <PassiveModeLabel tone="sky" label=\{`Épisode \$\{episode\} déjà programmé dans Sonarr`\}>Programmé<\/PassiveModeLabel>;/, 'plus de cercle bleu');
  assert.doesNotMatch(mode, /<circle cx="50" cy="50" r="42" fill="#F4F4F5" \/>/);

  const rows = readFileSync('src/screens/mediaDetail/seriesSections.tsx', 'utf8');
  assert.match(rows, /const inert = inMode && isEpisodeInertInMode\(modeState\);/);
  assert.match(rows, /cursor-pointer', inert && 'opacity-50'/, 'ligne effacée, toujours touchable');
  // Retour terrain du 16/11 : « je veux pouvoir cliquer sur un épisode » — un épisode non cochable ouvre sa fiche.
  assert.match(rows, /const activate = \(\) => \{ if \(inMode && selectable\) downloadMode!\.onToggle\(episode\.episode_number\); else onOpenEpisode\(episode\); \};/);

  const view = readFileSync('src/screens/ShowDetailView.tsx', 'utf8');
  assert.match(view, /const nothingToPick = !pickedList\.length && modeStates\.length > 0 && !selectableEpisodes\.length;/);
  assert.match(view, /'Tout est déjà téléchargé ou programmé\.'/, 'la barre ne dit plus « Coche un épisode »');
  // Revue Codex #1075 : épisodes encore en cours — jamais « à jour ».
  assert.match(view, /const activeLeft = modeStates\.filter\(entry => entry\.state === 'active'\)\.length;/);
  assert.match(view, /nothingToPick \? \(activeLeft \? `Saison \$\{modeSeason\} en cours` : `Saison \$\{modeSeason\} à jour`\)/);
});
