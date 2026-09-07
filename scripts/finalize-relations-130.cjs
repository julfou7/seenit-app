const fs = require('node:fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function write(path, content) {
  fs.writeFileSync(path, content, 'utf8');
}

function replaceOnce(path, oldValue, newValue, label) {
  const source = read(path);
  const count = source.split(oldValue).length - 1;
  if (count !== 1) {
    throw new Error(`${path} ${label}: 1 occurrence attendue, ${count} trouvée(s)`);
  }
  write(path, source.replace(oldValue, newValue));
}

replaceOnce(
  'src/features/providers/mediaProviderBackend.ts',
  "const REQUIRED_SECRET_NAMES = ['TMDB_API_KEY', 'OMDB_API_KEY'] as const;",
  "const REQUIRED_SECRET_NAMES = ['TMDB_API_KEY', 'OMDB_API_KEY', 'TVDB_API_KEY'] as const;",
  'secrets requis',
);

replaceOnce(
  'docs/specifications/media-providers.md',
  `TMDB et OMDb restent obligatoires au démarrage du backend canonique. TVDB est requis pour que la section\nfranchise/univers fonctionne ; si sa configuration est absente ou indisponible, la route relationnelle\néchoue fermée et la fiche masque seulement cette section. Pour considérer #130 déployée, la révision\nproduction doit néanmoins être validée avec TVDB configuré.`,
  `TMDB, OMDb et TVDB sont obligatoires au démarrage d'une nouvelle révision du backend canonique. Une\ncandidate à laquelle manque l'un de ces trois secrets est refusée avant promotion. Les trois variables\nsont injectées depuis Secret Manager par référence de secret ; aucune valeur fournisseur n'est copiée\ndans GitHub, le workflow ou l'export Cloud Run. Une panne fournisseur après démarrage reste fail-closed.`,
  'contrat fournisseur',
);

replaceOnce(
  'docs/specifications/media-providers.md',
  `1. Provisionner/renouveler les trois secrets via l'infrastructure Cloud Run autorisée, sans les exposer\n   dans GitHub ou une commande visible.\n2. Vérifier les appels serveur TMDB/OMDb et une résolution TVDB exacte dans un environnement autorisé.\n3. Déployer le backend canonique avant l'APK qui dépend de ces routes ; la révision candidate doit\n   réussir sa readiness avant de recevoir du trafic.\n4. Publier ensuite l'APK groupée. Une rotation future de secret ne nécessite pas de nouvelle APK.`,
  `1. Provisionner/renouveler les trois secrets dans Secret Manager, sans exposer leurs valeurs.\n2. Accorder au compte de service runtime Cloud Run le rôle Secret Manager Secret Accessor sur chacun\n   des trois secrets. Le rôle projet Editor ne donne pas accès au payload d'un secret.\n3. Le préparateur de candidate remplace toute ancienne variable en clair par une référence\n   secretKeyRef vers TMDB_API_KEY, OMDB_API_KEY et TVDB_API_KEY, version latest.\n4. Vérifier les appels serveur TMDB/OMDb et une résolution TVDB exacte dans un environnement autorisé.\n5. Déployer le backend canonique avant l'APK qui dépend de ces routes ; la candidate doit réussir sa\n   readiness et ses smokes avant de recevoir du trafic.\n6. Publier ensuite l'APK groupée. Une rotation future de secret ne nécessite pas de nouvelle APK.`,
  'livraison fournisseurs',
);

// Nettoyage des marqueurs de citation typographiques temporaires utilisés pour éviter les backticks imbriqués.
{
  const path = 'docs/specifications/media-providers.md';
  write(path, read(path).replaceAll('\u0016', '`'));
}

replaceOnce(
  'docs/specifications/functional-reference.md',
  `- \`GET /api/health\` : identité et santé du backend canonique ;\n- \`POST /api/plex/history\``,
  `- \`GET /api/health\` : identité et santé du backend canonique ;\n- \`GET /api/media/tmdb/...\`, \`GET /api/media/omdb\` et \`GET /api/media/tvdb/franchise\` : façade métadonnées authentifiée ; TVDB ne reçoit que des identifiants externes exacts ;\n- \`POST /api/plex/history\``,
  'routes fournisseurs',
);

