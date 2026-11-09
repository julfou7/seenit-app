#!/usr/bin/env node
/**
 * Préflight rapide (docs/process/delivery.md, `USR-2026-11-09-013/014`) : lance les TNR qui citent un fichier
 * modifié, y compris les anciens TNR qui lisent le code source. Le 09/11, un ancien TNR de Programmés n'avait
 * été découvert que par la validation complète : un cycle perdu.
 *
 * Usage : `node scripts/test-touched.cjs [base]` (par défaut `origin/main`). Le code de sortie est celui de
 * `node --test` ; aucun TNR concerné → 0.
 */
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

/** Fichiers modifiés depuis la base commune, plus l'arbre de travail et les nouveaux fichiers. */
function changedFiles(base = 'origin/main') {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  const mergeBase = git(['merge-base', base, 'HEAD'])[0];
  return [...new Set([
    ...git(['diff', '--name-only', `${mergeBase}...HEAD`]),
    ...git(['diff', '--name-only', 'HEAD']),
    ...git(['ls-files', '--others', '--exclude-standard'])
  ])];
}

/**
 * TNR concernés : ceux modifiés eux-mêmes, et ceux dont le texte cite le nom (sans extension) d'un fichier modifié
 * de `src/`, `scripts/` ou `server.ts`. Un nom trop court ou trop générique (`index`, `types`, `utils`) est ignoré
 * pour ne pas relancer toute la suite.
 */
function selectTouchedTests(changed, tests, read) {
  const generic = new Set(['index', 'types', 'utils', 'App', 'main', 'server']);
  const names = [...new Set(changed
    .filter(file => /^(?:src\/|scripts\/|server\.ts$)/.test(file))
    .map(file => path.basename(file).replace(/\.[^.]+$/, ''))
    .filter(name => name.length >= 5 && !generic.has(name)))];
  const touched = new Set(changed.filter(file => /^tests\/[^/]+\.test\.tsx?$/.test(file)));
  for (const test of tests) {
    const text = read(test);
    if (names.some(name => text.includes(name))) touched.add(test);
  }
  return [...touched].filter(test => tests.includes(test)).sort();
}

function main() {
  const base = process.argv[2] || 'origin/main';
  const tests = fs.readdirSync(path.join(root, 'tests')).filter(file => /\.test\.tsx?$/.test(file)).map(file => `tests/${file}`);
  const selected = selectTouchedTests(changedFiles(base), tests, test => fs.readFileSync(path.join(root, test), 'utf8'));
  if (!selected.length) {
    console.log('[Test Touched] Aucun TNR ne cite les fichiers modifiés.');
    return 0;
  }
  console.log(`[Test Touched] ${selected.length} TNR : ${selected.join(' ')}`);
  return spawnSync(process.execPath, ['--test', ...selected], { cwd: root, stdio: 'inherit' }).status ?? 1;
}

if (require.main === module) process.exit(main());

module.exports = { selectTouchedTests };
