import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('SEENIT-UX-020 #874 un seul jeton « titre média » en or, utilisé par toutes les surfaces film et série', () => {
  const index = read('src/index.css');
  assert.match(index, /:root \{ --seenit-media-title: #F2C36B; \}/);
  assert.match(index, /\.seenit-media-title \{ color: var\(--seenit-media-title\); \}/);
  // Explorer : grille, aperçu par appui long, grand visuel, résultats de recherche ; Moi › Ma liste réutilise la grille.
  const grid = read('src/components/GridMediaCard.tsx');
  assert.match(grid, /<h3 className="seenit-media-title text-xs font-bold truncate w-full" title=\{displayTitle\}>/);
  assert.match(grid, /className="seenit-media-title text-\[22px\] font-extrabold hover:text-\[#E5A93D\]/);
  assert.match(read('src/screens/LibraryScreen.tsx'), /<GridMediaCard/);
  assert.match(read('src/screens/DiscoverHero.tsx'), /<h2 className="seenit-media-title text-\[38px\] font-extrabold uppercase/);
  const search = read('src/components/DiscoverSearchResults.tsx');
  assert.equal((search.match(/<span className="explorer-row-text"><strong className="seenit-media-title"><Highlight/g) || []).length, 2, 'les deux rangées média (bibliothèque et TMDB)');
  // Personnes et personnages restent hors règle : leur titre n'est pas recoloré.
  assert.match(search, /<strong><Highlight title=\{character\.name\}/);
  assert.match(search, /<strong><Highlight title=\{person\.name \|\| ''\}/);
  const explorer = read('src/screens/explorer.css');
  assert.match(explorer, /\.explorer-row-text strong\.seenit-media-title\{color:var\(--seenit-media-title\)\}/);
  assert.match(explorer, /\.explorer-row-text mark\{color:inherit;font-weight:800;background:transparent;text-decoration:underline;/, 'le terme cherché est souligné, pas recoloré');
  // Fiche personnage (Son parcours), fiche acteur (Vus ensemble, filmographie), saga et franchise, fiche épisode, Télécharger.
  assert.match(explorer, /\.character-works strong\{[^}]*color:var\(--seenit-media-title\)/);
  const actor = read('src/components/movieActorProfile.css');
  assert.match(actor, /\.actor-profile__seen strong \{ color:var\(--seenit-media-title\);/);
  assert.match(actor, /\.actor-profile__grid strong \{ color:var\(--seenit-media-title\);/);
  assert.match(read('src/screens/mediaDetail/detailSections.tsx'), /<span className="seenit-media-title text-\[15px\] font-bold line-clamp-2">\{part\.title \|\| part\.name\}<\/span>/);
  assert.equal((read('src/screens/EpisodeDetailModalCore.tsx').match(/<span className="seenit-media-title text-\[13px\] font-bold truncate">\{show\?\.title \|\| tmdbShowTitle \|\| 'Retour'\}<\/span>/g) || []).length, 2, 'pastille de retour « SÉRIE · … »');
  assert.match(read('src/screens/downloads.css'), /\.download-card__title \{ color:var\(--seenit-media-title\);/);
});
