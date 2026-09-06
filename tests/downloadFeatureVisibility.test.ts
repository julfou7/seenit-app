import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isDownloadFeatureEnabled, resolveDownloadAwareTab } from '../src/features/downloads/downloadFeatureVisibility.ts';

test('SEENIT-DOWNLOAD-VISIBILITY-001 échoue fermée tant que l’activation n’est pas explicite', () => {
  assert.equal(isDownloadFeatureEnabled({}), false);
  assert.equal(isDownloadFeatureEnabled({ isHydrated: false, downloadsEnabled: true }), false);
  assert.equal(isDownloadFeatureEnabled({ isHydrated: true, downloadsEnabled: false }), false);
  assert.equal(isDownloadFeatureEnabled({ isHydrated: true, downloadsEnabled: 'true' }), false);
  assert.equal(isDownloadFeatureEnabled({ isHydrated: true, downloadsEnabled: 1 }), false);
  assert.equal(isDownloadFeatureEnabled({ isHydrated: true, downloadsEnabled: true }), true);

  assert.equal(resolveDownloadAwareTab('downloads', false), 'watchlist');
  assert.equal(resolveDownloadAwareTab('downloads', true), 'downloads');
  assert.equal(resolveDownloadAwareTab('discover', false), 'discover');

  const specValidatorSource = readFileSync(new URL('../scripts/validate-specifications.cjs', import.meta.url), 'utf8');
  assert.match(specValidatorSource, /requirementIdPattern = \/\^SEENIT-\(\?:\[A-Z0-9\]\+-\)\+\\d\{3\}\$\//);
  assert.match(specValidatorSource, /documentedRequirementPattern/);
});

test('SEENIT-DOWNLOAD-VISIBILITY-001 masque navigation, actions et runtime tant que la fonctionnalité est désactivée', () => {
  const configSource = readFileSync(new URL('../src/store/downloadConfigStore.ts', import.meta.url), 'utf8');
  const navSource = readFileSync(new URL('../src/components/BottomNav.tsx', import.meta.url), 'utf8');
  const navigationHookSource = readFileSync(new URL('../src/features/navigation/useNavigation.ts', import.meta.url), 'utf8');
  const settingsCardSource = readFileSync(new URL('../src/components/DownloadFeatureSettingsCard.tsx', import.meta.url), 'utf8');
  const downloadsScreenSource = readFileSync(new URL('../src/screens/DownloadsScreen.tsx', import.meta.url), 'utf8');
  const showDetailSource = readFileSync(new URL('../src/screens/ShowDetailScreen.tsx', import.meta.url), 'utf8');
  const episodeDetailSource = readFileSync(new URL('../src/screens/EpisodeDetailModal.tsx', import.meta.url), 'utf8');
  const liveStoreSource = readFileSync(new URL('../src/store/liveDownloadStore.ts', import.meta.url), 'utf8');
  const presenceSource = readFileSync(new URL('../src/store/mediaPresenceStore.ts', import.meta.url), 'utf8');

  assert.match(configSource, /downloadsEnabled:\s*false/);
  assert.match(configSource, /downloadsEnabled:\s*current\.downloadsEnabled === true/);
  assert.match(navSource, /tabs\.filter\(tab => tab\.id !== 'downloads'\)/);
  assert.match(navigationHookSource, /resolveDownloadAwareTab/);
  assert.match(settingsCardSource, /role="switch"/);
  assert.doesNotMatch(settingsCardSource, /C411|Sonarr|Radarr|qBittorrent/);
  assert.match(downloadsScreenSource, /if \(!downloadsEnabled\) return null/);
  assert.match(showDetailSource, /data-seenit-download-surface/);
  assert.match(showDetailSource, /button:has\(svg\.lucide-download\)/);
  assert.match(episodeDetailSource, /data-seenit-episode-download-surface/);
  assert.match(episodeDetailSource, /button:has\(svg\.lucide-download\)/);
  assert.match(liveStoreSource, /gatedFetchDownloads/);
  assert.match(liveStoreSource, /hideDownloadRuntimeState/);
  assert.match(liveStoreSource, /downloads:\s*\[\]/);
  assert.match(presenceSource, /downloadsEnabled && mediaType === 'movie'/);
  assert.match(presenceSource, /downloadsEnabled && mediaType === 'tv'/);
  assert.match(presenceSource, /episodesHasFile:\s*downloadsEnabled \? episodesHasFile : \{\}/);
  assert.match(presenceSource, /useDownloadConfigStore\.subscribe/);
});

test('SEENIT-DOWNLOAD-VISIBILITY-001 verrouille toutes les mentions de téléchargement dans les fiches média et le détail épisode', () => {
  const showCoreSource = readFileSync(new URL('../src/screens/ShowDetailScreenCore.tsx', import.meta.url), 'utf8');
  const episodeCoreSource = readFileSync(new URL('../src/screens/EpisodeDetailModalCore.tsx', import.meta.url), 'utf8');
  const showWrapperSource = readFileSync(new URL('../src/screens/ShowDetailScreen.tsx', import.meta.url), 'utf8');
  const episodeWrapperSource = readFileSync(new URL('../src/screens/EpisodeDetailModal.tsx', import.meta.url), 'utf8');
  const liveStoreSource = readFileSync(new URL('../src/store/liveDownloadStore.ts', import.meta.url), 'utf8');
  const presenceSource = readFileSync(new URL('../src/store/mediaPresenceStore.ts', import.meta.url), 'utf8');

  // Fiche Film/Série : bouton principal, fallback « Où regarder », saisons/épisodes et action du menu « … ».
  assert.match(showCoreSource, /\{\/\* Action Téléchargement \*\//);
  assert.match(showCoreSource, /<span>Téléchargement<\/span>/);
  assert.match(showCoreSource, /Télécharger la série \(1080p \/ 4K\)|Télécharger le film \(1080p \/ 4K\)/);
  assert.match(showCoreSource, /Télécharger le film \(1 Clic\)/);
  assert.match(showCoreSource, /Téléchargement 1-Clic/);
  assert.match(showCoreSource, /Télécharger la saison/);
  assert.match(showCoreSource, /Télécharger en 1 clic dans Sonarr/);
  assert.match(showWrapperSource, /button:has\(svg\.lucide-download\)/);

  // Les statuts de la fiche ne peuvent pas survivre au gate car l'état download est vidé.
  assert.match(showCoreSource, /Téléchargement en cours/);
  assert.match(showCoreSource, /Téléchargement terminé/);
  assert.match(showCoreSource, /Téléchargement annulé/);
  assert.match(showCoreSource, /Téléchargement interrompu/);
  assert.match(liveStoreSource, /downloads:\s*\[\]/);

  // Détail épisode : bouton Télécharger, re-téléchargement, badge Téléchargé et bannière live.
  assert.match(episodeCoreSource, /Télécharger S\$\{String\(currentSeason\)/);
  assert.match(episodeCoreSource, /Télécharger à nouveau/);
  assert.match(episodeCoreSource, /<span>Téléchargé<\/span>/);
  assert.match(episodeCoreSource, /<LiveDownloadBanner items=\{\[epDownload\]\}/);
  assert.match(episodeWrapperSource, /button:has\(svg\.lucide-download\)/);

  // Le badge « Téléchargé » et la bannière deviennent impossibles quand le gate coupe Sonarr et vide le runtime.
  assert.match(presenceSource, /sonarrHasFile:\s*downloadsEnabled \? sonarrHasFile : false/);
  assert.match(presenceSource, /seasonsHasFile:\s*downloadsEnabled \? seasonsHasFile : \{\}/);
  assert.match(presenceSource, /episodesHasFile:\s*downloadsEnabled \? episodesHasFile : \{\}/);
  assert.match(liveStoreSource, /hideDownloadRuntimeState/);
});

test('SEENIT-DOWNLOAD-VISIBILITY-001 ne masque jamais la mise à jour de l’application', () => {
  const settingsCoreSource = readFileSync(new URL('../src/screens/SettingsScreenCore.tsx', import.meta.url), 'utf8');
  const settingsWrapperSource = readFileSync(new URL('../src/screens/SettingsScreen.tsx', import.meta.url), 'utf8');

  assert.match(settingsCoreSource, /downloadAndInstallApk/);
  assert.match(settingsCoreSource, /Vérifier les mises à jour|mise à jour/i);
  assert.doesNotMatch(settingsWrapperSource, /lucide-download|title\*="télécharg"/i);
});
