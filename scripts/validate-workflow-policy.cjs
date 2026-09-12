const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const DEFAULT_WORKFLOW_DIR = path.join(root, '.github', 'workflows');
const ALLOWED_WORKFLOWS = new Set([
  'audit-structured-logs.yml',
  'build-apk.yml',
  'deploy-backend.yml',
  'discover-media-relations.yml',
  'release-control.yml',
  'release-update-push.yml',
  'runtime-control.yml'
]);
const CONTENTS_WRITE_WORKFLOWS = new Set([
  'build-apk.yml',
  'release-control.yml'
]);
const ACTIONS_WRITE_WORKFLOWS = new Set([
  'release-control.yml',
  'runtime-control.yml'
]);

function listWorkflowFiles(workflowDir = DEFAULT_WORKFLOW_DIR) {
  return fs.readdirSync(workflowDir)
    .filter(file => /\.ya?ml$/i.test(file))
    .sort();
}

function validateWorkflowPolicy(workflowDir = DEFAULT_WORKFLOW_DIR) {
  const files = listWorkflowFiles(workflowDir);
  const errors = [];

  for (const file of files) {
    if (!ALLOWED_WORKFLOWS.has(file)) {
      errors.push(`${file} : workflow non autorisé par l’allowlist canonique.`);
      continue;
    }

    const content = fs.readFileSync(path.join(workflowDir, file), 'utf8');
    if (/\bgit\s+(?:add|commit|push)\b/i.test(content)) {
      errors.push(`${file} : une CI ne doit pas ajouter, committer ou pousser du code.`);
    }
    if (/contents\s*:\s*write\b/i.test(content) && !CONTENTS_WRITE_WORKFLOWS.has(file)) {
      errors.push(`${file} : permission contents: write interdite hors contrôle/release autorisé.`);
    }
    if (/actions\s*:\s*write\b/i.test(content) && !ACTIONS_WRITE_WORKFLOWS.has(file)) {
      errors.push(`${file} : permission actions: write interdite hors contrôle autorisé.`);
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

function main() {
  try {
    const files = validateWorkflowPolicy();
    console.log(`[Workflow Policy] ✅ ${files.length} workflows canoniques validés.`);
  } catch (error) {
    console.error(`[Workflow Policy] ❌ ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  ACTIONS_WRITE_WORKFLOWS,
  ALLOWED_WORKFLOWS,
  CONTENTS_WRITE_WORKFLOWS,
  listWorkflowFiles,
  validateWorkflowPolicy
};

if (require.main === module) main();
