// Clé du cache node_modules exact (SEENIT-QUALITY-008) : identique tant que les dépendances, le lockfile et
// les scripts de patch sont identiques. Seuls les champs de version de l'application sont retirés : une
// préparation de release (8 surfaces) ne change pas node_modules et ne doit plus forcer une installation.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const PATCH_SCRIPTS = ['scripts/patch-local-notifications.cjs', 'scripts/materialize-android-config.cjs'];

function withoutAppVersion(packageJson) {
  const { version: _version, ...rest } = packageJson;
  return rest;
}

function withoutLockAppVersion(lock) {
  const { version: _version, ...rest } = lock;
  if (rest.packages?.['']) {
    const { version: _rootVersion, ...rootPackage } = rest.packages[''];
    rest.packages = { ...rest.packages, '': rootPackage };
  }
  return rest;
}

function dependencyCacheKey(cwd = root) {
  const read = file => fs.readFileSync(path.join(cwd, file), 'utf8');
  const hash = crypto.createHash('sha256');
  hash.update('seenit-deps-v1\n');
  hash.update(JSON.stringify(withoutAppVersion(JSON.parse(read('package.json')))));
  hash.update('\n');
  hash.update(JSON.stringify(withoutLockAppVersion(JSON.parse(read('package-lock.json')))));
  for (const file of PATCH_SCRIPTS) {
    hash.update(`\n${file}\n`);
    hash.update(read(file));
  }
  return hash.digest('hex');
}

if (require.main === module) process.stdout.write(`${dependencyCacheKey()}\n`);

module.exports = { PATCH_SCRIPTS, dependencyCacheKey, withoutAppVersion, withoutLockAppVersion };
