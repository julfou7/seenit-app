const fs = require('node:fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, value) { fs.writeFileSync(path, value, 'utf8'); }
function replaceOnce(text, before, after, label) {
  if (!text.includes(before)) throw new Error(`${label}: motif introuvable`);
  const next = text.replace(before, after);
  if (next === text) throw new Error(`${label}: aucun changement`);
  return next;
}
function replaceRegexOnce(text, pattern, replacement, label) {
  const matches = [...text.matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'))];
  if (matches.length !== 1) throw new Error(`${label}: ${matches.length} occurrence(s), 1 attendue`);
  return text.replace(pattern, replacement);
}

// SPEC §5.6 uniquement.
{
  const path = 'docs/specifications/seenit.md';
  let text = read(path);
  const section = `### 5.6 Relations entre médias : ordre de visionnage et franchise / univers

- **SEENIT-RELATION-001** — Une fiche média ne promet que des relations structurelles suffisamment
  fiables. La découverte approximative reste dans Explorer et n'est plus affichée comme une relation
  de fiche.

#### Films

Un **Film** peut afficher, dans cet ordre :

1. **Ordre de visionnage** : exclusivement la collection TMDB explicite du film. Aucun catalogue
   SeenIt, TVDB, Wikidata ou rapprochement par titre ne complète une collection TMDB absente. Aucune
   série n'est ajoutée dans cette section.
2. **Franchise / univers** : relation TVDB exacte, uniquement lorsqu'elle apporte au moins un autre
   média après déduplication de l'Ordre de visionnage.

Les sections **Films similaires** sont supprimées des fiches.

#### Séries

Une **Série** peut afficher une seule section **Franchise / univers** issue de TVDB. Les sections
**Séries similaires** sont supprimées des fiches. L'absence de section relationnelle est un résultat
normal pour un média indépendant ou lorsqu'une source reste ambiguë/indisponible.

#### Résolution TVDB exacte

TVDB devient la source normale des franchises / univers sur les fiches, pour les films comme pour les
séries. Le résolveur part toujours de l'identité canonique \`movie:<tmdbId>\` ou \`tv:<tmdbId>\` et des
identifiants externes exacts fournis par TMDB : TVDB ID lorsqu'il existe, ou IMDb ID exact comme pont
technique si nécessaire.

Le runtime applique tous les garde-fous suivants :

- aucune recherche du média par titre, titre original, année, popularité, genre, mot-clé, casting,
  studio, marque ou premier résultat ;
- aucune recherche globale de listes ; seules les listes déjà rattachées au média TVDB exact sont
  examinées ;
- au maximum une liste officielle admissible peut être retenue ; si plusieurs listes restent
  admissibles, la section est masquée ;
- plus aucune fusion de plusieurs listes pour élargir artificiellement une franchise ;
- chaque membre TVDB est remappé vers un TMDB ID exact et son type \`movie\`/\`tv\` avant affichage ; une
  identité absente ou ambiguë est ignorée ;
- le libellé d'une liste TVDB déjà atteinte depuis l'identité exacte peut uniquement qualifier sa
  nature pour l'interface : **Dans la même franchise** ou **Dans le même univers**. Il ne crée jamais
  l'identité d'une œuvre ni son appartenance au groupe.

Une indisponibilité TVDB ou une configuration serveur manquante masque seulement la section concernée.
Aucun fallback par titre n'est autorisé. Les clés/jetons TVDB restent exclusivement dans le backend
SeenIt conformément à \`SEENIT-SECURITY-001\`.

#### Identité, priorité et déduplication

L'identité d'une œuvre reste toujours \`mediaType + tmdbId\`; \`movie:42\` et \`tv:42\` ne sont jamais
fusionnés. Pour un film, la priorité est **Ordre de visionnage**, puis **Franchise / univers**. Tout média
déjà présent dans l'Ordre est dédupliqué de la section TVDB par \`mediaType + tmdbId\`. La fiche courante
peut servir de repère dans le groupe, mais une section ne contenant qu'elle est masquée.

Une réponse asynchrone d'une ancienne fiche ne peut pas remplacer la fiche courante. Les caches sont
bornés par identité typée, la concurrence distante est bornée et une erreur n'est jamais transformée
en relation supposée.

Les recommandations TMDB \`recommendations\` / \`similar\` restent disponibles pour les moteurs de
**découverte d'Explorer** ; elles ne sont plus utilisées pour remplir le bas d'une fiche média.

House of the Dragon, Breaking Bad, Yellowstone, Harry Potter, MCU et Punisher sont uniquement des TNR
du mécanisme commun. Aucun de ces noms ne peut apparaître dans une condition, une regex ou une table de
production destinée à forcer une relation.
`;
  text = replaceRegexOnce(text, /### 5\.6 Relations entre médias :[\s\S]*?(?=\n### 5\.7 )/, section.trimEnd(), 'seenit §5.6');
  write(path, text);
}

// Référence fonctionnelle : routes + §8.4.
{
  const path = 'docs/specifications/functional-reference.md';
  let text = read(path);
  const oldRoute = `- \`GET /api/media/tmdb/...\` et \`GET /api/media/omdb\` : métadonnées authentifiées sans clé côté
  client ; [contrat et inventaire #12](./media-providers.md). Le module TVDB legacy inutilisé est
  supprimé ; les sources et les règles d'univers ne changent pas avec cette migration.`;
  const newRoute = `- \`GET /api/media/tmdb/...\`, \`GET /api/media/omdb\` et \`GET /api/media/tvdb/franchise\` :
  métadonnées authentifiées sans clé côté client ; [contrat et inventaire #12/#130](./media-providers.md).
  La route TVDB accepte uniquement des identifiants externes exacts et renvoie une franchise/univers
  remappée vers des identités TMDB typées.`;
  text = replaceOnce(text, oldRoute, newRoute, 'routes fonctionnelles');
  const section = `### 8.4 Ordre de visionnage et franchise / univers

La fiche n'affiche plus de rangée **Films similaires** ou **Séries similaires**. Les recommandations
contextuelles restent dans Explorer, qui est le parcours de découverte prévu pour ce type de résultat.

Pour un film, **« Ordre de visionnage » provient exclusivement de sa collection TMDB explicite**. La
section conserve uniquement des films et leur ordre TMDB ; aucune autre source ne complète une
collection absente.

Film et Série peuvent ensuite afficher une relation TVDB structurelle. SeenIt part de l'identité
\`movie:<tmdbId>\` / \`tv:<tmdbId>\`, utilise le TVDB ID exact fourni par TMDB ou l'IMDb ID exact comme pont
technique lorsque nécessaire, puis examine uniquement les listes rattachées au média TVDB exact. Il ne
recherche jamais le média par titre et ne fusionne jamais plusieurs listes. Si plusieurs listes
officielles admissibles restent ambiguës, la section est masquée.

Le titre de la rangée reflète la liste exacte retenue : **« Dans la même franchise »** ou
**« Dans le même univers »**. Le nom de la liste sert seulement à qualifier ce libellé après résolution
d'identité ; il n'identifie jamais une œuvre ou un membre.

Chaque membre TVDB est reconverti vers un TMDB ID + type exact avant navigation. Pour un film, tout
média déjà présent dans l'Ordre de visionnage est retiré de la section TVDB par identité
\`mediaType + tmdbId\`. Une rangée auto-référente ou sans autre membre est masquée. Une fiche peut donc
légitimement n'afficher aucune relation.

Une panne TVDB masque uniquement la rangée relationnelle. PWA et APK partagent le même client SeenIt
sécurisé ; aucune clé ni aucun hôte TVDB n'est embarqué dans le client. Le contrat exhaustif est
\`SEENIT-RELATION-001\`, suivi dans [#130](https://github.com/julfou7/seenit-app/issues/130).
`;
  text = replaceRegexOnce(text, /### 8\.4 [\s\S]*?(?=\nUne fiche déjà ouverte pendant la session)/, section.trimEnd() + '\n\n', 'functional §8.4');
  write(path, text);
}

// requirements.json : uniquement l'objet SEENIT-RELATION-001.
{
  const path = 'docs/specifications/requirements.json';
  let text = read(path);
  const block = `    {
      "id": "SEENIT-RELATION-001",
      "title": "Ordre TMDB et franchise/univers TVDB exacts, sans similaires sur les fiches",
      "targets": [
        "pwa",
        "apk",
        "backend"
      ],
      "tests": [
        {
          "file": "tests/mediaRelationsSpecification.test.ts",
          "contains": "SEENIT-RELATION-001 limite les fiches aux relations utiles"
        },
        {
          "file": "tests/mediaRelationsSpecification.test.ts",
          "contains": "SEENIT-RELATION-001 réserve l’ordre de visionnage aux collections TMDB"
        },
        {
          "file": "tests/mediaRelationsSpecification.test.ts",
          "contains": "SEENIT-RELATION-001 résout TVDB sans recherche par titre ni fusion de listes"
        },
        {
          "file": "tests/mediaRelationsSpecification.test.ts",
          "contains": "SEENIT-RELATION-001 déduplique la franchise après la saga"
        },
        {
          "file": "tests/mediaRelationsSpecification.test.ts",
          "contains": "SEENIT-RELATION-001 retire les similaires des fiches et garde la découverte dans Explorer"
        },
        {
          "file": "tests/mediaRelationsSpecification.test.ts",
          "contains": "SEENIT-RELATION-001 trace la décision durable et l’écart runtime"
        },
        {
          "file": "tests/tvdbRelations.test.ts",
          "contains": "SEENIT-RELATION-001 résout une franchise TVDB uniquement par identifiants exacts"
        },
        {
          "file": "tests/tvdbRelations.test.ts",
          "contains": "SEENIT-RELATION-001 masque une relation TVDB ambiguë et refuse le titre"
        },
        {
          "file": "tests/tvdbRelations.test.ts",
          "contains": "SEENIT-RELATION-001 TNR House of the Dragon passe par le mécanisme commun"
        }
      ]
    }`;
  text = replaceRegexOnce(text, /    \{\n      "id": "SEENIT-RELATION-001",[\s\S]*?\n    \}(?=,\n    \{\n      "id": "SEENIT-PERF-001")/, block, 'requirements relation');
  JSON.parse(text);
  write(path, text);
}

write('tests/mediaRelationsSpecification.test.ts', `import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const specification = readFileSync(new URL('../docs/specifications/seenit.md', import.meta.url), 'utf8');
const functionalReference = readFileSync(new URL('../docs/specifications/functional-reference.md', import.meta.url), 'utf8');
const requirements = JSON.parse(readFileSync(new URL('../docs/specifications/requirements.json', import.meta.url), 'utf8'));
const registry = readFileSync(new URL('../docs/requests/registry.md', import.meta.url), 'utf8');
const decision = readFileSync(new URL('../docs/decisions/media-relations-2026-09-06.md', import.meta.url), 'utf8');
const agentInstructions = readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8');

test('SEENIT-RELATION-001 limite les fiches aux relations utiles', () => {
  assert.match(specification, /Film[^\\n]*Ordre de visionnage[\\s\\S]*Franchise \\/ univers/);
  assert.match(specification, /Série[^\\n]*Franchise \\/ univers/);
  assert.match(specification, /Films similaires[\\s\\S]*Séries similaires[\\s\\S]*supprim/);
  assert.match(functionalReference, /### 8\\.4 Ordre de visionnage et franchise \\/ univers/);
  assert.match(decision, /Une fiche média sert à répondre[\\s\\S]*réellement lié/);
});

test('SEENIT-RELATION-001 réserve l’ordre de visionnage aux collections TMDB', () => {
  assert.match(specification, /Ordre de visionnage[\\s\\S]*exclusivement[\\s\\S]*collection TMDB/);
  assert.match(specification, /Aucune[\\s\\S]*série n'est ajoutée dans cette section/i);
  assert.match(functionalReference, /Ordre de visionnage[^\\n]*provient exclusivement de sa collection TMDB explicite/);
  assert.match(decision, /Aucun catalogue SeenIt, TVDB, Wikidata ou rapprochement par titre ne complète une collection TMDB manquante/);
});

test('SEENIT-RELATION-001 résout TVDB sans recherche par titre ni fusion de listes', () => {
  assert.match(specification, /TVDB devient la source normale[\\s\\S]*films comme[\\s\\S]*séries/);
  assert.match(specification, /aucune recherche du média par titre/);
  assert.match(specification, /aucune recherche globale de listes/);
  assert.match(specification, /au maximum une liste officielle/);
  assert.match(specification, /plus aucune fusion de plusieurs listes/);
  assert.match(specification, /libellé d'une liste TVDB[\\s\\S]*qualifier sa[\\s\\S]*nature/);
  assert.match(agentInstructions, /Le libellé d'une liste TVDB déjà atteinte depuis l'identité exacte/);
});

test('SEENIT-RELATION-001 déduplique la franchise après la saga', () => {
  assert.match(specification, /priorité[\\s\\S]*Ordre de visionnage[\\s\\S]*Franchise \\/ univers/);
  assert.match(specification, /dédupliqu(?:é|ée)[\\s\\S]*mediaType \\+ tmdbId/);
  assert.match(functionalReference, /déjà présent dans l'Ordre de visionnage[\\s\\S]*retiré de la section TVDB/);
  assert.match(decision, /ne répète pas ces films/);
});

test('SEENIT-RELATION-001 retire les similaires des fiches et garde la découverte dans Explorer', () => {
  assert.match(specification, /Films similaires[\\s\\S]*Séries similaires[\\s\\S]*supprimées des fiches/);
  assert.match(specification, /Explorer[\\s\\S]*découverte/);
  assert.match(functionalReference, /recommandations contextuelles restent dans Explorer/);
  assert.match(decision, /recommendations[\\s\\S]*similar[\\s\\S]*ne sont plus utilisés pour remplir le bas d'une fiche/);
});

test('SEENIT-RELATION-001 trace la décision durable et l’écart runtime', () => {
  assert.match(registry, /USR-2026-09-05-002[\\s\\S]*superseded/);
  assert.match(registry, /USR-2026-09-06-005[\\s\\S]*superseded/);
  assert.match(registry, /USR-2026-09-06-008[\\s\\S]*SEENIT-RELATION-001[\\s\\S]*active/);
  assert.match(decision, /Au 6 septembre 2026, le runtime \\`main\\` ne respecte pas encore cette cible/);
  assert.match(decision, /issue #130 reste donc \\*\\*ouverte\\*\\*/);
  const requirement = requirements.requirements.find((entry: { id: string }) => entry.id === 'SEENIT-RELATION-001');
  assert.ok(requirement);
  assert.equal(requirement.tests.length, 9);
});
`);

write('tests/tvdbRelations.test.ts', `import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { classifyTVDBList, extractExactTMDBRemoteId, extractExactTVDBSearchIdentity, selectSingleOfficialTVDBList } from '../src/features/providers/mediaProviderBackend.ts';

const backendSource = readFileSync(new URL('../src/features/providers/mediaProviderBackend.ts', import.meta.url), 'utf8');
const clientSource = readFileSync(new URL('../src/services/tvdb.ts', import.meta.url), 'utf8');
const detailSource = readFileSync(new URL('../src/screens/ShowDetailScreen.tsx', import.meta.url), 'utf8');
const facadeSource = readFileSync(new URL('../src/features/shows/tmdb.ts', import.meta.url), 'utf8');

test('SEENIT-RELATION-001 résout une franchise TVDB uniquement par identifiants exacts', () => {
  assert.equal(extractExactTVDBSearchIdentity([{ type: 'movie', tvdb_id: 81 }], 'movie'), 81);
  assert.equal(extractExactTVDBSearchIdentity([{ type: 'series', tvdb_id: 81 }], 'movie'), null);
  assert.equal(extractExactTVDBSearchIdentity([{ type: 'movie', tvdb_id: 81 }, { type: 'movie', tvdb_id: 82 }], 'movie'), null);
  assert.equal(extractExactTMDBRemoteId([{ id: '94997', sourceName: 'TheMovieDB.com' }]), 94997);
  assert.match(backendSource, /search\\/remoteid\\/\\$\\{encodeURIComponent\\(imdbId\\)\\}/);
  assert.match(facadeSource, /getTVDBFranchiseRelation/);
  assert.doesNotMatch(clientSource, /api4\\.thetvdb\\.com|VITE_TVDB_API_KEY/);
});

test('SEENIT-RELATION-001 masque une relation TVDB ambiguë et refuse le titre', () => {
  const franchise = { id: 7038, isOfficial: true, name: 'Game of Thrones Franchise' };
  const universe = { id: 4, isOfficial: true, name: 'Marvel Cinematic Universe' };
  assert.equal(classifyTVDBList(franchise), 'franchise');
  assert.equal(classifyTVDBList(universe), 'universe');
  assert.deepEqual(selectSingleOfficialTVDBList([franchise]), franchise);
  assert.equal(selectSingleOfficialTVDBList([franchise, universe]), null);
  assert.doesNotMatch(clientSource, /mediaTitle|\\btitle\\b/i);
  assert.match(backendSource, /!\\['mediaType', 'tvdbId', 'imdbId'\\]\\.includes\\(key\\)/);
  assert.doesNotMatch(detailSource, /Films similaires|Séries similaires|getPrioritizedSimilarMedia/);
  assert.match(detailSource, /Dans la même franchise/);
  assert.match(detailSource, /Dans le même univers/);
});

test('SEENIT-RELATION-001 TNR House of the Dragon passe par le mécanisme commun', () => {
  const production = backendSource + '\\n' + clientSource + '\\n' + facadeSource;
  for (const namedCase of ['House of the Dragon', 'Yellowstone', 'Breaking Bad', 'Harry Potter', 'Punisher']) {
    assert.doesNotMatch(production, new RegExp(namedCase, 'i'));
  }
  assert.match(backendSource, /selectSingleOfficialTVDBList\\(mediaPayload\\?\\.data\\?\\.lists\\)/);
  assert.match(backendSource, /entities\\.slice\\(0, 120\\)/);
  assert.match(backendSource, /index \\+= 6/);
});
`);

// Sécurité fournisseur : la façade TVDB existe côté client, le secret/hôte restent côté serveur.
{
  const path = 'tests/mediaProviderSecurity.test.ts';
  let text = read(path);
  text = replaceOnce(text,
    "secrets: () => ({ TMDB_API_KEY: 'test-tmdb-private', OMDB_API_KEY: 'test-omdb-private' }),",
    "secrets: () => ({ TMDB_API_KEY: 'test-tmdb-private', OMDB_API_KEY: 'test-omdb-private', TVDB_API_KEY: 'test-tvdb-private' }),",
    'provider harness');
  text = replaceOnce(text,
    "assert.equal((await send('tvdb/franchise?mediaTitle=Example')).status, 404);",
    "assert.equal((await send('tvdb/franchise?mediaTitle=Example')).status, 400);",
    'TVDB titre refusé');
  text = replaceOnce(text,
    "assert.equal(fs.existsSync(path.join(root, 'src/services/tvdb.ts')), false);",
    "assert.equal(fs.existsSync(path.join(root, 'src/services/tvdb.ts')), true);",
    'façade TVDB présente');
  write(path, text);
}

// Ancien TNR manifeste : l'historique reste caractérisé, mais le runtime normal est désormais TMDB+TVDB.
{
  const path = 'tests/mediaRelations.test.ts';
  let text = read(path);
  text = replaceOnce(text,
    "const tmdbClientSource = readFileSync(new URL('../src/features/shows/tmdbClient.ts', import.meta.url), 'utf8');",
    "const tmdbClientSource = readFileSync(new URL('../src/features/shows/tmdbClient.ts', import.meta.url), 'utf8');\nconst tmdbFacadeSource = readFileSync(new URL('../src/features/shows/tmdb.ts', import.meta.url), 'utf8');\nconst tvdbClientSource = readFileSync(new URL('../src/services/tvdb.ts', import.meta.url), 'utf8');",
    'sources TNR runtime');
  const replacement = `test('SEENIT-RELATION-001 route la fiche par TMDB et TVDB exact sans similaires', () => {
  assert.match(tmdbFacadeSource, /getTVDBFranchiseRelation/);
  assert.match(tmdbFacadeSource, /withoutDetailRecommendations/);
  assert.match(tmdbFacadeSource, /collectionKeys\\.has\\(itemKey\\)/);
  assert.doesNotMatch(tvdbClientSource, /searchMulti|getTVDBFranchiseTimeline|api4\\.thetvdb\\.com|VITE_TVDB_API_KEY/);
  assert.doesNotMatch(detailSource, /getPrioritizedSimilarMedia|Films similaires|Séries similaires/);
});`;
  text = replaceRegexOnce(text,
    /test\('SEENIT-RELATION-001 retire les fallbacks titre TVDB et déduplique les similaires par mediaKey', \(\) => \{[\s\S]*?\n\}\);\s*$/,
    replacement + '\n',
    'TNR runtime final');
  write(path, text);
}

// Fiche média : suppression du code mort similaire + libellé TVDB dynamique.
{
  const path = 'src/screens/ShowDetailScreen.tsx';
  let text = read(path);
  text = replaceOnce(text,
    "import { mediaKeyFrom, relationMediaKeys, toMediaKey } from '../features/shows/mediaRelations';",
    "import { mediaKeyFrom, toMediaKey } from '../features/shows/mediaRelations';",
    'import relationMediaKeys');
  text = replaceRegexOnce(text, /\nconst ASIAN_COUNTRIES = [\s\S]*?(?=\nconst getKeywordsFromDetails)/, '\n', 'helper similaires');
  text = text.replace("  const [visibleSimilar, setVisibleSimilar] = useState(10);\n", '');
  text = text.replace("  const similarObserverRef = useRef<HTMLDivElement>(null);\n", '');
  text = replaceRegexOnce(text,
    /\n  useEffect\(\(\) => \{\n    const observer = new IntersectionObserver\(\(entries\) => \{\n      if \(entries\[0\]\.isIntersecting\) \{\n        setVisibleSimilar\(prev => prev \+ 10\);\n      \}\n    \}, \{ rootMargin: '100px' \}\);\n    if \(similarObserverRef\.current\) observer\.observe\(similarObserverRef\.current\);\n    return \(\) => observer\.disconnect\(\);\n  \}, \[\]\);\n/,
    '\n',
    'observer similaires');
  text = replaceOnce(text,
    `                <h3 className="text-xs font-bold uppercase text-zinc-500 tracking-wider mb-3">\n                  Dans le même univers\n                </h3>`,
    `                <h3 className="text-xs font-bold uppercase text-zinc-500 tracking-wider mb-3">\n                  {universeData.parts[0]?.seenitRelationKind === 'universe'\n                    ? 'Dans le même univers'\n                    : 'Dans la même franchise'}\n                </h3>`,
    'libellé franchise/univers');
  text = text.replace('{isSeries ? "Dans le même univers" : "Ordre de visionnage"}', 'Relations');
  text = replaceRegexOnce(text,
    /\n            \{\/\* Séries \/ Films similaires remontés dans À Propos \*\/\}[\s\S]*?(?=\n          <\/div>\n\n        \{isSeries && \()/,
    '\n',
    'rendu similaires');
  for (const forbidden of ['getPrioritizedSimilarMedia', 'Films similaires', 'Séries similaires', 'visibleSimilar', 'similarObserverRef']) {
    if (text.includes(forbidden)) throw new Error(`Fiche média contient encore ${forbidden}`);
  }
  write(path, text);
}

console.log('Finalisation #130 appliquée.');
