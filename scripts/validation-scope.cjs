const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const SHA = /^[0-9a-f]{40}$/;
const TREE_ARTIFACT_PREFIX = 'SeenIt-Validated-Tree-';

function git(args, cwd = root) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function normalizePath(file) {
  return String(file || '').trim().replace(/\\/g, '/');
}

function isStrictProcessDocumentation(file) {
  const normalized = normalizePath(file);
  return (normalized.startsWith('docs/process/') && normalized.endsWith('.md'))
    || (normalized.startsWith('docs/requests/') && normalized.endsWith('.md'));
}

function parseNameStatus(output) {
  const fields = String(output || '').split('\u0000').filter(Boolean);
  const changes = [];
  for (let index = 0; index < fields.length;) {
    const rawStatus = fields[index++];
    const status = rawStatus[0];
    if (status === 'R' || status === 'C') {
      changes.push({
        status,
        previousPath: normalizePath(fields[index++]),
        path: normalizePath(fields[index++])
      });
    } else {
      changes.push({ status, path: normalizePath(fields[index++]) });
    }
  }
  return changes;
}

function readChanges(baseSha, head = 'HEAD', cwd = root) {
  const output = execFileSync(
    'git',
    ['diff', '--name-status', '-z', `${baseSha}..${head}`],
    { cwd, encoding: 'utf8' }
  );
  return parseNameStatus(output);
}

function resolveBaseSha(explicit = process.env.SEENIT_VALIDATE_BASE_SHA, cwd = root) {
  const normalized = String(explicit || '').trim();
  if (SHA.test(normalized) && !/^0{40}$/.test(normalized)) return normalized;
  try {
    const parent = git(['rev-parse', 'HEAD^'], cwd);
    if (SHA.test(parent)) return parent;
  } catch {}
  return '';
}

function resolveValidationScope({ event, changes }) {
  const eventAllowed = event === 'pull_request' || event === 'push';
  const docsOnly = eventAllowed
    && changes.length > 0
    && changes.every(change => (
      isStrictProcessDocumentation(change.path)
      && (!change.previousPath || isStrictProcessDocumentation(change.previousPath))
    ));
  return {
    docsOnly,
    scope: docsOnly ? 'docs-only' : 'full',
    changedFiles: changes.map(change => change.path)
  };
}

function currentTree(cwd = root) {
  const tree = git(['rev-parse', 'HEAD^{tree}'], cwd);
  if (!SHA.test(tree)) throw new Error(`Arbre Git invalide : ${tree}`);
  return tree;
}

function treeArtifactName(tree) {
  if (!SHA.test(String(tree || ''))) throw new Error(`Arbre Git invalide : ${tree}`);
  return `${TREE_ARTIFACT_PREFIX}${tree}`;
}

function writeOutputs(result, tree, outputPath = process.env.GITHUB_OUTPUT) {
  if (!outputPath) return;
  fs.appendFileSync(outputPath, [
    `docs_only=${result.docsOnly ? 'true' : 'false'}`,
    `scope=${result.scope}`,
    `tree=${tree}`,
    `artifact_name=${treeArtifactName(tree)}`
  ].join('\n') + '\n', 'utf8');
}

function main() {
  try {
    const baseSha = resolveBaseSha();
    if (!baseSha) throw new Error('baseline Git indisponible');
    const headSha = String(process.env.GITHUB_SHA || 'HEAD').trim();
    const changes = readChanges(baseSha, headSha || 'HEAD');
    const result = resolveValidationScope({ event: process.env.GITHUB_EVENT_NAME, changes });
    const tree = currentTree();
    writeOutputs(result, tree);
    console.log(`[Validation scope] ${result.scope} — ${result.changedFiles.length} fichier(s).`);
    for (const file of result.changedFiles) console.log(`[Validation scope] ${file}`);
  } catch (error) {
    console.error(`[Validation scope] ⚠️ ${error.message} : validation complète.`);
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, 'docs_only=false\nscope=full\n');
    }
  }
}

module.exports = {
  currentTree,
  isStrictProcessDocumentation,
  normalizePath,
  parseNameStatus,
  readChanges,
  resolveBaseSha,
  resolveValidationScope,
  treeArtifactName,
  writeOutputs
};

if (require.main === module) main();
