const fs = require('node:fs');

const read = (path) => fs.readFileSync(path, 'utf8');
const write = (path, value) => fs.writeFileSync(path, value, 'utf8');

function replaceOnce(path, before, after, label) {
  const source = read(path);
  if (!source.includes(before)) throw new Error(`${path}: ${label} introuvable`);
  write(path, source.replace(before, after));
}

replaceOnce(
  'src/features/providers/mediaProviderBackend.ts',
  "const REQUIRED_SECRET_NAMES = ['TMDB_API_KEY', 'OMDB_API_KEY'] as const;",
  "const REQUIRED_SECRET_NAMES = ['TMDB_API_KEY', 'OMDB_API_KEY', 'TVDB_API_KEY'] as const;",
  'secrets requis',
);

replaceOnce(
  'docs/specifications/media-providers.md',
  'TMDB et OMDb restent obligatoires au démarrage du backend canonique. TVDB est requis pour que la section\nfranchise/univers fonctionne ; si sa configuration est absente ou indisponible, la route relationnelle\néchoue fermée et la fiche masque seulement cette section. Pour considérer #130 déployée, la révision\nproduction doit néanmoins être validée avec TVDB configuré.',
  "TMDB, OMDb et TVDB sont obligatoires au démarrage d'une nouvelle révision du backend canonique. Une\ncandidate à laquelle manque l'un de ces trois secrets est refusée avant promotion. Les trois variables\nsont injectées depuis Secret Manager par référence de secret ; aucune valeur fournisseur n'est copiée\ndans GitHub, le workflow ou l'export Cloud Run. Une panne fournisseur après démarrage reste fail-closed.",
  'contrat de démarrage fournisseurs',
);

replaceOnce(
  'docs/specifications/media-providers.md',
  '1. Provisionner/renouveler les trois secrets via l\'infrastructure Cloud Run autorisée, sans les exposer\n   dans GitHub ou une commande visible.\n2. Vérifier les appels serveur TMDB/OMDb et une résolution TVDB exacte dans un environnement autorisé.\n3. Déployer le backend canonique avant l\'APK qui dépend de ces routes ; la révision candidate doit\n   réussir sa readiness avant de recevoir du trafic.\n4. Publier ensuite l\'APK groupée. Une rotation future de secret ne nécessite pas de nouvelle APK.',
  '1. Provisionner/renouveler les trois secrets dans Secret Manager, sans exposer leurs valeurs.\n2. Accorder au compte de service runtime Cloud Run le rôle `Secret Manager Secret Accessor` sur chacun\n   des trois secrets. Le rôle projet `Editor` ne donne pas accès au payload d\'un secret.\n3. Le préparateur de candidate remplace toute ancienne variable en clair par une référence\n   `secretKeyRef` vers `TMDB_API_KEY`, `OMDB_API_KEY` et `TVDB_API_KEY`, version `latest`.\n4. Vérifier les appels serveur TMDB/OMDb et une résolution TVDB exacte dans un environnement autorisé.\n5. Déployer le backend canonique avant l\'APK qui dépend de ces routes ; la candidate doit réussir sa\n   readiness et ses smokes avant de recevoir du trafic.\n6. Publier ensuite l\'APK groupée. Une rotation future de secret ne nécessite pas de nouvelle APK.',
  'procédure secrets',
);

replaceOnce(
  'docs/specifications/functional-reference.md',
  '- `GET /api/health` : identité et santé du backend canonique ;\n- `POST /api/plex/history`',
  '- `GET /api/health` : identité et santé du backend canonique ;\n- `GET /api/media/tmdb/...`, `GET /api/media/omdb` et `GET /api/media/tvdb/franchise` : façade métadonnées authentifiée ; TVDB ne reçoit que des identifiants externes exacts ;\n- `POST /api/plex/history`',
  'routes métadonnées',
);

replaceOnce(
  'docs/specifications/functional-reference.md',
  'Le catalogue relationnel SeenIt actuel est legacy pendant la migration ;\nun éventuel override futur reste exceptionnel, versionné, exact et tracé.',
  'Le catalogue relationnel SeenIt historique est hors du chemin runtime normal ;\nun éventuel override futur reste exceptionnel, versionné, exact et tracé.',
  'catalogue legacy',
);

