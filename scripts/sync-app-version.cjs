const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const gradlePath = path.join(root, 'android/app/build.gradle');
const updateStorePath = path.join(root, 'src/store/updateStore.ts');
const serverPath = path.join(root, 'server.ts');

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

const changedFiles = [];
if (writeIfChanged(gradlePath, initialGradle, gradle)) changedFiles.push('android/app/build.gradle');
if (writeIfChanged(updateStorePath, initialUpdateStore, updateStore)) changedFiles.push('src/store/updateStore.ts');
if (writeIfChanged(serverPath, initialServer, server)) changedFiles.push('server.ts');

if (changedFiles.length) {
  console.log(`[Version Sync] SeenIt ${version} : aligné ${changedFiles.join(', ')}`);
} else {
  console.log(`[Version Sync] SeenIt ${version} : versions déjà alignées.`);
}
