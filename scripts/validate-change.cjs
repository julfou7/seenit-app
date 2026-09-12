const { spawnSync, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function run(command, args, options = {}) {
  const label = options.label || [command, ...args].join(' ');
  console.log(`\n[Validate Change] ${label}`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...(options.env || {}) }
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const error = new Error(`${label} a échoué avec le code ${result.status}.`);
    error.exitCode = result.status || 1;
    throw error;
  }
}

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function resolveBaseSha() {
  const explicit = String(process.env.SEENIT_VALIDATE_BASE_SHA || process.env.SPEC_BASE_SHA || '').trim();
  if (/^[0-9a-f]{40}$/i.test(explicit) && !/^0{40}$/.test(explicit)) return explicit;

  const candidates = [
    'origin/main',
    'origin/master',
    'main',
    'master'
  ];
  for (const ref of candidates) {
    try {
      const sha = git(['merge-base', 'HEAD', ref]);
      if (/^[0-9a-f]{40}$/i.test(sha)) return sha;
    } catch {}
  }

  try {
    return git(['rev-parse', 'HEAD^']);
  } catch {
    return git(['rev-parse', 'HEAD']);
  }
}

function readClassification(outputPath) {
  const content = fs.readFileSync(outputPath, 'utf8');
  const values = Object.fromEntries(content
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => {
      const index = line.indexOf('=');
      return index === -1 ? [line, ''] : [line.slice(0, index), line.slice(index + 1)];
    }));
  return {
    mode: values.DELIVERY_MODE || 'apk',
    dependenciesChanged: values.DEPENDENCIES_CHANGED === 'true'
  };
}

function writeGithubOutput(classification, outputPath = process.env.GITHUB_OUTPUT) {
  if (!outputPath) return;
  fs.appendFileSync(outputPath, `DELIVERY_MODE=${classification.mode}\n`, 'utf8');
  fs.appendFileSync(
    outputPath,
    `DEPENDENCIES_CHANGED=${classification.dependenciesChanged ? 'true' : 'false'}\n`,
    'utf8'
  );
}

function validateChange() {
  const baseSha = resolveBaseSha();
  console.log(`[Validate Change] Baseline : ${baseSha}`);

  run('npm', ['run', 'validate:workflows'], { label: 'Politique workflows' });
  run('npm', ['run', 'test:spec'], { label: 'Intégrité SPEC' });
  run('node', ['scripts/materialize-android-config.cjs'], { label: 'Matérialisation Android' });

  const outputPath = path.join(root, `.seenit-validation-${process.pid}.out`);
  try {
    fs.writeFileSync(outputPath, '', 'utf8');
    run('npm', ['run', 'delivery:classify'], {
      label: 'Classification de livraison',
      env: {
        DELIVERY_BASE_SHA: baseSha,
        FORCED_DELIVERY_MODE: 'auto',
        GITHUB_SHA: git(['rev-parse', 'HEAD']),
        GITHUB_OUTPUT: outputPath
      }
    });
    const classification = readClassification(outputPath);
    writeGithubOutput(classification);
    console.log(`[Validate Change] Mode : ${classification.mode}`);

    run('npm', ['run', 'test:spec:changes'], {
      label: 'Contrat de changement',
      env: { SPEC_BASE_SHA: baseSha, DELIVERY_MODE: classification.mode }
    });
    run('npm', ['run', 'lint'], { label: 'TypeScript' });
    run('npm', ['run', 'test:unit'], { label: 'Tests unitaires' });

    if (classification.mode === 'apk') {
      run('npm', ['run', 'test:android'], { label: 'Contrat Android' });
    }
    if (classification.dependenciesChanged || process.env.SEENIT_FORCE_DEPENDENCY_AUDIT === 'true') {
      run('npm', ['audit', '--omit=dev', '--audit-level=high'], { label: 'Audit dépendances production' });
    }
    run('npm', ['run', 'build'], { label: 'Build Web + serveur' });

    console.log(`\n[Validate Change] ✅ Validation ${classification.mode} verte.`);
    return classification;
  } finally {
    fs.rmSync(outputPath, { force: true });
  }
}

function main() {
  try {
    validateChange();
  } catch (error) {
    console.error(`\n[Validate Change] ❌ ${error.message}`);
    process.exitCode = error.exitCode || 1;
  }
}

module.exports = {
  readClassification,
  resolveBaseSha,
  validateChange,
  writeGithubOutput
};

if (require.main === module) main();
