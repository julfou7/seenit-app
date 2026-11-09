import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');

// Retours terrain du 09/11 (onglet Télécharger) et design « Téléchargement en cours v2 » validé le même soir.
test('SEENIT-DOWNLOAD-024 carte En cours v2 : flèche, ligne de progression unique, geste de l’accueil', () => {
  const card = read('src/components/DownloadItemCard.tsx');
  assert.doesNotMatch(card, /MoreHorizontal/, 'plus de « … » sur la carte de téléchargement');
  assert.match(card, /className="download-card__more download-card__toggle" aria-label=\{`\$\{details \? 'Masquer' : 'Voir'\} le détail de \$\{cleanTitle\}`\} aria-expanded=\{details\}/);
  assert.match(card, /<ChevronDown size=\{20\} aria-hidden="true" \/>/);
  // Pourcentage, vitesse et temps restant sur une seule ligne ; plus de vitesse isolée dans le détail.
  assert.match(card, /<div className="download-card__rate">\s*<strong>\{progress\} %<\/strong>\s*\{item\.speedFormatted && <span>\{item\.speedFormatted\}<\/span>\}/);
  assert.doesNotMatch(card, /<p className="download-card__meta">\{item\.speedFormatted\}<\/p>/);
  assert.match(card, /<span>Langues<\/span>/);
  assert.match(card, /<span>Reçu<\/span>/);
  assert.match(card, /'Annuler le téléchargement'/);
  // Barre centrée entre le bas de l'affiche et le bas de la carte : même espace au-dessus et en dessous.
  const css = read('src/screens/downloads.css');
  assert.match(css, /\.download-card__track \{ display:flex; flex-direction:column; gap:8px; margin:12px 2px 0 0; \}/);
  assert.match(css, /\.download-card \{ position:relative; margin-top:20px; padding:12px 12px 12px 14px;/, 'bas de carte : 12 px, comme au-dessus de la barre');
  assert.match(css, /\.download-card__head \{ position:relative; display:flex; align-items:flex-start; gap:0; min-height:100px;/, 'le bloc du haut descend jusqu’au bas de l’affiche');
  assert.match(css, /\.download-card__toggle\[aria-expanded=true\] svg \{ transform:rotate\(180deg\); \}/);

  // Geste de l'accueil : la même logique sert l'accueil (Archiver, Supprimer) et Télécharger (Annuler).
  const screen = read('src/screens/DownloadsScreenCore.tsx');
  assert.doesNotMatch(screen, /SwipeableCard|onSwipeRight/, 'plus de fond rouge plein au balayage');
  assert.match(screen, /<ActionSwipeCard\s+key=\{getStableDownloadRenderKey\(item\)\}\s+className="download-swipe"\s+actions=\{\[\{ label: isActive \? 'Annuler' : 'Retirer'/);
  assert.match(read('src/components/cards/HomeSwipeCard.tsx'), /<ActionSwipeCard base="home-swipe" ignore="button:not\(\.series-8f__open\),a,input"/);
  const swipe = read('src/components/cards/ActionSwipeCard.tsx');
  assert.match(swipe, /if \(Math\.abs\(dx\) > 52 && Math\.abs\(dx\) > Math\.abs\(dy\) \* 1\.5\) \{ moved\.current = true; setOpen\(dx < 0\); \}/, 'mêmes seuils que l’accueil');
  assert.match(swipe, /aria-label="Fermer les actions"/);
  assert.match(swipe, /event\.key === 'Escape' && open/);
});