replaceOnce(
  'docs/specifications/functional-reference.md',
  `Le catalogue relationnel SeenIt actuel est legacy pendant la migration ;\nun éventuel override futur reste exceptionnel, versionné, exact et tracé.`,
  `Le catalogue relationnel SeenIt historique est hors du chemin runtime normal ;\nun éventuel override futur reste exceptionnel, versionné, exact et tracé.`,
  'catalogue legacy',
);

replaceOnce(
  'docs/specifications/functional-reference.md',
  `La décision durable complète est figée dans\n[\`docs/decisions/media-relations-2026-09-06.md\`](../decisions/media-relations-2026-09-06.md) et dans\n\`SEENIT-RELATION-001\`. **Le runtime actuel conserve encore le catalogue relationnel SeenIt**, son\npipeline hors ligne et les sections Films/Séries similaires ; TVDB n'est donc pas encore le résolveur\nnormal de franchise/univers. Cet écart de mise en œuvre reste suivi dans l'**issue #130** et ne remet pas\nen cause la décision produit.`,
  `La décision durable complète est figée dans\n[\`docs/decisions/media-relations-2026-09-06.md\`](../decisions/media-relations-2026-09-06.md) et dans\n\`SEENIT-RELATION-001\`. Le runtime normal applique désormais ce contrat : collections TMDB pour l'ordre,\nTVDB exact pour franchise/univers et aucune section similaire sur les fiches. Le pipeline relationnel\nhistorique n'est plus une source runtime de la fiche.`,
  'écart runtime',
);

replaceOnce(
  'docs/decisions/media-relations-2026-09-06.md',
  `L'issue #130 reste donc **ouverte** jusqu'à la migration runtime, aux TNR PWA/APK et à la suppression du chemin legacy devenu inutile.`,
  `Cet écart décrit l'état historique au moment de la décision. La migration #130 remplace le chemin runtime normal par TMDB + TVDB, retire les similaires des fiches et conserve ce paragraphe uniquement comme trace de la raison du changement.`,
  'statut décision',
);

replaceOnce(
  'tests/mediaRelationsSpecification.test.ts',
  `test('SEENIT-RELATION-001 trace la décision durable et l’écart runtime', () => {`,
  `test('SEENIT-RELATION-001 fige la décision durable après migration runtime', () => {`,
  'nom TNR SPEC',
);

replaceOnce(
  'tests/mediaRelationsSpecification.test.ts',
  `  assert.match(functionalReference, /runtime actuel conserve encore le catalogue relationnel SeenIt/);\n  assert.match(functionalReference, /issue #130/);\n  assert.match(decision, /issue #130 reste donc \\*\\*ouverte\\*\\*/);`,
  `  assert.match(functionalReference, /runtime normal applique désormais ce contrat/);\n  assert.match(functionalReference, /pipeline relationnel historique n'est plus une source runtime/);\n  assert.match(decision, /migration #130 remplace le chemin runtime normal par TMDB \\+ TVDB/);`,
  'assertions runtime',
);

