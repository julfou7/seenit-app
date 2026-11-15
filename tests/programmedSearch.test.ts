import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Retour terrain du 15/11 (Dexter : Résurrection) : « j'aimerais relancer le E01 en premier, impossible, je n'ai que
// le E03 disponible au retry » — E01 et E02 étaient des recherchés de Sonarr, sans carte « À régler ».
test('Programmés : un épisode ou un film recherché se relance, par le chemin de la fiche', () => {
  const section = readFileSync('src/components/ProgrammedSection.tsx', 'utf8');
  const screen = readFileSync('src/screens/DownloadsScreenCore.tsx', 'utf8');
  // Épisode recherché sans demande SeenIt : bouton sur sa ligne (la demande SeenIt garde sa propre relance).
  assert.match(section, /\{onSearchProgrammed && item\.wanted && item\.tmdbId && !requestFor\.has\(item\.id\) && <button type="button" disabled=\{busy !== null\} onClick=\{\(\) => onSearchProgrammed\(\{ mediaType: 'tv', tmdbId: item\.tmdbId!, tvdbId: item\.tvdbId, title: item\.seriesTitle, season: item\.season, episode: item\.episode, quality: item\.quality, posterPath: item\.posterUrl \}\)\} aria-label=\{`Relancer la recherche de \$\{first\.seriesTitle\} \$\{code\(item\)\}`\} className="programmed__cancel programmed__cancel--icon"><RotateCw size=\{18\} aria-hidden="true" \/><\/button>\}/);
  // Film recherché : « Relancer la recherche » dans son menu ⋯.
  assert.match(section, /onSearchProgrammed && movie\.wanted && movie\.tmdbId \? \(\) => \{ setMenu\(null\); onSearchProgrammed\(\{ mediaType: 'movie', tmdbId: movie\.tmdbId!, title: movie\.title, quality: movie\.quality, posterPath: movie\.posterUrl \}\); \} : undefined/);
  // Lancement : qualité affichée (jamais devinée), pas de double lancement, même chemin que la fiche.
  assert.match(screen, /const qualityPreference = \/4k\|2160\/i\.test\(target\.quality \|\| ''\) \? '4k' as const : \/1080\/\.test\(target\.quality \|\| ''\) \? '1080p' as const : null;/);
  assert.match(screen, /if \(hasActiveDownloadInScope\(useLiveDownloadStore\.getState\(\)\.downloads, \{ mediaType: target\.mediaType, tmdbId: target\.tmdbId, seasonNumber: target\.season, episodeNumber: target\.episode \}\)\)/);
  assert.match(screen, /await launchArrDownload\(\{ config: useDownloadConfigStore\.getState\(\), mediaType: target\.mediaType, title: target\.title, tmdbId: target\.tmdbId/);
  assert.match(screen, /onSearchProgrammed=\{target => void handleSearchProgrammed\(target\)\}/);
});
