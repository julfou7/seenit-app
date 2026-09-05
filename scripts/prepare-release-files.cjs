const fs = require('node:fs');
const path = require('node:path');
const { parseSemver } = require('./release-status.cjs');

const DEFAULT_ROOT = path.resolve(__dirname, '..');
const RELEASE_VERSION_FILES = Object.freeze([
  'android/app/build.gradle',
  'src/store/updateStore.ts',
  'server.ts',
  'package.json',
  'package-lock.json',
  'docs/specifications/requirements.json',
  'docs/specifications/android-contract.json',
  'docs/specifications/seenit.md'
]);
const RELEASE_VERSION_FILE_SET = new Set(RELEASE_VERSION_FILES);

function versionCodeFor(version) {
  const parsed = parseSemver(version);
  if (!parsed) throw new Error(`Version SemVer invalide : ${version}.`);
  return parsed.major * 100000 + parsed.minor * 1000 + parsed.patch;
}

function replaceRequired(source, regex, replacement, label) {
  if (!regex.test(source)) throw new Error(`Motif introuvable pour ${label}.`);
  regex.lastIndex = 0;
  return source.replace(regex, replacement);
}

function updateGradleVersionName(source, version) {
  if (!parseSemver(version)) throw new Error(`Version SemVer invalide : ${version}.`);
  return replaceRequired(
    source,
    /versionName\s+["']\d+\.\d+\.\d+["']/,
    `versionName "${version}"`,
    'versionName Android'
  );
}

function assertReleaseOnlyFiles(files) {
  const normalized = [...new Set((files || []).map(file => String(file || '').trim()).filter(Boolean))];
  const unexpected = normalized.filter(file => !RELEASE_VERSION_FILE_SET.has(file));
  if (unexpected.length) throw new Error(`Fichier hors surfaces de version détecté : ${unexpected.join(', ')}.`);
  if (!normalized.includes('android/app/build.gradle')) throw new Error('La préparation doit modifier android/app/build.gradle.');
  return normalized;
}

function assertExactReleaseVersionFiles(files) {
  const normalized = assertReleaseOnlyFiles(files);
  const missing = RELEASE_VERSION_FILES.filter(file => !normalized.includes(file));
  if (missing.length) throw new Error(`Préparation incomplète : surfaces non alignées ${missing.join(', ')}.`);
  return normalized;
}

function readFileMap(rootDir) {
  return Object.fromEntries(RELEASE_VERSION_FILES.map(relative => [
    relative,
    fs.readFileSync(path.join(rootDir, relative), 'utf8')
  ]));
}

function stringifyJson(source, mutate) {
  const value = JSON.parse(source);
  mutate(value);
  return `${JSON.stringify(value, null, 2)}\n`;
}

function replaceUniqueJsonScalar(source, field, value, label = field) {
  JSON.parse(source);
  const escapedField = String(field).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const scalar = typeof value === 'number' ? String(value) : `"${String(value)}"`;
  const regex = new RegExp(`("${escapedField}"\\s*:\\s*)(?:"(?:\\\\.|[^"\\\\])*"|-?\\d+(?:\\.\\d+)?)`, 'g');
  const matches = [...source.matchAll(regex)];
  if (matches.length !== 1) {
    throw new Error(`Champ JSON unique attendu pour ${label}, trouvé ${matches.length}.`);
  }
  const next = source.replace(regex, `$1${scalar}`);
  JSON.parse(next);
  return next;
}

function buildReleaseFileContents(targetVersion, { rootDir = DEFAULT_ROOT } = {}) {
  if (!parseSemver(targetVersion)) throw new Error(`Version SemVer invalide : ${targetVersion}.`);
  const code = versionCodeFor(targetVersion);
  const before = readFileMap(rootDir);
  const next = { ...before };

  next['android/app/build.gradle'] = updateGradleVersionName(before['android/app/build.gradle'], targetVersion);
  next['android/app/build.gradle'] = replaceRequired(
    next['android/app/build.gradle'],
    /versionCode\s+\d+/,
    `versionCode ${code}`,
    'versionCode Android'
  );
  next['src/store/updateStore.ts'] = replaceRequired(
    before['src/store/updateStore.ts'],
    /export const CURRENT_APP_VERSION = ['"][^'"]+['"];/,
    `export const CURRENT_APP_VERSION = '${targetVersion}';`,
    'CURRENT_APP_VERSION'
  );
  next['server.ts'] = replaceRequired(
    before['server.ts'],
    /(['"]X-Plex-Version['"]\s*:\s*['"])[^'"]+(['"])/g,
    `$1${targetVersion}$2`,
    'X-Plex-Version'
  );
  next['package.json'] = stringifyJson(before['package.json'], value => {
    value.name = 'seenit-app';
    value.version = targetVersion;
  });
  next['package-lock.json'] = stringifyJson(before['package-lock.json'], value => {
    value.name = 'seenit-app';
    value.version = targetVersion;
    if (!value.packages || !value.packages['']) throw new Error('Entrée racine packages[""] absente du package-lock.');
    value.packages[''].name = 'seenit-app';
    value.packages[''].version = targetVersion;
  });
  next['docs/specifications/requirements.json'] = replaceUniqueJsonScalar(
    before['docs/specifications/requirements.json'],
    'applicationVersion',
    targetVersion,
    'applicationVersion du catalogue SPEC'
  );
  next['docs/specifications/android-contract.json'] = replaceUniqueJsonScalar(
    before['docs/specifications/android-contract.json'],
    'applicationVersion',
    targetVersion,
    'applicationVersion du contrat Android'
  );
  next['docs/specifications/android-contract.json'] = replaceUniqueJsonScalar(
    next['docs/specifications/android-contract.json'],
    'versionCode',
    code,
    'versionCode du contrat Android'
  );
  next['docs/specifications/seenit.md'] = replaceRequired(
    before['docs/specifications/seenit.md'],
    /Version applicative\s*:\s*\*\*\d+\.\d+\.\d+\*\*/,
    `Version applicative : **${targetVersion}**`,
    'version de la SPEC'
  );

  const changedFiles = RELEASE_VERSION_FILES.filter(file => before[file] !== next[file]);
  return { before, next, changedFiles, targetVersion, versionCode: code };
}

function validateAlignedReleaseFiles(targetVersion, { rootDir = DEFAULT_ROOT } = {}) {
  const code = versionCodeFor(targetVersion);
  const files = readFileMap(rootDir);
  const gradleVersion = files['android/app/build.gradle'].match(/versionName\s+["']([^"']+)["']/)?.[1];
  const gradleCode = Number(files['android/app/build.gradle'].match(/versionCode\s+(\d+)/)?.[1]);
  const storeVersion = files['src/store/updateStore.ts'].match(/CURRENT_APP_VERSION\s*=\s*["']([^"']+)["']/)?.[1];
  const serverVersions = [...files['server.ts'].matchAll(/["']X-Plex-Version["']\s*:\s*["']([^"']+)["']/g)].map(match => match[1]);
  const packageJson = JSON.parse(files['package.json']);
  const packageLock = JSON.parse(files['package-lock.json']);
  const requirements = JSON.parse(files['docs/specifications/requirements.json']);
  const androidContract = JSON.parse(files['docs/specifications/android-contract.json']);
  const specVersion = files['docs/specifications/seenit.md'].match(/Version applicative\s*:\s*\*\*(\d+\.\d+\.\d+)\*\*/)?.[1];
  const versions = [
    gradleVersion,
    storeVersion,
    ...serverVersions,
    packageJson.version,
    packageLock.version,
    packageLock.packages?.['']?.version,
    requirements.applicationVersion,
    androidContract.applicationVersion,
    specVersion
  ];
  if (!serverVersions.length) throw new Error('Aucun X-Plex-Version trouvé après préparation.');
  if (versions.some(version => version !== targetVersion)) {
    throw new Error(`Surfaces de version incohérentes après préparation de ${targetVersion}.`);
  }
  if (gradleCode !== code || Number(androidContract.versionCode) !== code) {
    throw new Error(`versionCode incohérent après préparation de ${targetVersion}.`);
  }
  return { version: targetVersion, versionCode: code, surfaces: RELEASE_VERSION_FILES.length };
}

function prepareReleaseFiles(targetVersion, { rootDir = DEFAULT_ROOT, requireAllEight = true } = {}) {
  const plan = buildReleaseFileContents(targetVersion, { rootDir });
  if (requireAllEight) assertExactReleaseVersionFiles(plan.changedFiles);
  else if (plan.changedFiles.length) assertReleaseOnlyFiles(plan.changedFiles);

  const written = [];
  try {
    for (const relative of RELEASE_VERSION_FILES) {
      if (plan.before[relative] === plan.next[relative]) continue;
      fs.writeFileSync(path.join(rootDir, relative), plan.next[relative], 'utf8');
      written.push(relative);
    }
    const validation = validateAlignedReleaseFiles(targetVersion, { rootDir });
    return { ...validation, changedFiles: plan.changedFiles };
  } catch (error) {
    for (const relative of written.reverse()) {
      fs.writeFileSync(path.join(rootDir, relative), plan.before[relative], 'utf8');
    }
    throw error;
  }
}

function main() {
  const targetVersion = process.argv.slice(2).find(arg => !arg.startsWith('-'));
  if (!targetVersion) {
    console.error('[Release Prepare Files] Usage : npm run release:prepare:files -- X.Y.Z');
    process.exitCode = 1;
    return;
  }
  try {
    const result = prepareReleaseFiles(targetVersion);
    console.log(`[Release Prepare Files] ${targetVersion} : ${result.changedFiles.length} surfaces alignées sans GitHub CLI.`);
    console.log(`RELEASE_PREPARE_FILES_JSON=${JSON.stringify(result)}`);
  } catch (error) {
    console.error(`[Release Prepare Files] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  RELEASE_VERSION_FILES,
  assertExactReleaseVersionFiles,
  assertReleaseOnlyFiles,
  buildReleaseFileContents,
  prepareReleaseFiles,
  replaceUniqueJsonScalar,
  updateGradleVersionName,
  validateAlignedReleaseFiles,
  versionCodeFor
};

if (require.main === module) main();