replaceOnce(
  'docs/specifications/functional-reference.md',
  'La décision durable complète est figée dans\n[`docs/decisions/media-relations-2026-09-06.md`](../decisions/media-relations-2026-09-06.md) et dans\n`SEENIT-RELATION-001`. **Le runtime actuel conserve encore le catalogue relationnel SeenIt**, son\npipeline hors ligne et les sections Films/Séries similaires ; TVDB n\'est donc pas encore le résolveur\nnormal de franchise/univers. Cet écart de mise en œuvre reste suivi dans l\'**issue #130** et ne remet pas\nen cause la décision produit.',
  'La décision durable complète est figée dans\n[`docs/decisions/media-relations-2026-09-06.md`](../decisions/media-relations-2026-09-06.md) et dans\n`SEENIT-RELATION-001`. Le runtime normal applique désormais ce contrat : collections TMDB pour l\'ordre,\nTVDB exact pour franchise/univers et aucune section similaire sur les fiches. Le pipeline relationnel\nhistorique n\'est plus une source runtime de la fiche.',
  'écart runtime',
);

replaceOnce(
  'docs/decisions/media-relations-2026-09-06.md',
  'L\'issue #130 reste donc **ouverte** jusqu\'à la migration runtime, aux TNR PWA/APK et à la suppression du chemin legacy devenu inutile.',
  'Cet écart décrit l\'état historique au moment de la décision. La migration #130 remplace le chemin runtime normal par TMDB + TVDB, retire les similaires des fiches et conserve ce paragraphe uniquement comme trace de la raison du changement.',
  'historique décision',
);

replaceOnce(
  'tests/mediaRelationsSpecification.test.ts',
  "test('SEENIT-RELATION-001 trace la décision durable et l’écart runtime', () => {",
  "test('SEENIT-RELATION-001 fige la décision durable après migration runtime', () => {",
  'nom test SPEC',
);
replaceOnce(
  'tests/mediaRelationsSpecification.test.ts',
  '  assert.match(functionalReference, /runtime actuel conserve encore le catalogue relationnel SeenIt/);\n  assert.match(functionalReference, /issue #130/);\n  assert.match(decision, /issue #130 reste donc \\*\\*ouverte\\*\\*/);',
  '  assert.match(functionalReference, /runtime normal applique désormais ce contrat/);\n  assert.match(functionalReference, /pipeline relationnel historique n\'est plus une source runtime/);\n  assert.match(decision, /migration #130 remplace le chemin runtime normal par TMDB \\+ TVDB/);',
  'assertions SPEC runtime',
);
replaceOnce(
  'docs/specifications/requirements.json',
  'SEENIT-RELATION-001 trace la décision durable et l’écart runtime',
  'SEENIT-RELATION-001 fige la décision durable après migration runtime',
  'catalogue test',
);

{
  const path = 'tests/mediaProviderSecurity.test.ts';
  let source = read(path);
  source = source.replace(
    "secrets: () => ({ TMDB_API_KEY: 'test-tmdb-private', OMDB_API_KEY: 'test-omdb-private' }),",
    "secrets: () => ({ TMDB_API_KEY: 'test-tmdb-private', OMDB_API_KEY: 'test-omdb-private', TVDB_API_KEY: 'test-tvdb-private' }),",
  );
  source = source.replace(
    "assert.equal((await send('tvdb/franchise?mediaTitle=Example')).status, 404);",
    "assert.equal((await send('tvdb/franchise?mediaTitle=Example')).status, 400);",
  );
  const oldBlock = [
    "  assert.doesNotThrow(() => assertMediaProviderSecrets({",
    "    TMDB_API_KEY: 'configured-tmdb',",
    "    OMDB_API_KEY: 'configured-omdb',",
    '  }));',
    '  assert.throws(',
    "    () => assertMediaProviderSecrets({ TMDB_API_KEY: 'configured-tmdb' }),",
    '    /OMDB_API_KEY/,',
    '  );',
    '  assert.throws(',
    "    () => assertMediaProviderSecrets({ OMDB_API_KEY: 'configured-omdb' }),",
    '    /TMDB_API_KEY/,',
    '  );',
  ].join('\n');
  const newBlock = [
    "  assert.doesNotThrow(() => assertMediaProviderSecrets({",
    "    TMDB_API_KEY: 'configured-tmdb',",
    "    OMDB_API_KEY: 'configured-omdb',",
    "    TVDB_API_KEY: 'configured-tvdb',",
    '  }));',
    '  assert.throws(',
    "    () => assertMediaProviderSecrets({ TMDB_API_KEY: 'configured-tmdb', TVDB_API_KEY: 'configured-tvdb' }),",
    '    /OMDB_API_KEY/,',
    '  );',
    '  assert.throws(',
    "    () => assertMediaProviderSecrets({ OMDB_API_KEY: 'configured-omdb', TVDB_API_KEY: 'configured-tvdb' }),",
    '    /TMDB_API_KEY/,',
    '  );',
    '  assert.throws(',
    "    () => assertMediaProviderSecrets({ TMDB_API_KEY: 'configured-tmdb', OMDB_API_KEY: 'configured-omdb' }),",
    '    /TVDB_API_KEY/,',
    '  );',
  ].join('\n');
  if (!source.includes(oldBlock)) throw new Error('bloc tests secrets introuvable');
  source = source.replace(oldBlock, newBlock);
  source = source.replace(
    "  assert.equal(fs.existsSync(path.join(root, 'src/services/tvdb.ts')), false);",
    [
      "  assert.equal(fs.existsSync(path.join(root, 'src/services/tvdb.ts')), true);",
      "  const tvdbClient = fs.readFileSync(path.join(root, 'src/services/tvdb.ts'), 'utf8');",
      '  assert.match(tvdbClient, /\\/api\\/media\\/tvdb\\/franchise/);',
      '  assert.doesNotMatch(tvdbClient, /TVDB_API_KEY|api4\\.thetvdb\\.com|search\\/remoteid/);',
    ].join('\n'),
  );
  write(path, source);
}

