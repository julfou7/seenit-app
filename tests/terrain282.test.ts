import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveEpisodeSwipe } from '../src/features/navigation/episodeNavigation.ts';

// Retours terrain du 09/11 sur la v1.4.281.
const read = (path: string) => readFileSync(path, 'utf8');

test('SEENIT-UX-008 changer d’épisode exige un geste nettement horizontal, jamais un défilement en biais', () => {
  // Enregistrement du 09/11 : défilement vertical légèrement en biais → passait à l'épisode voisin.
  assert.equal(resolveEpisodeSwipe({ offsetX: 70, offsetY: 320, velocityX: 420, velocityY: 1600 }), null, 'défilement vertical en biais');
  assert.equal(resolveEpisodeSwipe({ offsetX: -85, offsetY: 60, velocityX: -500, velocityY: 300 }), null, 'diagonale : pas deux fois plus horizontal');
  assert.equal(resolveEpisodeSwipe({ offsetX: 30, offsetY: 4, velocityX: 300, velocityY: 0 }), null, 'petit geste lent');
  assert.equal(resolveEpisodeSwipe({ offsetX: -40, offsetY: 5, velocityX: -700, velocityY: 2000 }), null, 'lancer surtout vertical');
  assert.equal(resolveEpisodeSwipe({ offsetX: -120, offsetY: 12, velocityX: -200, velocityY: 0 }), 'next', 'glisser franc vers la gauche : épisode suivant');
  assert.equal(resolveEpisodeSwipe({ offsetX: 110, offsetY: -20, velocityX: 150, velocityY: 0 }), 'previous', 'vers la droite : précédent');
  assert.equal(resolveEpisodeSwipe({ offsetX: -50, offsetY: 8, velocityX: -900, velocityY: 80 }), 'next', 'lancer rapide horizontal');
  const modal = read('src/screens/EpisodeDetailModalCore.tsx');
  assert.match(modal, /drag="x"\n[^\n]*\n\s+dragDirectionLock\n/, 'un geste d’abord vertical reste un défilement');
  assert.match(modal, /const swipe = resolveEpisodeSwipe\(\{ offsetX: info\.offset\.x, offsetY: info\.offset\.y, velocityX: info\.velocity\.x, velocityY: info\.velocity\.y \}\);/);
  assert.doesNotMatch(modal, /offset > 60 \|\| velocity > 200/);
});

test('SEENIT-UX-019 la fiche épisode garde la barre de navigation, comme la fiche média', () => {
  const modal = read('src/screens/EpisodeDetailModalCore.tsx');
  assert.match(modal, /<DialogLayer ref=\{dialogRootRef\} onDismiss=\{onClose\} label="Détail de l’épisode" historyMode="external" role="dialog" blocking=\{false\} data-media-layer="" data-episode-detail="" className="fixed inset-0 z-\[155\] flex/, 'revue Codex #921 : au-dessus de la fiche série (z-150), sous la barre (z-160)');
  assert.match(read('src/App.tsx'), /className="fixed inset-0 z-\[150\] bg-black/, 'la fiche série reste à z-150');
  assert.match(read('src/components/bottomNav.css'), /\.bottom-nav-shell\{position:fixed;[^}]*z-index:160;/, 'la barre reste à z-160');
  assert.match(read('src/index.css'), /\.seenit-dialog-layer\[data-episode-detail\] \.pb-nav \{\n\s+padding-bottom: calc\(5\.25rem/, 'revue Codex #921 : la hauteur de la barre est réservée');
  assert.match(read('src/components/bottomNav.css'), /body:has\(\[data-dialog-layer\]:not\(\[data-settings-layer\]\):not\(\[data-media-layer\]\)\) \.bottom-nav-shell\{display:none\}/, 'les vrais dialogues plein écran la masquent toujours');
  assert.match(modal, /relative z-10 flex flex-col gap-3\.5 pb-nav"/, 'le contenu réserve la hauteur de la barre');
  // Un changement d'onglet ferme la fiche épisode ouverte depuis À voir.
  assert.match(read('src/screens/WatchListScreen.tsx'), /const handleCloseModals = \(\) => \{\n\s+pendingEpisodeParentRef\.current = null;\n\s+setSelectedEpisodeModal\(null\);/);
});

test('SEENIT-UX-014 le jour de sortie : « Aujourd’hui », jamais « Ce soir » sans heure connue', () => {
  const badges = read('src/features/watchlist/seriesBadges.ts');
  assert.match(badges, /if \(age === 0\) return \{ label: 'Aujourd’hui', tone: 'today' \};/);
  assert.doesNotMatch(badges, /label: 'Ce soir'/);
});

test('SEENIT-DOWNLOAD-019 le mode téléchargement est bleu ; le rappel et le Vu restent en or', () => {
  const mode = read('src/screens/mediaDetail/downloadMode.tsx');
  assert.match(mode, /active \? 'bg-\[#7DD3FC\] text-black' : 'bg-zinc-800/, 'bouton du mode');
  assert.match(mode, /if \(picked\) return \{ background: '#27272a', boxShadow: `inset 0 0 0 1\.5px \$\{SKY\}` \};/, 'segment coché');
  assert.match(mode, /'bg-\[#7DD3FC\]'\)\}>1080p<\/button>/, 'qualité de la barre');
  assert.match(mode, /\{picked \? <circle cx="50" cy="50" r="42" fill=\{SKY\} \/>/, 'épisode coché');
  assert.match(mode, /if \(state === 'seen'\) return \{ background: '#E5A93D' \};/, 'le Vu reste en or');
  assert.doesNotMatch(mode, /rgba\(229,169,61/, 'plus d’or dans le panneau du mode');
  assert.match(read('src/screens/mediaDetail/seriesSections.tsx'), /picked \? 'bg-\[#0E1A20\] shadow-\[inset_0_0_0_1\.5px_rgba\(125,211,252,0\.8\)\]' :/, 'ligne cochée');
  assert.match(read('src/screens/mediaDetail/movieDownloadMode.tsx'), /state === 'mode' \? 'bg-\[#7DD3FC\] text-black'/, 'mode du film');
  const popup = read('src/components/DownloadModal.tsx');
  assert.equal((popup.match(/\? 'bg-\[#7DD3FC\] text-black'/g) || []).length, 2, 'choix de saison et d’épisode');
  assert.doesNotMatch(popup, /bg-\[#E5A93D\]/);
  assert.match(read('src/components/download-dialog.css'), /\.download-dialog__quality-icon \{[^}]*color:#7dd3fc/);
  assert.match(read('src/components/EpisodeReminderBell.tsx'), /reminder \? 'bg-\[#E5A93D\] text-black' : idle/, 'la cloche reste en or');
});
