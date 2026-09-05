const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const ENTRY_FILE = 'server.ts';
const ALWAYS_RUNTIME_FILES = new Set([
  ENTRY_FILE,
  'package.json',
  'package-lock.json',
  'project.toml',
  '.github/workflows/deploy-backend.yml',
  'scripts/backend-runtime-impact.cjs'
]);

function normalizePath(value) {
  return String(value || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

function toRepositoryPath(absolutePath) {
  return normalizePath(path.relative(root, absolutePath));
}

function resolveLocalImport(importer, specifier) {
  if (!specifier.startsWith('.')) return null;
  const importerAbsolute = path.resolve(root, importer);
  const unresolved = path.resolve(path.dirname(importerAbsolute), specifier);
  const candidates = path.extname(unresolved)
    ? [unresolved]
    : [
        `${unresolved}.ts`,
        `${unresolved}.tsx`,
        `${unresolved}.js`,
        `${unresolved}.cjs`,
        `${unresolved}.mjs`,
        `${unresolved}.json`,
        path.join(unresolved, 'index.ts'),
        path.join(unresolved, 'index.tsx'),
        path.join(unresolved, 'index.js')
      ];

  for (const candidate of candidates) {
    if (!candidate.startsWith(`${root}${path.sep}`) && candidate !== path.join(root, ENTRY_FILE)) continue;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return toRepositoryPath(candidate);
  }
  return null;
}

function collectLocalRuntimeDependencies(entryFile = ENTRY_FILE) {
  const queue = [normalizePath(entryFile)];
  const dependencies = new Set();

  while (queue.length) {
    const current = queue.shift();
    if (!current || dependencies.has(current)) continue;
    const absolute = path.resolve(root, current);
    if (!absolute.startsWith(`${root}${path.sep}`) && absolute !== path.join(root, ENTRY_FILE)) {
      throw new Error(`Dépendance runtime hors dépôt: ${current}`);
    }
    if (!fs.existsSync(absolute)) throw new Error(`Dépendance runtime introuvable: ${current}`);

    dependencies.add(current);
    const source = fs.readFileSync(absolute, 'utf8');
    const imports = ts.preProcessFile(source, true, true).importedFiles;
    for (const imported of imports) {
      const resolved = resolveLocalImport(current, imported.fileName);
      if (resolved && !dependencies.has(resolved)) queue.push(resolved);
    }
  }

  return dependencies;
}

function hasBackendRuntimeImpact(changedFiles, runtimeDependencies) {
  return changedFiles.some(rawFile => {
    const file = normalizePath(rawFile);
    return ALWAYS_RUNTIME_FILES.has(file)
      || file.startsWith('src/backend/')
      || file.startsWith('src/server/')
      || runtimeDependencies.has(file);
  });
}

function readChangedFiles(baseSha, headSha) {
  if (!/^[0-9a-f]{40}$/i.test(baseSha) || /^0{40}$/i.test(baseSha)) {
    throw new Error('SHA de base Git absent ou invalide');
  }
  if (!/^[0-9a-f]{40}$/i.test(headSha)) throw new Error('SHA de tête Git absent ou invalide');
  execFileSync('git', ['cat-file', '-e', `${baseSha}^{commit}`], { cwd: root, stdio: 'ignore' });
  const output = execFileSync(
    'git',
    ['diff', '--name-only', '-z', `${baseSha}..${headSha}`],
    { cwd: root, encoding: 'utf8' }
  );
  return output.split('\u0000').map(normalizePath).filter(Boolean);
}

function writeOutput(shouldDeploy, reason) {
  const normalized = shouldDeploy ? 'true' : 'false';
  console.log(`[BackendRuntime] SHOULD_DEPLOY=${normalized} — ${reason}`);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `SHOULD_DEPLOY=${normalized}\n`, 'utf8');
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `\n## Impact runtime backend\n\n- Déploiement Cloud Run : **${shouldDeploy ? 'oui' : 'non'}**\n- Motif : ${reason}\n`,
      'utf8'
    );
  }
}

function main() {
  if (String(process.env.FORCE_BACKEND_DEPLOY || '').toLowerCase() === 'true') {
    writeOutput(true, 'déploiement manuel explicitement demandé');
    return;
  }

  try {
    const changedFiles = readChangedFiles(
      String(process.env.BACKEND_BASE_SHA || '').trim(),
      String(process.env.BACKEND_HEAD_SHA || '').trim()
    );
    const runtimeDependencies = collectLocalRuntimeDependencies();
    const impacted = hasBackendRuntimeImpact(changedFiles, runtimeDependencies);
    const matched = changedFiles.filter(file => hasBackendRuntimeImpact([file], runtimeDependencies));
    writeOutput(
      impacted,
      impacted
        ? `dépendance(s) runtime modifiée(s): ${matched.join(', ')}`
        : `aucune des ${changedFiles.length} modification(s) n'entre dans le graphe local de server.ts`
    );
  } catch (error) {
    console.error(`[BackendRuntime] Analyse incertaine: ${error.message}`);
    writeOutput(true, 'doute conservateur : déploiement requis');
  }
}

module.exports = {
  ALWAYS_RUNTIME_FILES,
  ENTRY_FILE,
  collectLocalRuntimeDependencies,
  hasBackendRuntimeImpact,
  normalizePath,
  readChangedFiles,
  resolveLocalImport
};

if (require.main === module) main();