write('tests/mediaRelations.test.ts', [
  "import assert from 'node:assert/strict';",
  "import { readFileSync } from 'node:fs';",
  "import test from 'node:test';",
  "import { toMediaKey } from '../src/features/shows/mediaRelations.ts';",
  '',
  "const tmdbSource = readFileSync(new URL('../src/features/shows/tmdb.ts', import.meta.url), 'utf8');",
  "const tvdbClientSource = readFileSync(new URL('../src/services/tvdb.ts', import.meta.url), 'utf8');",
  "const detailSource = readFileSync(new URL('../src/screens/ShowDetailScreen.tsx', import.meta.url), 'utf8');",
  "const explorerSource = readFileSync(new URL('../src/lib/recommendations.ts', import.meta.url), 'utf8');",
  '',
  "test('SEENIT-RELATION-001 conserve une identité typée movie et tv', () => {",
  "  assert.equal(toMediaKey('movie', 42), 'movie:42');",
  "  assert.equal(toMediaKey('tv', 42), 'tv:42');",
  "  assert.notEqual(toMediaKey('movie', 42), toMediaKey('tv', 42));",
  '});',
  '',
  "test('SEENIT-RELATION-001 réserve la saga film à la collection TMDB exacte', () => {",
  "  assert.match(tmdbSource, /mediaType !== 'movie'\\) return \\[\\]/);",
  '  assert.match(tmdbSource, /belongs_to_collection\\?\\.id/);',
  '  assert.match(tmdbSource, /getCollectionDetails\\(collectionId\\)/);',
  '  assert.doesNotMatch(tmdbSource, /getManifestRelationSnapshot/);',
  '});',
  '',
  "test('SEENIT-RELATION-001 appelle TVDB uniquement avec les identifiants externes exacts', () => {",
  '  assert.match(tmdbSource, /external_ids\\?\\.tvdb_id/);',
  '  assert.match(tmdbSource, /external_ids\\?\\.imdb_id/);',
  '  assert.match(tmdbSource, /getTVDBFranchiseRelation/);',
  '  assert.match(tvdbClientSource, /authenticatedFetch/);',
  '  assert.match(tvdbClientSource, /\\/api\\/media\\/tvdb\\/franchise/);',
  '  assert.doesNotMatch(tvdbClientSource, /mediaTitle|original_title|popularity|api4\\.thetvdb\\.com|TVDB_API_KEY/);',
  '});',
  '',
  "test('SEENIT-RELATION-001 déduplique TVDB après la collection par clé typée', () => {",
  '  assert.match(tmdbSource, /collectionKeys\\.has\\(itemKey\\)/);',
  '  assert.match(tmdbSource, /universeSeen\\.has\\(itemKey\\)/);',
  '  assert.match(tmdbSource, /seenitRelationKind: relationKind/);',
  '});',
  '',
  "test('SEENIT-RELATION-001 retire les similaires de la fiche mais pas la découverte Explorer', () => {",
  '  assert.match(tmdbSource, /similar: _similar, recommendations: _recommendations/);',
  '  assert.doesNotMatch(detailSource, /getPrioritizedSimilarMedia|Films similaires|Séries similaires|visibleSimilar|similarObserverRef/);',
  '  assert.match(detailSource, /Dans la même franchise/);',
  "  assert.match(detailSource, /seenitRelationKind === 'franchise'/);",
  '  assert.match(explorerSource, /recommend/i);',
  '});',
  '',
].join('\n'));

