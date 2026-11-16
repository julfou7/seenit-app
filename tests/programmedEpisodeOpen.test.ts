import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Retour terrain du 16/11 (Programmés, Dexter S02E04–E10 : « je ne peux pas cliquer là »).
test('Programmés : toucher un épisode ouvre sa fiche, même pour une série hors bibliothèque', () => {
  const section = readFileSync('src/components/ProgrammedSection.tsx', 'utf8');
  assert.match(section, /<button type="button" className="programmed__row-open" disabled=\{!item\.tmdbId \|\| !onEpisodeClick\} onClick=\{\(\) => item\.tmdbId && onEpisodeClick\?\.\(item\.tmdbId, item\.season, item\.episode\)\}/);
  assert.match(section, /aria-label=\{`Ouvrir \$\{first\.seriesTitle\} \$\{code\(item\)\}`\}/);
  const screen = readFileSync('src/screens/DownloadsScreenCore.tsx', 'utf8');
  assert.match(screen, /onEpisodeClick=\{\(tmdbId, season, episode\) => setOpenEpisode\(\{ tmdbId, season, episode \}\)\}/);
  // La fiche lit l'épisode sur TMDB à partir de l'identifiant de la série : la bibliothèque n'est pas requise.
  assert.match(screen, /<EpisodeDetailModal show=\{episodeShow\} season=\{openEpisode\.season\} tmdbShowId=\{openEpisode\.tmdbId\}/);
  assert.match(screen, /const EpisodeDetailModal = lazy\(/, 'chargée à la demande');
  // Revue Codex #1086 : jamais d'`isHydrating` figé (la fiche resterait un squelette) ; elle s'enrichit elle-même.
  const modal = screen.slice(screen.indexOf('<EpisodeDetailModal'), screen.indexOf('</Suspense>', screen.indexOf('<EpisodeDetailModal')));
  assert.doesNotMatch(modal, /\sisHydrating(?:[\s=/>]|$)/, 'aucun attribut isHydrating');
  assert.match(modal, /tmdb\.peekEpisodeDetails\(openEpisode\.tmdbId, openEpisode\.season, openEpisode\.episode\)/);
  assert.match(readFileSync('src/screens/EpisodeDetailModalCore.tsx', 'utf8'), /fetchAndCacheSeason\(currentSeason\)\.then\(episodes => \{[\s\S]*?setCurrentEpisode\(prev => \(\{/, 'la fiche complète l’épisode depuis sa saison');
  const css = readFileSync('src/screens/downloads.css', 'utf8');
  assert.match(css, /\.programmed__row-open \{[^}]*min-height:44px/, 'cible tactile de 44 px');
});