replaceOnce(
  'docs/specifications/requirements.json',
  'SEENIT-RELATION-001 trace la décision durable et l’écart runtime',
  'SEENIT-RELATION-001 fige la décision durable après migration runtime',
  'catalogue TNR',
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
  const oldSecretTest = `  assert.doesNotThrow(() => assertMediaProviderSecrets({\n    TMDB_API_KEY: 'configured-tmdb',\n    OMDB_API_KEY: 'configured-omdb',\n  }));\n  assert.throws(\n    () => assertMediaProviderSecrets({ TMDB_API_KEY: 'configured-tmdb' }),\n    /OMDB_API_KEY/,\n  );\n  assert.throws(\n    () => assertMediaProviderSecrets({ OMDB_API_KEY: 'configured-omdb' }),\n    /TMDB_API_KEY/,\n  );`;
  const newSecretTest = `  assert.doesNotThrow(() => assertMediaProviderSecrets({\n    TMDB_API_KEY: 'configured-tmdb',\n    OMDB_API_KEY: 'configured-omdb',\n    TVDB_API_KEY: 'configured-tvdb',\n  }));\n  assert.throws(\n    () => assertMediaProviderSecrets({ TMDB_API_KEY: 'configured-tmdb', TVDB_API_KEY: 'configured-tvdb' }),\n    /OMDB_API_KEY/,\n  );\n  assert.throws(\n    () => assertMediaProviderSecrets({ OMDB_API_KEY: 'configured-omdb', TVDB_API_KEY: 'configured-tvdb' }),\n    /TMDB_API_KEY/,\n  );\n  assert.throws(\n    () => assertMediaProviderSecrets({ TMDB_API_KEY: 'configured-tmdb', OMDB_API_KEY: 'configured-omdb' }),\n    /TVDB_API_KEY/,\n  );`;
  if (!source.includes(oldSecretTest)) throw new Error('bloc test secrets introuvable');
  source = source.replace(oldSecretTest, newSecretTest);
  const oldClientAssertion = "  assert.equal(fs.existsSync(path.join(root, 'src/services/tvdb.ts')), false);";
  const newClientAssertion = `  assert.equal(fs.existsSync(path.join(root, 'src/services/tvdb.ts')), true);\n  const tvdbClient = fs.readFileSync(path.join(root, 'src/services/tvdb.ts'), 'utf8');\n  assert.match(tvdbClient, /\\/api\\/media\\/tvdb\\/franchise/);\n  assert.doesNotMatch(tvdbClient, /TVDB_API_KEY|api4\\.thetvdb\\.com|search\\/remoteid/);`;
  if (!source.includes(oldClientAssertion)) throw new Error('assertion client TVDB introuvable');
  source = source.replace(oldClientAssertion, newClientAssertion);
  write(path, source);
}

write('tests/mediaRelations.test.ts', `import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { toMediaKey } from '../src/features/shows/mediaRelations.ts';

const tmdbSource = readFileSync(new URL('../src/features/shows/tmdb.ts', import.meta.url), 'utf8');
const tvdbClientSource = readFileSync(new URL('../src/services/tvdb.ts', import.meta.url), 'utf8');
const detailSource = readFileSync(new URL('../src/screens/ShowDetailScreen.tsx', import.meta.url), 'utf8');
const explorerSource = readFileSync(new URL('../src/lib/recommendations.ts', import.meta.url), 'utf8');

test('SEENIT-RELATION-001 conserve une identité typée movie et tv', () => {
  assert.equal(toMediaKey('movie', 42), 'movie:42');
  assert.equal(toMediaKey('tv', 42), 'tv:42');
  assert.notEqual(toMediaKey('movie', 42), toMediaKey('tv', 42));
});

test('SEENIT-RELATION-001 réserve la saga film à la collection TMDB exacte', () => {
  assert.match(tmdbSource, /mediaType !== 'movie'\\) return \\[\\]/);
  assert.match(tmdbSource, /belongs_to_collection\\?\\.id/);
  assert.match(tmdbSource, /getCollectionDetails\\(collectionId\\)/);
  assert.doesNotMatch(tmdbSource, /getManifestRelationSnapshot/);
});

test('SEENIT-RELATION-001 appelle TVDB uniquement avec les identifiants externes exacts', () => {
  assert.match(tmdbSource, /external_ids\\?\\.tvdb_id/);
  assert.match(tmdbSource, /external_ids\\?\\.imdb_id/);
  assert.match(tmdbSource, /getTVDBFranchiseRelation/);
  assert.match(tvdbClientSource, /authenticatedFetch/);
  assert.match(tvdbClientSource, /\\/api\\/media\\/tvdb\\/franchise/);
  assert.doesNotMatch(tvdbClientSource, /mediaTitle|original_title|popularity|api4\\.thetvdb\\.com|TVDB_API_KEY/);
});

test('SEENIT-RELATION-001 déduplique TVDB après la collection par clé typée', () => {
  assert.match(tmdbSource, /collectionKeys\\.has\\(itemKey\\)/);
  assert.match(tmdbSource, /universeSeen\\.has\\(itemKey\\)/);
  assert.match(tmdbSource, /seenitRelationKind: relationKind/);
});

test('SEENIT-RELATION-001 retire les similaires de la fiche mais pas la découverte Explorer', () => {
  assert.match(tmdbSource, /const \\{ similar: _similar, recommendations: _recommendations, \\.\\.\\.rest \\} = details/);
  assert.doesNotMatch(detailSource, /getPrioritizedSimilarMedia|Films similaires|Séries similaires|visibleSimilar|similarObserverRef/);
  assert.match(detailSource, /Dans la même franchise/);
  assert.match(detailSource, /seenitRelationKind === 'franchise'/);
  assert.match(explorerSource, /recommend/i);
});
`);