write('tests/tvdbRelations.test.ts', [
  "import assert from 'node:assert/strict';",
  "import test from 'node:test';",
  'import {',
  '  classifyTVDBList,',
  '  extractExactTMDBRemoteId,',
  '  extractExactTVDBSearchIdentity,',
  '  getTVDBEntityIdentity,',
  '  selectSingleOfficialTVDBList,',
  "} from '../src/features/providers/mediaProviderBackend.ts';",
  '',
  "test('SEENIT-RELATION-001 qualifie uniquement franchise ou univers explicites', () => {",
  "  assert.equal(classifyTVDBList({ name: 'Game of Thrones Franchise' }), 'franchise');",
  "  assert.equal(classifyTVDBList({ name: 'Marvel Cinematic Universe' }), 'universe');",
  "  assert.equal(classifyTVDBList({ name: 'Award Winners' }), null);",
  '});',
  '',
  "test('SEENIT-RELATION-001 retient une seule liste officielle admissible', () => {",
  "  const franchise = { id: 7038, isOfficial: true, name: 'Game of Thrones Franchise' };",
  '  assert.deepEqual(selectSingleOfficialTVDBList([franchise]), franchise);',
  "  assert.equal(selectSingleOfficialTVDBList([franchise, { id: 2, isOfficial: true, name: 'Other Franchise' }]), null);",
  "  assert.equal(selectSingleOfficialTVDBList([{ id: 1, isOfficial: true, name: 'Award Winners' }]), null);",
  "  assert.equal(selectSingleOfficialTVDBList([{ id: 1, isOfficial: false, name: 'Example Franchise' }]), null);",
  '});',
  '',
  "test('SEENIT-RELATION-001 conserve le type exact des membres TVDB', () => {",
  "  assert.deepEqual(getTVDBEntityIdentity({ seriesId: 121361 }), { id: 121361, media_type: 'tv' });",
  "  assert.deepEqual(getTVDBEntityIdentity({ movieId: 603 }), { id: 603, media_type: 'movie' });",
  '  assert.equal(getTVDBEntityIdentity({ seriesId: 1, movieId: 2 }), null);',
  '});',
  '',
  "test('SEENIT-RELATION-001 remappe un membre TVDB vers un unique TMDB exact', () => {",
  "  assert.equal(extractExactTMDBRemoteId([{ type: 12, id: '94997' }]), 94997);",
  "  assert.equal(extractExactTMDBRemoteId([{ sourceName: 'TMDB', id: '94997' }]), 94997);",
  "  assert.equal(extractExactTMDBRemoteId([{ type: 12, id: '1' }, { type: 12, id: '2' }]), null);",
  '});',
  '',
  "test('SEENIT-RELATION-001 résout le pont IMDb remoteid sans premier résultat arbitraire', () => {",
  "  assert.equal(extractExactTVDBSearchIdentity([{ type: 'movie', tvdb_id: '123' }], 'movie'), 123);",
  "  assert.equal(extractExactTVDBSearchIdentity([{ type: 'series', tvdb_id: '456' }], 'tv'), 456);",
  "  assert.equal(extractExactTVDBSearchIdentity([{ type: 'movie', tvdb_id: '123' }, { type: 'movie', tvdb_id: '456' }], 'movie'), null);",
  "  assert.equal(extractExactTVDBSearchIdentity([{ type: 'series', tvdb_id: '456' }], 'movie'), null);",
  '});',
  '',
].join('\n'));

