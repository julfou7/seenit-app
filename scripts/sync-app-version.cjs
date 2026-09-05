const fs = require('node:fs');
const path = require('node:path');
const { replaceUniqueJsonScalar } = require('./prepare-release-files.cjs');

const root = path.resolve(__dirname, '..');
const gradlePath = path.join(root, 'android/app/build.gradle');
const updateStorePath = path.join(root, 'src/store/updateStore.ts');
const serverPath = path.join(root, 'server.ts');
const packagePath = path.join(root, 'package.json');
const packageLockPath = path.join(root, 'package-lock.json');
const requirementsPath = path.join(root, 'docs/specifications/requirements.json');
const androidContractPath = path.join(root, 'docs/specifications/android-contract.json');
const specificationPath = path.join(root, 'docs/specifications/seenit.md');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function writeIfChanged(file, previous, next) {
  if (previous === next) return false;
  fs.writeFileSync(file, next, 'utf8');
  return true;
}

function replaceRequired(source, regex, replacement, label) {
  if (!regex.test(source)) {
    throw new Error(`[Version Sync] Motif introuvable pour ${label}`);
  }
  regex.lastIndex = 0;
  return source.replace(regex, replacement);
}

const initialGradle = read(gradlePath);
const versionMatch = initialGradle.match(/versionName\s+["'](\d+)\.(\d+)\.(\d+)["']/);
if (!versionMatch) {
  throw new Error('[Version Sync] versionName Android introuvable.');
}

const [, majorRaw, minorRaw, patchRaw] = versionMatch;
const major = Number(majorRaw);
const minor = Number(minorRaw);
const patch = Number(patchRaw);
const version = `${major}.${minor}.${patch}`;
const versionCode = major * 100000 + minor * 1000 + patch;

let gradle = initialGradle;
gradle = replaceRequired(
  gradle,
  /versionCode\s+\d+/,
  `versionCode ${versionCode}`,
  'versionCode Android'
);

const initialUpdateStore = read(updateStorePath);
const updateStore = replaceRequired(
  initialUpdateStore,
  /export const CURRENT_APP_VERSION = ['"][^'"]+['"];/,
  `export const CURRENT_APP_VERSION = '${version}';`,
  'CURRENT_APP_VERSION'
);

const initialServer = read(serverPath);
const server = replaceRequired(
  initialServer,
  /(['"]X-Plex-Version['"]\s*:\s*['"])[^'"]+(['"])/g,
  `$1${version}$2`,
  'X-Plex-Version'
);

function alignJsonVersion(file, transform = value => value) {
  const initial = read(file);
  const parsed = JSON.parse(initial);
  transform(parsed);
  const next = `${JSON.stringify(parsed, null, 2)}\n`;
  return { initial, next };
}

const packageVersion = alignJsonVersion(packagePath, value => {
  value.name = 'seenit-app';
  value.version = version;
});
const packageLockVersion = alignJsonVersion(packageLockPath, value => {
  value.name = 'seenit-app';
  value.version = version;
  value.packages[''].name = 'seenit-app';
  value.packages[''].version = version;
});
const initialRequirements = read(requirementsPath);
const requirementsVersion = {
  initial: initialRequirements,
  next: replaceUniqueJsonScalar(initialRequirements, 'applicationVersion', version, 'applicationVersion du catalogue SPEC')
};
const initialAndroidContract = read(androidContractPath);
const androidContractVersion = {
  initial: initialAndroidContract,
  next: replaceUniqueJsonScalar(
    replaceUniqueJsonScalar(initialAndroidContract, 'applicationVersion', version, 'applicationVersion du contrat Android'),
    'versionCode',
    versionCode,
    'versionCode du contrat Android'
  )
};
const initialSpecification = read(specificationPath);
const specification = replaceRequired(
  initialSpecification,
  /Version applicative\s*:\s*\*\*\d+\.\d+\.\d+\*\*/,
  `Version applicative : **${version}**`,
  'version de la SPEC'
);

const changedFiles = [];
if (writeIfChanged(gradlePath, initialGradle, gradle)) changedFiles.push('android/app/build.gradle');
if (writeIfChanged(updateStorePath, initialUpdateStore, updateStore)) changedFiles.push('src/store/updateStore.ts');
if (writeIfChanged(serverPath, initialServer, server)) changedFiles.push('server.ts');
if (writeIfChanged(packagePath, packageVersion.initial, packageVersion.next)) changedFiles.push('package.json');
if (writeIfChanged(packageLockPath, packageLockVersion.initial, packageLockVersion.next)) changedFiles.push('package-lock.json');
if (writeIfChanged(requirementsPath, requirementsVersion.initial, requirementsVersion.next)) changedFiles.push('docs/specifications/requirements.json');
if (writeIfChanged(androidContractPath, androidContractVersion.initial, androidContractVersion.next)) changedFiles.push('docs/specifications/android-contract.json');
if (writeIfChanged(specificationPath, initialSpecification, specification)) changedFiles.push('docs/specifications/seenit.md');

if (changedFiles.length) {
  console.log(`[Version Sync] SeenIt ${version} : aligné ${changedFiles.join(', ')}`);
} else {
  console.log(`[Version Sync] SeenIt ${version} : versions déjà alignées.`);
}
