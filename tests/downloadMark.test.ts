import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Logo Télécharger de SeenIt (retour du 08/11) : la flèche dans un cercle du mode téléchargement,
// appliquée à toute la fonction, barre de navigation comprise.
test('SEENIT-UX-020 le logo Télécharger est la flèche dans un cercle, partout dans la fonction', () => {
  const logo = readFileSync('src/components/SeenItLogo.tsx', 'utf8');
  assert.match(logo, /export function DownloadMark\(/);
  // Navigation : cercle (plein quand l'onglet est actif) et la même flèche, plus l'ancien plateau.
  assert.match(logo, /symbol === 'download' && <><circle cx="12" cy="12" r="9" fill=\{active \? ink : 'none'\}\/><path d=\{DOWNLOAD_ARROW\}/);
  assert.doesNotMatch(logo, /M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4/);
  const surfaces = ['src/screens/mediaDetail/downloadMode.tsx', 'src/screens/mediaDetail/movieDownloadMode.tsx', 'src/screens/ShowDetailView.tsx', 'src/screens/DownloadsScreenCore.tsx', 'src/components/DownloadModal.tsx', 'src/components/DownloadFeatureSettingsCard.tsx', 'src/components/DownloadConfigSection.tsx', 'src/components/LiveDownloadBanner.tsx', 'src/screens/SettingsScreenCore.tsx'];
  for (const file of surfaces) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /DownloadMark/, `${file} utilise le logo Télécharger`);
  }
  // Plus aucune icône « Download » générique sur ces surfaces, sauf la mise à jour de l'application (autre action).
  for (const file of surfaces.filter(file => !file.endsWith('SettingsScreenCore.tsx'))) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /<Download\b|icon=\{Download\}|icon: Download\b/, file);
  }
  const settings = readFileSync('src/screens/SettingsScreenCore.tsx', 'utf8');
  assert.match(settings, /channelId: 'seenit_downloads', icon: DownloadMark/);
});