{
  const path = 'scripts/prepare-cloud-run-candidate.cjs';
  let source = read(path);
  const marker = 'function normalizeTraffic(lines, trafficIndex, trafficEnd, previousRevision, candidateRevision, candidateTag) {';
  const helper = [
    "function forceSingleContainerSecretEnv(lines, imageIndex, name, secretName, version = 'latest') {",
    '  const { containerStart, containerEnd } = getSingleContainerBounds(lines, imageIndex);',
    "  const envIndex = lines.findIndex((line, index) => index >= containerStart && index < containerEnd && /^(?:      - |        )env:\\s*$/.test(line));",
    '  const entry = [',
    "    '        - name: ' + name,",
    "    '          valueFrom:',",
    "    '            secretKeyRef:',",
    "    '              key: ' + version,",
    "    '              name: ' + secretName,",
    '  ];',
    '',
    '  if (envIndex < 0) {',
    "    if (/^      - image:\\s*/.test(lines[imageIndex])) {",
    "      lines[imageIndex] = lines[imageIndex].replace(/^      - image:/, '        image:');",
    "      lines.splice(imageIndex, 0, '      - env:', ...entry);",
    '      return;',
    '    }',
    "    if (/^        image:\\s*/.test(lines[imageIndex])) {",
    "      lines.splice(imageIndex, 0, '        env:', ...entry);",
    '      return;',
    '    }',
    "    throw new Error('Bloc env du conteneur introuvable pour lier ' + name + '.');",
    '  }',
    '',
    '  let envEnd = containerEnd;',
    '  for (let index = envIndex + 1; index < containerEnd; index += 1) {',
    "    if (/^        [A-Za-z0-9_-]+:\\s*/.test(lines[index])) { envEnd = index; break; }",
    '  }',
    "  const expectedName = '- name: ' + name;",
    '  let start = -1;',
    '  for (let index = envIndex + 1; index < envEnd; index += 1) {',
    '    if (lines[index].trim() === expectedName) {',
    "      if (start >= 0) throw new Error('Variable runtime ' + name + ' dupliquée dans l export Cloud Run.');",
    '      start = index;',
    '    }',
    '  }',
    '  if (start < 0) { lines.splice(envIndex + 1, 0, ...entry); return; }',
    '  let end = envEnd;',
    '  for (let index = start + 1; index < envEnd; index += 1) {',
    "    if (/^        - name:\\s*/.test(lines[index])) { end = index; break; }",
    '  }',
    '  lines.splice(start, end - start, ...entry);',
    '}',
    '',
  ].join('\n');
  if (!source.includes('function forceSingleContainerSecretEnv')) {
    if (!source.includes(marker)) throw new Error('marqueur helper Cloud Run introuvable');
    source = source.replace(marker, helper + '\n' + marker);
  }
  const oldCall = "  forceSingleContainerEnv(lines, imageIndexes[0], 'NODE_ENV', 'production');\n  const refreshedImageIndex = lines.findIndex(line => /^\\s*(?:-\\s*)?image:\\s*\\S+\\s*$/.test(line));";
  const newCall = "  forceSingleContainerEnv(lines, imageIndexes[0], 'NODE_ENV', 'production');\n  for (const secretName of ['TMDB_API_KEY', 'OMDB_API_KEY', 'TVDB_API_KEY']) {\n    const secretImageIndex = lines.findIndex(line => /^\\s*(?:-\\s*)?image:\\s*\\S+\\s*$/.test(line));\n    if (secretImageIndex < 0) throw new Error('Ligne image perdue avant injection Secret Manager.');\n    forceSingleContainerSecretEnv(lines, secretImageIndex, secretName, secretName, 'latest');\n  }\n  const refreshedImageIndex = lines.findIndex(line => /^\\s*(?:-\\s*)?image:\\s*\\S+\\s*$/.test(line));";
  if (!source.includes(oldCall)) throw new Error('appel NODE_ENV Cloud Run introuvable');
  source = source.replace(oldCall, newCall);

  const oldVerify = "  if (!/name:\\s*NODE_ENV\\s*\\n\\s*value:\\s*production/.test(prepared)) throw new Error('NODE_ENV=production n’a pas été forcé sur le runtime candidat.');";
  const verifyLines = [
    oldVerify,
    "  for (const secretName of ['TMDB_API_KEY', 'OMDB_API_KEY', 'TVDB_API_KEY']) {",
    "    const marker = '- name: ' + secretName + '\\n          valueFrom:\\n            secretKeyRef:\\n              key: latest\\n              name: ' + secretName;",
    "    if (!prepared.includes(marker)) throw new Error('Référence Secret Manager absente pour ' + secretName + '.');",
    '  }',
  ].join('\n');
  if (!source.includes(oldVerify)) throw new Error('validation NODE_ENV Cloud Run introuvable');
  source = source.replace(oldVerify, verifyLines);

  source = source.replace(
    'module.exports = { deriveCandidateTag, forceSingleContainerEnv, getSingleContainerBounds, normalizeSingleContainerLaunch, normalizeTraffic, parseArgs, prepareCandidateService, validateRevisionName };',
    'module.exports = { deriveCandidateTag, forceSingleContainerEnv, forceSingleContainerSecretEnv, getSingleContainerBounds, normalizeSingleContainerLaunch, normalizeTraffic, parseArgs, prepareCandidateService, validateRevisionName };',
  );
  write(path, source);
}

console.log('Finalisation v2 #130 appliquée.');