write('tests/tvdbRelations.test.ts', `import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyTVDBList,
  extractExactTMDBRemoteId,
  extractExactTVDBSearchIdentity,
  getTVDBEntityIdentity,
  selectSingleOfficialTVDBList,
} from '../src/features/providers/mediaProviderBackend.ts';

test('SEENIT-RELATION-001 qualifie uniquement franchise ou univers explicites', () => {
  assert.equal(classifyTVDBList({ name: 'Game of Thrones Franchise' }), 'franchise');
  assert.equal(classifyTVDBList({ name: 'Marvel Cinematic Universe' }), 'universe');
  assert.equal(classifyTVDBList({ name: 'Award Winners' }), null);
});

test('SEENIT-RELATION-001 retient une seule liste officielle admissible', () => {
  const franchise = { id: 7038, isOfficial: true, name: 'Game of Thrones Franchise' };
  assert.deepEqual(selectSingleOfficialTVDBList([franchise]), franchise);
  assert.equal(selectSingleOfficialTVDBList([franchise, { id: 2, isOfficial: true, name: 'Other Franchise' }]), null);
  assert.equal(selectSingleOfficialTVDBList([{ id: 1, isOfficial: true, name: 'Award Winners' }]), null);
  assert.equal(selectSingleOfficialTVDBList([{ id: 1, isOfficial: false, name: 'Example Franchise' }]), null);
});

test('SEENIT-RELATION-001 conserve le type exact des membres TVDB', () => {
  assert.deepEqual(getTVDBEntityIdentity({ seriesId: 121361 }), { id: 121361, media_type: 'tv' });
  assert.deepEqual(getTVDBEntityIdentity({ movieId: 603 }), { id: 603, media_type: 'movie' });
  assert.equal(getTVDBEntityIdentity({ seriesId: 1, movieId: 2 }), null);
});

test('SEENIT-RELATION-001 remappe un membre TVDB vers un unique TMDB exact', () => {
  assert.equal(extractExactTMDBRemoteId([{ type: 12, id: '94997' }]), 94997);
  assert.equal(extractExactTMDBRemoteId([{ sourceName: 'TMDB', id: '94997' }]), 94997);
  assert.equal(extractExactTMDBRemoteId([{ type: 12, id: '1' }, { type: 12, id: '2' }]), null);
});

test('SEENIT-RELATION-001 résout le pont IMDb remoteid sans premier résultat arbitraire', () => {
  assert.equal(extractExactTVDBSearchIdentity([{ type: 'movie', tvdb_id: '123' }], 'movie'), 123);
  assert.equal(extractExactTVDBSearchIdentity([{ type: 'series', tvdb_id: '456' }], 'tv'), 456);
  assert.equal(extractExactTVDBSearchIdentity([{ type: 'movie', tvdb_id: '123' }, { type: 'movie', tvdb_id: '456' }], 'movie'), null);
  assert.equal(extractExactTVDBSearchIdentity([{ type: 'series', tvdb_id: '456' }], 'movie'), null);
});
`);

