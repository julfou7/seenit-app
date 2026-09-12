const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const DEFAULT_WORKFLOW_DIR = path.join(root, '.github', 'workflows');
const ACTIONLINT_VERSION = '1.7.12';
const WORKFLOW_WRITE_PERMISSIONS = Object.freeze({
  'audit-structured-logs.yml': new Set(['id-token', 'issues']),
  'build-apk.yml': new Set(['contents']),
  'deploy-backend.yml': new Set(['id-token']),
  'discover-media-relations.yml': new Set([]),
  'release-control.yml': new Set(['actions', 'contents', 'issues', 'pull-requests']),
  'release-update-push.yml': new Set(['issues']),
  'runtime-control.yml': new Set(['actions', 'issues'])
});
const ALLOWED_WORKFLOWS = new Set(Object.keys(WORKFLOW_WRITE_PERMISSIONS));
const CONTENTS_WRITE_WORKFLOWS = new Set(
  Object.entries(WORKFLOW_WRITE_PERMISSIONS).filter(([, permissions]) => permissions.has('contents')).map(([file]) => file)
);
const ACTIONS_WRITE_WORKFLOWS = new Set(
  Object.entries(WORKFLOW_WRITE_PERMISSIONS).filter(([, permissions]) => permissions.has('actions')).map(([file]) => file)
);

function listWorkflowFiles(workflowDir = DEFAULT_WORKFLOW_DIR) {
  return fs.readdirSync(workflowDir)
    .filter(file => /\.ya?ml$/i.test(file))
    .sort();
}

function findWritePermissions(content) {
  const permissions = [];
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z][A-Za-z0-9-]*):\s*write\s*(?:#.*)?$/);
    if (match) permissions.push(match[1]);
  }
  return [...new Set(permissions)].sort();
}

function validateWorkflowPolicy(workflowDir = DEFAULT_WORKFLOW_DIR) {
  const files = listWorkflowFiles(workflowDir);
  const errors = [];

  for (const file of files) {
    const allowedWrites = WORKFLOW_WRITE_PERMISSIONS[file];
    if (!allowedWrites) {
      errors.push(`${file} : workflow non autorisé par l’allowlist canonique.`);
      continue;
    }

    const content = fs.readFileSync(path.join(workflowDir, file), 'utf8');
    if (/\bgit\s+(?:add|commit|push|merge|rebase|cherry-pick|am)\b/i.test(content)) {
      errors.push(`${file} : une CI ne doit pas modifier, committer ou pousser du code directement.`);
    }
    if (/stefanzweifel\/git-auto-commit-action@|peter-evans\/create-pull-request@/i.test(content)) {
      errors.push(`${file} : action de mutation Git automatique interdite.`);
    }
    for (const permission of findWritePermissions(content)) {
      if (!allowedWrites.has(permission)) {
        errors.push(`${file} : permission ${permission}: write non autorisée par le contrat canonique.`);
      }
    }
  }

  for (const expected of ALLOWED_WORKFLOWS) {
    if (!files.includes(expected)) {
      errors.push(`${expected} : workflow canonique absent.`);
    }
  }

  if (errors.length) {
    const error = new Error(`Politique workflows invalide :\n- ${errors.join('\n- ')}`);
    error.validationErrors = errors;
    throw error;
  }
  return files;
}

function resolveActionlint(command = process.env.SEENIT_ACTIONLINT || 'actionlint') {
  let output;
  try {
    output = execFileSync(command, ['-version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    throw new Error(`actionlint v${ACTIONLINT_VERSION} est requis avant push. Installer cette version exacte puis relancer npm run validate:change. (${error.message})`);
  }
  const match = output.match(/\b(\d+\.\d+\.\d+)\b/);
  if (!match || match[1] !== ACTIONLINT_VERSION) {
    throw new Error(`Version actionlint invalide : ${output || 'inconnue'} ; v${ACTIONLINT_VERSION} attendue.`);
  }
  return command;
}

function validateWorkflowSyntax(workflowDir = DEFAULT_WORKFLOW_DIR) {
  const command = resolveActionlint();
  const files = listWorkflowFiles(workflowDir).map(file => path.join(workflowDir, file));
  execFileSync(command, ['-shellcheck=', '-pyflakes=', ...files], { cwd: root, stdio: 'inherit' });
  return files;
}

function main() {
  try {
    const files = validateWorkflowPolicy();
    validateWorkflowSyntax();
    console.log(`[Workflow Policy] ✅ ${files.length} workflows canoniques validés avec actionlint v${ACTIONLINT_VERSION}.`);
  } catch (error) {
    console.error(`[Workflow Policy] ❌ ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  ACTIONLINT_VERSION,
  ACTIONS_WRITE_WORKFLOWS,
  ALLOWED_WORKFLOWS,
  CONTENTS_WRITE_WORKFLOWS,
  WORKFLOW_WRITE_PERMISSIONS,
  findWritePermissions,
  listWorkflowFiles,
  resolveActionlint,
  validateWorkflowPolicy,
  validateWorkflowSyntax
};

if (require.main === module) main();
