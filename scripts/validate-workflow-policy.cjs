const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const DEFAULT_WORKFLOW_DIR = path.join(root, '.github', 'workflows');
const ACTIONLINT_VERSION = '1.7.12';
const WORKFLOW_WRITE_PERMISSIONS = Object.freeze({
  'agent-remote-validate.yml': new Set([]),
  'audit-structured-logs.yml': new Set(['id-token', 'issues']),
  'build-apk.yml': new Set(['contents']),
  'deploy-backend.yml': new Set(['id-token']),
  'discover-media-relations.yml': new Set([]),
  'firestore-default-migration.yml': new Set(['id-token', 'issues']),
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

function containsForbiddenGitMutation(content) {
  return /\bgit\s+(?:add|commit|push|rebase|cherry-pick|am)(?=\s|$)/im.test(content)
    || /\bgit\s+merge(?=\s|$)/im.test(content);
}

function validateAgentRemoteWorkflowContract(content) {
  const requirements = [
    [/branches:\s*\n\s*-\s*['"]?agent-staging\/\*\*['"]?/m, 'le trigger doit être borné à agent-staging/**'],
    [/startsWith\(github\.ref,\s*['"]refs\/heads\/agent-staging\/['"]\)/, 'le job doit refuser toute branche hors quarantaine'],
    [/ref:\s*\$\{\{\s*github\.sha\s*\}\}/, 'le checkout doit cibler github.sha explicitement'],
    [/git\s+merge-base\s+HEAD\s+refs\/remotes\/origin\/main/, 'la baseline doit être le merge-base du main courant'],
    [/SEENIT_VALIDATE_BASE_SHA/, 'la baseline calculée doit alimenter validate:change'],
    [/npm run validate:change -- --preflight/, 'le préflight canonique doit être exécuté'],
    [/npm run validate:change -- --postinstall/, 'la validation canonique postinstall doit être exécutée'],
    [/docker build --file \.devcontainer\/Dockerfile \./, 'le devcontainer canonique doit être réellement construit'],
    [/Validate exact staging SHA/, 'le check exact-SHA doit conserver un nom stable']
  ];
  const errors = requirements
    .filter(([pattern]) => !pattern.test(content))
    .map(([, message]) => `agent-remote-validate.yml : ${message}.`);

  if (/pull_request\s*:/m.test(content)) {
    errors.push('agent-remote-validate.yml : la quarantaine ne doit pas devenir un workflow de PR général.');
  }
  if (/branches:\s*\[[^\]]*(?:main|master)/m.test(content)) {
    errors.push('agent-remote-validate.yml : le workflow distant ne doit jamais cibler main/master.');
  }
  return errors;
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
    if (containsForbiddenGitMutation(content)) {
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
    if (file === 'agent-remote-validate.yml') {
      errors.push(...validateAgentRemoteWorkflowContract(content));
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
  containsForbiddenGitMutation,
  findWritePermissions,
  listWorkflowFiles,
  resolveActionlint,
  validateAgentRemoteWorkflowContract,
  validateWorkflowPolicy,
  validateWorkflowSyntax
};

if (require.main === module) main();