// Secret Manager devient la source explicite des variables runtime fournisseur.
{
  const path = 'scripts/prepare-cloud-run-candidate.cjs';
  let source = read(path);
  const secretHelper = `function forceSingleContainerSecretEnv(lines, imageIndex, name, secretName, version = 'latest') {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error(\`Nom de variable secret invalide: \${name}\`);
  if (!/^[A-Za-z0-9_-]{1,255}$/.test(secretName)) throw new Error(\`Nom Secret Manager invalide: \${secretName}\`);
  if (!/^(?:latest|[1-9]\\d*)$/.test(String(version))) throw new Error(\`Version Secret Manager invalide: \${version}\`);

  const { containerStart, containerEnd } = getSingleContainerBounds(lines, imageIndex);
  let envIndex = lines.findIndex((line, index) => (
    index >= containerStart
    && index < containerEnd
    && /^(?:      - |        )env:\\s*$/.test(line)
  ));
  const entry = [
    \`        - name: \${name}\`,
    '          valueFrom:',
    '            secretKeyRef:',
    \`              key: \${version}\`,
    \`              name: \${secretName}\`,
  ];

  if (envIndex < 0) {
    if (/^      - image:\\s*/.test(lines[imageIndex])) {
      lines[imageIndex] = lines[imageIndex].replace(/^      - image:/, '        image:');
      lines.splice(imageIndex, 0, '      - env:', ...entry);
      return;
    }
    if (/^        image:\\s*/.test(lines[imageIndex])) {
      lines.splice(imageIndex, 0, '        env:', ...entry);
      return;
    }
    throw new Error(\`Bloc env du conteneur introuvable pour lier \${name}.\`);
  }

  let envEnd = containerEnd;
  for (let index = envIndex + 1; index < containerEnd; index += 1) {
    if (/^        [A-Za-z0-9_-]+:\\s*/.test(lines[index])) {
      envEnd = index;
      break;
    }
  }

  const starts = [];
  for (let index = envIndex + 1; index < envEnd; index += 1) {
    if (new RegExp(\`^        - name:\\\\s*['\\\"]?\${name}['\\\"]?\\\\s*$\`).test(lines[index])) starts.push(index);
  }
  if (starts.length > 1) throw new Error(\`Variable runtime \${name} dupliquée dans l'export Cloud Run.\`);
  if (starts.length === 0) {
    lines.splice(envIndex + 1, 0, ...entry);
    return;
  }

  const start = starts[0];
  let end = envEnd;
  for (let index = start + 1; index < envEnd; index += 1) {
    if (/^        - name:\\s*/.test(lines[index])) {
      end = index;
      break;
    }
  }
  lines.splice(start, end - start, ...entry);
}

`;
  const helperMarker = 'function normalizeTraffic(lines, trafficIndex, trafficEnd, previousRevision, candidateRevision, candidateTag) {';
  if (!source.includes(secretHelper.trim()) && !source.includes('function forceSingleContainerSecretEnv')) {
    if (!source.includes(helperMarker)) throw new Error('marqueur helper secret introuvable');
    source = source.replace(helperMarker, secretHelper + helperMarker);
  }

  const oldEnv = `  forceSingleContainerEnv(lines, imageIndexes[0], 'NODE_ENV', 'production');\n  const refreshedImageIndex = lines.findIndex(line => /^\\s*(?:-\\s*)?image:\\s*\\S+\\s*$/.test(line));`;
  const newEnv = `  forceSingleContainerEnv(lines, imageIndexes[0], 'NODE_ENV', 'production');\n  for (const secretName of ['TMDB_API_KEY', 'OMDB_API_KEY', 'TVDB_API_KEY']) {\n    const secretImageIndex = lines.findIndex(line => /^\\s*(?:-\\s*)?image:\\s*\\S+\\s*$/.test(line));\n    if (secretImageIndex < 0) throw new Error('Ligne image perdue avant injection Secret Manager.');\n    forceSingleContainerSecretEnv(lines, secretImageIndex, secretName, secretName, 'latest');\n  }\n  const refreshedImageIndex = lines.findIndex(line => /^\\s*(?:-\\s*)?image:\\s*\\S+\\s*$/.test(line));`;
  if (!source.includes(oldEnv)) throw new Error('bloc NODE_ENV introuvable');
  source = source.replace(oldEnv, newEnv);

  const oldVerify = `  if (!/name:\\s*NODE_ENV\\s*\\n\\s*value:\\s*production/.test(prepared)) throw new Error('NODE_ENV=production n’a pas été forcé sur le runtime candidat.');`;
  const newVerify = `${oldVerify}\n  for (const secretName of ['TMDB_API_KEY', 'OMDB_API_KEY', 'TVDB_API_KEY']) {\n    const escaped = secretName.replace(/[.*+?^\\${}()|[\\]\\\\]/g, '\\\\$&');\n    const secretPattern = new RegExp(\`name:\\\\s*\${escaped}\\\\s*\\\\n\\\\s*valueFrom:\\\\s*\\\\n\\\\s*secretKeyRef:\\\\s*\\\\n\\\\s*key:\\\\s*latest\\\\s*\\\\n\\\\s*name:\\\\s*\${escaped}(?:\\\\s|$)\`);\n    if (!secretPattern.test(prepared)) throw new Error(\`Référence Secret Manager absente pour \${secretName}.\`);\n  }`;
  if (!source.includes(oldVerify)) throw new Error('validation NODE_ENV introuvable');
  source = source.replace(oldVerify, newVerify);

  const oldExports = 'module.exports = { deriveCandidateTag, forceSingleContainerEnv, getSingleContainerBounds, normalizeSingleContainerLaunch, normalizeTraffic, parseArgs, prepareCandidateService, validateRevisionName };';
  const newExports = 'module.exports = { deriveCandidateTag, forceSingleContainerEnv, forceSingleContainerSecretEnv, getSingleContainerBounds, normalizeSingleContainerLaunch, normalizeTraffic, parseArgs, prepareCandidateService, validateRevisionName };';
  if (!source.includes(oldExports)) throw new Error('exports candidate introuvables');
  source = source.replace(oldExports, newExports);
  write(path, source);
}

