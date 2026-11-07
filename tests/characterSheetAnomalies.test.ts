import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Show } from '../src/types.ts';
import { characterUniverseLabel } from '../src/features/discover/characters.ts';
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
