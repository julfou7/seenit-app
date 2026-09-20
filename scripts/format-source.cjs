const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const FORMATTED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.cjs', '.mjs', '.json']);

function resolveBaseSha(root = ROOT) {
  const explicit = String(process.env.SEENIT_LINT_BASE_SHA || '').trim();
  if (/^[0-9a-f]{40}$/i.test(explicit) && !/^0{40}$/.test(explicit)) return explicit;
  for (const ref of ['origin/main', 'origin/master', 'main', 'master']) {
    try {
      const sha = execFileSync('git', ['merge-base', 'HEAD', ref], { cwd: root, encoding: 'utf8' }).trim();
      if (/^[0-9a-f]{40}$/i.test(sha)) return sha;
    } catch {}
  }
  return execFileSync('git', ['rev-parse', 'HEAD^'], { cwd: root, encoding: 'utf8' }).trim();
}

function normalizeText(content) {
  const normalized = content
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n*$/g, '');
  return normalized + '\n';
}

function changedFormatFiles(baseSha, root = ROOT) {
  const output = execFileSync('git', ['diff', '--name-only', baseSha, '--'], {
    cwd: root,
    encoding: 'utf8'
  });
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .filter(file => FORMATTED_EXTENSIONS.has(path.extname(file)))
    .filter(file => fs.existsSync(path.join(root, file)));
}

function checkChangedFormatting(baseSha, root = ROOT) {
  const result = spawnSync('git', ['diff', '--check', baseSha, '--'], {
    cwd: root,
    encoding: 'utf8'
  });
  const problems = [];
  if (result.status !== 0) problems.push(String(result.stdout || result.stderr || '').trim());

  for (const file of changedFormatFiles(baseSha, root)) {
    const content = fs.readFileSync(path.join(root, file), 'utf8');
    if (!content.endsWith('\n')) problems.push(`${file}: fin de ligne finale manquante`);
  }
  return problems.filter(Boolean);
}

function writeChangedFormatting(baseSha, root = ROOT) {
  const changed = [];
  for (const file of changedFormatFiles(baseSha, root)) {
    const absolutePath = path.join(root, file);
    const current = fs.readFileSync(absolutePath, 'utf8');
    const normalized = normalizeText(current);
    if (current === normalized) continue;
    fs.writeFileSync(absolutePath, normalized, 'utf8');
    changed.push(file);
  }
  return changed;
}

function main() {
  const args = new Set(process.argv.slice(2));
  const baseSha = resolveBaseSha();
  if (args.has('--write')) {
    const changed = writeChangedFormatting(baseSha);
    console.log(`[Format] ${changed.length} fichier(s) normalisé(s).`);
    return;
  }
  const problems = checkChangedFormatting(baseSha);
  if (problems.length > 0) {
    problems.forEach(problem => console.error(`[Format] ❌ ${problem}`));
    process.exitCode = 1;
    return;
  }
  console.log('[Format] ✅ diff sans écart de formatage minimal.');
}

module.exports = {
  changedFormatFiles,
  checkChangedFormatting,
  normalizeText,
  resolveBaseSha,
  writeChangedFormatting
};

if (require.main === module) main();
