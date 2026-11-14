import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const packageLock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const serverSource = readFileSync('server.ts', 'utf8');
const require = createRequire(import.meta.url);

test('issue #225 retire complètement Multer du runtime backend', () => {
  assert.equal(packageJson.dependencies?.multer, undefined);
  assert.equal(packageJson.devDependencies?.['@types/multer'], undefined);
  assert.equal(packageLock.packages?.['node_modules/multer'], undefined);
  assert.equal(packageLock.packages?.['node_modules/@types/multer'], undefined);
  assert.doesNotMatch(serverSource, /\bmulter\b/i);
});

test('issue #225 force qs sur la première version corrigée', () => {
  assert.equal(packageJson.overrides?.qs, '6.16.0');
  assert.equal(packageLock.packages?.['node_modules/qs']?.version, '6.16.0');
});

test('SEENIT-RELEASE-002 verrouille le parseur HTTP corrigé contre les corps compressés', () => {
  const version = packageLock.packages['node_modules/body-parser'].version;
  const [major, minor, patch] = version.split('.').map(Number);
  assert.ok(major === 1 && (minor > 20 || (minor === 20 && patch >= 9)), version);
  assert.equal(require('body-parser/package.json').version, version);
});

test('#649 les overrides de sécurité ne cassent aucune plage déclarée de brace-expansion', () => {
  const semver = require('semver') as { satisfies: (version: string, range: string) => boolean };
  const packages = packageLock.packages as Record<string, { version?: string; dependencies?: Record<string, string> }>;
  // Résolution Node : dossier node_modules le plus proche du parent, puis remontée jusqu'à la racine.
  const resolve = (parent: string, name: string) => {
    let base = parent;
    for (;;) {
      const candidate = `${base ? `${base}/` : ''}node_modules/${name}`;
      if (packages[candidate]) return { path: candidate, ...packages[candidate] };
      if (!base) return null;
      const index = base.lastIndexOf('/node_modules/');
      base = index === -1 ? '' : base.slice(0, index);
    }
  };
  const checked: string[] = [];
  for (const [path, entry] of Object.entries(packages)) {
    const range = entry.dependencies?.['brace-expansion'];
    if (!path || !range) continue;
    const resolved = resolve(path, 'brace-expansion');
    assert.ok(resolved?.version, `${path} : brace-expansion introuvable`);
    assert.ok(semver.satisfies(resolved.version, range), `${path} déclare ${range} mais reçoit ${resolved.version}`);
    checked.push(`${path}→${resolved.version}`);
  }
  assert.ok(checked.some(item => /minimatch→5\./.test(item)), `minimatch 10 garde brace-expansion 5 : ${checked.join(', ')}`);
  // npm 10 (moteur imposé) appliquait l'override global à plage même à minimatch 10 : les copies 2.x sont
  // relevées par sous-arbre, et minimatch 10 reçoit explicitement la 5.x qu'il déclare.
  assert.equal(packageJson.overrides['brace-expansion@>=2.0.0 <2.1.7'], undefined);
  assert.equal(packageJson.overrides['@capacitor/assets']['brace-expansion'], '2.1.7');
  assert.equal(packageJson.overrides['google-gax']['brace-expansion'], '2.1.7');
  assert.equal(packageJson.overrides['minimatch@>=10']['brace-expansion'], '5.0.13');
  assert.ok(checked.every(item => !/→2\.(0\.|1\.[0-6]$)/.test(item)), `aucune copie 2.x vulnérable : ${checked.join(', ')}`);
});
