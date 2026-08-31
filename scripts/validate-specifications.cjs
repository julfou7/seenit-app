const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const cataloguePath = path.join(root, 'docs/specifications/requirements.json');
const allowedTargets = new Set(['backend', 'pwa', 'apk', 'ci']);

function fail(message) {
  console.error(`[SPEC] ${message}`);
  process.exitCode = 1;
}

function read(relativePath) {
  const absolutePath = path.resolve(root, relativePath);
  if (!absolutePath.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Chemin hors dépôt refusé : ${relativePath}`);
  }
  return fs.readFileSync(absolutePath, 'utf8');
}

let catalogue;
try {
  catalogue = JSON.parse(fs.readFileSync(cataloguePath, 'utf8'));
} catch (error) {
  console.error('[SPEC] Catalogue illisible :', error.message);
  process.exit(1);
}

if (catalogue.schemaVersion !== 1) fail('schemaVersion doit valoir 1.');
if (!Array.isArray(catalogue.requirements) || catalogue.requirements.length === 0) {
  fail('Le catalogue ne contient aucune exigence.');
}

let specification = '';
try {
  specification = read(catalogue.specification);
} catch (error) {
  fail(`Spécification introuvable : ${error.message}`);
}

const requirementIds = new Set();
for (const requirement of catalogue.requirements || []) {
  const id = String(requirement.id || '');
  if (!/^SEENIT-[A-Z0-9]+-\d{3}$/.test(id)) fail(`Identifiant invalide : ${id || '(vide)'}.`);
  if (requirementIds.has(id)) fail(`Identifiant dupliqué : ${id}.`);
  requirementIds.add(id);

  if (!String(requirement.title || '').trim()) fail(`${id} n'a pas de titre.`);
  if (!Array.isArray(requirement.targets) || requirement.targets.length === 0) {
    fail(`${id} ne cible aucune plateforme.`);
  } else {
    for (const target of requirement.targets) {
      if (!allowedTargets.has(target)) fail(`${id} utilise une cible inconnue : ${target}.`);
    }
  }

  if (!Array.isArray(requirement.tests) || requirement.tests.length === 0) {
    fail(`${id} n'est reliée à aucun test automatisé.`);
    continue;
  }

  for (const reference of requirement.tests) {
    try {
      const testSource = read(reference.file);
      if (!String(reference.file || '').startsWith('tests/') || !String(reference.file).endsWith('.test.ts')) {
        fail(`${id} référence un fichier qui n'est pas un test : ${reference.file}.`);
      }
      if (!String(reference.contains || '').trim() || !testSource.includes(reference.contains)) {
        fail(`${id} ne retrouve pas le test « ${reference.contains} » dans ${reference.file}.`);
      }
    } catch (error) {
      fail(`${id} référence un test introuvable : ${reference.file} (${error.message}).`);
    }
  }
}

const documentedIds = new Set(
  Array.from(specification.matchAll(/\*\*(SEENIT-[A-Z0-9]+-\d{3})\*\*/g), match => match[1])
);
for (const id of requirementIds) {
  if (!documentedIds.has(id)) fail(`${id} existe dans le catalogue mais pas dans la SPEC.`);
}
for (const id of documentedIds) {
  if (!requirementIds.has(id)) fail(`${id} existe dans la SPEC mais pas dans le catalogue.`);
}

const specificationVersion = specification.match(/Version applicative\s*:\s*\*\*(\d+\.\d+\.\d+)\*\*/)?.[1];
const gradleVersion = read('android/app/build.gradle').match(/versionName\s+["']([^"']+)["']/)?.[1];
const storeVersion = read('src/store/updateStore.ts').match(/CURRENT_APP_VERSION\s*=\s*["']([^"']+)["']/)?.[1];
const serverVersion = read('server.ts').match(/["']X-Plex-Version["']\s*:\s*["']([^"']+)["']/)?.[1];
const packageVersion = JSON.parse(read('package.json')).version;
const androidContractVersion = JSON.parse(read('docs/specifications/android-contract.json')).applicationVersion;
const versions = [
  ['catalogue', catalogue.applicationVersion],
  ['SPEC', specificationVersion],
  ['Android', gradleVersion],
  ['updateStore', storeVersion],
  ['serveur Plex', serverVersion],
  ['package npm', packageVersion],
  ['contrat APK', androidContractVersion]
];
const expectedVersion = versions[0][1];
for (const [label, version] of versions) {
  if (!version || version !== expectedVersion) {
    fail(`Version ${label} incohérente : ${version || '(absente)'} au lieu de ${expectedVersion}.`);
  }
}

if (process.exitCode) process.exit(process.exitCode);
console.log(`[SPEC] ${requirementIds.size} exigences tracées et version ${expectedVersion} cohérente.`);