// Le bootstrap rend l'accès Secret Manager reproductible et least-privilege.
{
  const path = 'scripts/bootstrap-gcp-backend-deploy.sh';
  let source = read(path);
  const marker = `gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \\\n  --member="serviceAccount:\${DEPLOY_SA}" \\\n  --role="roles/iam.serviceAccountUser" \\\n  --quiet >/dev/null`;
  const binding = `for secret in TMDB_API_KEY OMDB_API_KEY TVDB_API_KEY; do\n  if ! gcloud secrets describe "$secret" --project "$PROJECT_ID" >/dev/null 2>&1; then\n    printf 'Secret Manager requis absent: %s\\n' "$secret" >&2\n    exit 1\n  fi\n  gcloud secrets add-iam-policy-binding "$secret" \\\n    --project "$PROJECT_ID" \\\n    --member="serviceAccount:\${RUNTIME_SA}" \\\n    --role="roles/secretmanager.secretAccessor" \\\n    --condition=None \\\n    --quiet >/dev/null\ndone\n\n${marker}`;
  if (!source.includes(marker)) throw new Error('marqueur IAM runtime introuvable');
  source = source.replace(marker, binding);
  write(path, source);
}

// TNR du déploiement : références Secret Manager + IAM runtime.
{
  const path = 'tests/backendDeploymentWorkflow.test.ts';
  let source = read(path);
  const block = `\ntest('SEENIT-SECURITY-001 injecte les trois secrets fournisseur depuis Secret Manager', () => {\n  assert.match(sanitizer, /forceSingleContainerSecretEnv/);\n  assert.match(sanitizer, /secretKeyRef/);\n  for (const name of ['TMDB_API_KEY', 'OMDB_API_KEY', 'TVDB_API_KEY']) {\n    assert.match(sanitizer, new RegExp(name));\n  }\n  assert.match(bootstrap, /TMDB_API_KEY OMDB_API_KEY TVDB_API_KEY/);\n  assert.match(bootstrap, /roles\\/secretmanager\\.secretAccessor/);\n  assert.match(bootstrap, /serviceAccount:\\$\\{RUNTIME_SA\\}/);\n});\n`;
  if (!source.includes("SEENIT-SECURITY-001 injecte les trois secrets fournisseur depuis Secret Manager")) {
    source += block;
  }
  write(path, source);
}

console.log('Finalisation #130 appliquée.');
