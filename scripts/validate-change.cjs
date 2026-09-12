const { spawnSync, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function writeMetric(name, seconds) {
  if (!process.env.GITHUB_ENV) return;
  fs.appendFileSync(process.env.GITHUB_ENV, `${name}=${seconds}\n`, 'utf8');
}

function run(command, args, options = {}) {
  const label = options.label || [command, ...args].join(' ');
  const started = Date.now();
  console.log(`\n[Validate Change] ${label}`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...(options.env || {}) }
  });
  const seconds = Math.ceil((Date.now() - started) / 1000);
  if (options.metric) writeMetric(options.metric, seconds);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const error = new Error(`${label} a échoué avec le code ${result.status}.`);
    error.exitCode = result.status || 1;
    throw error;
  }
}

function resolveNpmInvocation(platform = process.platform, commandInterpreter = process.env.ComSpec) {
  return platform === 'win32'
    ? { command: commandInterpreter || 'cmd.exe', prefix: ['/d', '/s', '/c', 'npm'] }
    : { command: 'npm', prefix: [] };
}

function runNpm(args, options = {}) {
  const invocation = resolveNpmInvocation();
  run(invocation.command, [...invocation.prefix, ...args], options);
}

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function resolveBaseSha() {
  const explicit = String(process.env.SEENIT_VALIDATE_BASE_SHA || process.env.SPEC_BASE_SHA || '').trim();
  if (/^[0-9a-f]{40}$/i.test(explicit) && !/^0{40}$/.test(explicit)) return explicit;

  for (const ref of ['origin/main', 'origin/master', 'main', 'master']) {
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
  fs.appendFileSync(outputPath, `DEPENDENCIES_CHANGED=${classification.dependenciesChanged ? 'true' : 'false'}\n`, 'utf8');
}

function validatePreflight() {
  runNpm(['run', 'validate:workflows'], {
    label: 'Politique et syntaxe workflows',
    metric: 'SEENIT_WORKFLOWS_SECONDS'
  });
  runNpm(['run', 'test:spec'], {
    label: 'Intégrité SPEC',
    metric: 'SEENIT_SPEC_SECONDS'
  });
}

function validatePostinstall() {
  const baseSha = resolveBaseSha();
  console.log(`[Validate Change] Baseline : ${baseSha}`);

  run('node', ['scripts/materialize-android-config.cjs'], {
    label: 'Matérialisation Android',
    metric: 'SEENIT_MATERIALIZE_SECONDS'
  });

  const outputPath = path.join(root, `.seenit-validation-${process.pid}.out`);
  try {
    fs.writeFileSync(outputPath, '', 'utf8');
    runNpm(['run', 'delivery:classify'], {
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

    runNpm(['run', 'test:spec:changes'], {
      label: 'Contrat de changement',
      env: { SPEC_BASE_SHA: baseSha, DELIVERY_MODE: classification.mode }
    });
    runNpm(['run', 'lint'], { label: 'TypeScript', metric: 'SEENIT_TYPESCRIPT_SECONDS' });
    runNpm(['run', 'test:unit'], { label: 'Tests unitaires', metric: 'SEENIT_UNIT_SECONDS' });

    if (classification.mode === 'apk') {
      runNpm(['run', 'test:android'], { label: 'Contrat Android', metric: 'SEENIT_ANDROID_SECONDS' });
    }
    if (classification.dependenciesChanged || process.env.SEENIT_FORCE_DEPENDENCY_AUDIT === 'true') {
      runNpm(['audit', '--omit=dev', '--audit-level=high'], { label: 'Audit dépendances production' });
    }
    runNpm(['run', 'build'], { label: 'Build Web + serveur', metric: 'SEENIT_BUILD_SECONDS' });

    console.log(`\n[Validate Change] ✅ Validation ${classification.mode} verte.`);
    return classification;
  } finally {
    fs.rmSync(outputPath, { force: true });
  }
}

function validateChange() {
  validatePreflight();
  return validatePostinstall();
}

function parsePhase(args) {
  const requested = args.filter(arg => arg.startsWith('--'));
  if (requested.length === 0) return 'all';
  if (requested.length === 1 && requested[0] === '--preflight') return 'preflight';
  if (requested.length === 1 && requested[0] === '--postinstall') return 'postinstall';
  throw new Error(`Option invalide : ${requested.join(' ')}. Utiliser --preflight, --postinstall ou aucune option.`);
}

function main() {
  try {
    const phase = parsePhase(process.argv.slice(2));
    if (phase === 'preflight') validatePreflight();
    else if (phase === 'postinstall') validatePostinstall();
    else validateChange();
  } catch (error) {
    console.error(`\n[Validate Change] ❌ ${error.message}`);
    process.exitCode = error.exitCode || 1;
  }
}

module.exports = {
  parsePhase,
  readClassification,
  resolveNpmInvocation,
  resolveBaseSha,
  validateChange,
  validatePostinstall,
  validatePreflight,
  writeGithubOutput
};

if (require.main === module) main();
