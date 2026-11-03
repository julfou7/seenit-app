import test from 'node:test';
import { readFeatureSource } from './featureSource.ts';
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
  assert.match(navSource, /NAVIGATION_TABS\.filter\(tab => tab\.id !== 'downloads'\)/);
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
  const showCoreSource = readFeatureSource('showDetail');
  const episodeCoreSource = readFileSync(new URL('../src/screens/EpisodeDetailModalCore.tsx', import.meta.url), 'utf8');
  const showWrapperSource = readFileSync(new URL('../src/screens/ShowDetailScreen.tsx', import.meta.url), 'utf8');
  const episodeWrapperSource = readFileSync(new URL('../src/screens/EpisodeDetailModal.tsx', import.meta.url), 'utf8');
  const liveStoreSource = readFileSync(new URL('../src/store/liveDownloadStore.ts', import.meta.url), 'utf8');
  const presenceSource = readFileSync(new URL('../src/store/mediaPresenceStore.ts', import.meta.url), 'utf8');

  // SEENIT-UX-019 : les fiches refaites n'exposent plus de surface de téléchargement en ligne. Le seul
  // accès est l'entrée existante « Téléchargement » du menu ⋮ (icône lucide-download, donc masquée par le gate).
  const view = readFileSync(new URL('../src/screens/ShowDetailView.tsx', import.meta.url), 'utf8');
  assert.equal((view.match(/<Download size=\{18\}[^>]*\/>Téléchargement<\/button>/g) || []).length, 1, 'une seule entrée Téléchargement, dans le menu ⋮');
  for (const inline of [/Télécharger le film \(1 Clic\)/, /Téléchargement 1-Clic/, /Télécharger la saison/, /Télécharger en 1 clic dans Sonarr/, /LiveDownloadBanner/, /handle1ClickDownload/, /Téléchargement en cours/]) {
    assert.doesNotMatch(showCoreSource.replace(readFileSync(new URL('../src/screens/ShowDetailScreenCore.tsx', import.meta.url), 'utf8'), '').replace(readFileSync(new URL('../src/screens/showDetailPresentation.ts', import.meta.url), 'utf8'), ''), inline);
  }
  assert.match(showWrapperSource, /button:has\(svg\.lucide-download\)/);
  assert.match(liveStoreSource, /downloads:\s*\[\]/);

  // Détail épisode : plus de bouton Télécharger ni de bannière live ; le gate reste en place.
  for (const inline of [/DownloadModal/, /Télécharger à nouveau/, /<span>Téléchargé<\/span>/, /LiveDownloadBanner/, /Télécharger S\{/]) assert.doesNotMatch(episodeCoreSource, inline);
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
