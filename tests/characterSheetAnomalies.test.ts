import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Show } from '../src/types.ts';
import { characterSearchSubtitle, characterTotalLabel, characterUniverseLabel, performerWorkSummary } from '../src/features/discover/characters.ts';
import { buildCachedTrackedCharacterResults } from '../src/features/discover/characterSearch.ts';

const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const series = (tmdbId: number, title: string): Show => ({ id: `tv-${tmdbId}`, userId: 'user-a', tmdbId, title, mediaType: 'tv', posterPath: null, backdropPath: null, status: 'watching', isArchived: false, updatedAt: 1, createdAt: 1, seenEpisodes: ['1x1'], episodeRecords: {} }) as Show;

test('SEENIT-DISCOVER-004 #872 l’univers d’un personnage vient d’une source exacte, sinon il est masqué', () => {
  // Groupe du catalogue sans nom propre : jamais le titre de son premier membre (« Iron Man » pour le MCU).
  assert.equal(characterUniverseLabel(true, 'Collection', 'Daredevil : Born Again'), '');
  assert.equal(characterUniverseLabel(false, 'Dune Collection', 'Dune'), 'Dune Collection');
  assert.equal(characterUniverseLabel(false, '', 'Severance'), 'Severance');
  // Cas réel : Matt Murdock dans Daredevil : Born Again (membre du groupe marvel-cinematic-universe).
  const metadata = new Map<string, unknown>([['tv:202555', { aggregate_credits: { cast: [{ id: 26472, name: 'Charlie Cox', profile_path: '/cox.jpg', roles: [{ character: 'Matt Murdock / Daredevil', episode_count: 9 }] }] } }]]);
  const [matt] = buildCachedTrackedCharacterResults([series(202555, 'Daredevil : Born Again')], metadata, 'Matt');
  assert.equal(matt.universeId, 'marvel-cinematic-universe', 'même identité qu’avant');
  assert.equal(matt.universe, '', 'plus de « univers Iron Man »');
  // Backend et client partagent le même libellé ; l'écran masque un univers inconnu.
  assert.match(read('src/features/providers/characterBackend.ts'), /universe: characterUniverseLabel\(Boolean\(group\), text\(collection\.name\), text\(data\.name \|\| data\.title\)\)/);
  assert.doesNotMatch(read('src/features/providers/characterBackend.ts') + read('src/features/discover/characterSearch.ts'), /members\[0\]\?\.label/);
  const sheet = read('src/components/CharacterDetailModal.tsx');
  assert.match(sheet, /\{detail\.universe \? 'Personnage · univers ' \+ detail\.universe : 'Personnage'\}/);
  // « vus par toi » ne contredit plus la fiche acteur : au moins les vus déjà prouvés quand tout n'est pas vérifié.
  assert.match(sheet, /progress\.complete \? progress\.seen\+'\/'\+progress\.total : progress\.seen > 0 \? '≥ '\+progress\.seen : '—'/);
  // Défilement : sans saisie active, la couche prend toute la fenêtre (zone visible clavier ignorée).
  const layer = read('src/components/ui/DialogLayer.tsx');
  assert.match(layer, /surface\.style\.setProperty\('--dialog-height', `\$\{editing && viewport \? viewport\.height : window\.innerHeight\}px`\);/);
  assert.match(layer, /surface\.style\.setProperty\('--dialog-top', `\$\{editing && viewport \? viewport\.offsetTop : 0\}px`\);/);
  assert.match(layer, /document\.addEventListener\('focusout', updateAfterFocus\);/);
  assert.match(read('scripts/search-keyboard-browser-checks.cjs'), /#872 fiche personnage plein écran et lisible jusqu’en bas après le clavier/);
});

test('SEENIT-DISCOVER-004 retour du 21/11 : la fiche défile au-dessus de la barre Android et deux Eddie Brock se distinguent', () => {
  // La fiche réserve la barre système : sinon sa dernière carte (Venom : The Last Dance) passe dessous sans défiler.
  assert.match(read('src/screens/explorer.css'), /\.character-sheet\{[^}]*padding:8px 18px calc\(28px \+ var\(--seenit-safe-area-bottom, env\(safe-area-inset-bottom, 0px\)\)\)/);
  // Même nom, deux univers : jamais fusionnés ; sans univers nommé, l'œuvre les distingue.
  const actors = [{ id: 2524, name: 'Tom Hardy', photo: null, works: [] }];
  const venom = { universe: 'Venom - Saga', actors, works: [{ key: 'movie:335983', id: 335983, type: 'movie' as const, title: 'Venom', poster: null, creditCount: 1 }] };
  const nwh = { universe: '', actors, works: [{ key: 'movie:634649', id: 634649, type: 'movie' as const, title: 'Spider-Man : No Way Home', poster: null, creditCount: 1 }] };
  assert.equal(characterSearchSubtitle(venom), 'Venom - Saga · Tom Hardy');
  assert.equal(characterSearchSubtitle(nwh), 'Spider-Man : No Way Home · Tom Hardy');
  assert.notEqual(characterSearchSubtitle(venom), characterSearchSubtitle(nwh));
  assert.equal(characterSearchSubtitle({ universe: '', actors: [], works: [] }), '');
  assert.match(read('src/components/DiscoverSearchResults.tsx'), /<small>\{characterSearchSubtitle\(character\)\}<\/small>/);
});

test('SEENIT-DISCOVER-004 retour du 21/11 : fiche personnage au style de l’app, photos, interprètes compacts et barre de navigation', () => {
  const film = (id: number, title: string) => ({ key: `movie:${id}`, id, type: 'movie' as const, title, poster: null, creditCount: 1 });
  const works = [film(671, 'Harry Potter à l’école des sorciers'), film(672, 'Harry Potter et la Chambre des secrets'), { key: 'tv:250307', id: 250307, type: 'tv' as const, title: 'Harry Potter', poster: null, creditCount: 8 }];
  // Plus de liste de huit titres dans la ligne d'un interprète : un décompte, ou le titre seul.
  assert.equal(performerWorkSummary({ id: 1, name: 'Daniel Radcliffe', photo: null, works: ['movie:671', 'movie:672'] }, works), '2 films');
  assert.equal(performerWorkSummary({ id: 2, name: 'Dominic McLaughlin', photo: null, works: ['tv:250307'] }, works), 'Harry Potter');
  assert.equal(performerWorkSummary({ id: 3, name: 'Mixte', photo: null, works: ['movie:671', 'tv:250307'] }, works), '2 œuvres');
  // « 8 épisodes » pour huit films et une série : le total dit apparitions quand films et séries se mêlent.
  assert.equal(characterTotalLabel(works.slice(0, 2), true), 'films');
  assert.equal(characterTotalLabel(works, true), 'apparitions');
  assert.equal(characterTotalLabel([works[2]], true), 'épisodes');
  const sheet = read('src/components/CharacterDetailModal.tsx');
  assert.match(sheet, /className="character-overlay" data-media-layer=""/, 'la barre de navigation reste visible sur la fiche');
  assert.match(sheet, /className="history-entry-list character-parcours"/, 'le parcours reprend les cartes de l’Historique');
  assert.match(sheet, /<article className="history-entry character-work"/);
  assert.match(sheet, /detail\.actors\[0\]\?\.photo \? <img className="character-avatar-photo" src=\{'https:\/\/image\.tmdb\.org\/t\/p\/w185'\+detail\.actors\[0\]\.photo\}/, 'photo de l’interprète au lieu des initiales');
  // Revue Codex #1105 : le plein format ne vise que la photo principale, jamais un médaillon devenu premier enfant.
  assert.match(read('src/screens/explorer.css'), /\.character-avatar-photo\{position:absolute;inset:0/);
  assert.doesNotMatch(read('src/screens/explorer.css'), /\.character-avatar>img:first-child/);
  assert.match(read('src/components/bottomNav.css'), /:not\(\[data-media-layer\]\)\) \.bottom-nav-shell\{display:none\}/);
  assert.match(read('src/screens/explorer.css'), /\.character-overlay \.character-sheet\{padding-bottom:calc\(6rem \+ var\(--seenit-safe-area-bottom/, 'la dernière carte défile au-dessus de la barre de navigation');
});
