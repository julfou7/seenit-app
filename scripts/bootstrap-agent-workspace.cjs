const { execFileSync, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const fingerprintFiles = [
  'package.json',
  'package-lock.json',
  'scripts/patch-local-notifications.cjs',
  'scripts/materialize-android-config.cjs'
];
const markerRelativePath = path.join('node_modules', '.seenit-install-fingerprint');

function readExpectedNpmVersion(baseDir = root) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(baseDir, 'package.json'), 'utf8'));
  const match = String(packageJson.packageManager || '').match(/^npm@(\d+\.\d+\.\d+)$/);
  if (!match) throw new Error('package.json doit déclarer packageManager sous la forme npm@X.Y.Z.');
  return match[1];
}

function readNpmVersion() {
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return execFileSync(command, ['--version'], { encoding: 'utf8' }).trim();
}

function computeWorkspaceFingerprint(baseDir = root, runtime = {}) {
  const nodeVersion = runtime.nodeVersion || process.versions.node;
  const npmVersion = runtime.npmVersion || readNpmVersion();
  const hash = crypto.createHash('sha256');
  hash.update(`node=${nodeVersion}\n`);
  hash.update(`npm=${npmVersion}\n`);
  for (const relativePath of fingerprintFiles) {
    hash.update(`${relativePath}\0`);
    hash.update(fs.readFileSync(path.join(baseDir, relativePath)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function dependenciesAreReusable(baseDir = root, fingerprint) {
  const marker = path.join(baseDir, markerRelativePath);
  if (!fs.existsSync(marker)) return false;
  if (fs.readFileSync(marker, 'utf8').trim() !== fingerprint) return false;
  try {
    require.resolve('typescript', { paths: [baseDir] });
    require.resolve('vite', { paths: [baseDir] });
    return true;
  } catch {
    return false;
  }
}

function installDependencies(baseDir = root) {
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(command, [
    'ci',
    '--legacy-peer-deps',
    '--prefer-offline',
    '--no-audit',
    '--no-fund'
  ], {
    cwd: baseDir,
    stdio: 'inherit',
    env: process.env
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`npm ci a échoué avec le code ${result.status}.`);
}

function bootstrapWorkspace(baseDir = root) {
  const expectedNpmVersion = readExpectedNpmVersion(baseDir);
  const npmVersion = readNpmVersion();
  if (npmVersion !== expectedNpmVersion) {
    throw new Error(`npm ${expectedNpmVersion} requis par SeenIt ; version courante ${npmVersion}. Reconstruire le devcontainer au lieu de modifier globalement le runtime.`);
  }

  const fingerprint = computeWorkspaceFingerprint(baseDir, { npmVersion });
  if (dependenciesAreReusable(baseDir, fingerprint)) {
    console.log(`[Workspace] ✅ Dépendances exactes réutilisées (${fingerprint.slice(0, 12)}).`);
    return { fingerprint, reused: true };
  }

  console.log('[Workspace] Cache node_modules absent ou incompatible : installation canonique unique.');
  installDependencies(baseDir);
  const marker = path.join(baseDir, markerRelativePath);
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, `${fingerprint}\n`, 'utf8');
  console.log(`[Workspace] ✅ Dépendances prêtes (${fingerprint.slice(0, 12)}).`);
  return { fingerprint, reused: false };
}

function main() {
  try {
    bootstrapWorkspace();
  } catch (error) {
    console.error(`[Workspace] ❌ ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  bootstrapWorkspace,
  computeWorkspaceFingerprint,
  dependenciesAreReusable,
  fingerprintFiles,
  markerRelativePath,
  readExpectedNpmVersion
};

if (require.main === module) main();
