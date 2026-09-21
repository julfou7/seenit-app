import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  ACTIONLINT_VERSION,
  ALLOWED_WORKFLOWS,
  containsForbiddenGitMutation,
  findWritePermissions,
  validateAgentRemoteWorkflowContract,
  validateWorkflowPolicy
} = require('../scripts/validate-workflow-policy.cjs') as {
  ACTIONLINT_VERSION: string;
  ALLOWED_WORKFLOWS: Set<string>;
  containsForbiddenGitMutation: (content: string) => boolean;
  findWritePermissions: (content: string) => string[];
  validateAgentRemoteWorkflowContract: (content: string) => string[];
  validateWorkflowPolicy: (workflowDir?: string) => string[];
};

const validRemoteWorkflow = `name: Agent Remote Validate
on:
  push:
    branches:
      - 'agent-staging/**'
permissions:
  contents: read
jobs:
  validate:
    name: Validate exact staging SHA
    if: startsWith(github.ref, 'refs/heads/agent-staging/')
    steps:
      - uses: actions/checkout@v6
        with:
          ref: \${{ github.sha }}
      - run: git merge-base HEAD refs/remotes/origin/main
      - run: echo SEENIT_VALIDATE_BASE_SHA=x
      - run: npm run validate:change -- --preflight
      - run: docker build --file .devcontainer/Dockerfile .
      - run: npm run validate:change -- --postinstall
`;

function createFixture(overrides: Record<string, string> = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'seenit-workflows-'));
  for (const file of ALLOWED_WORKFLOWS) {
    const defaultContent = file === 'agent-remote-validate.yml'
      ? validRemoteWorkflow
      : 'name: Test\npermissions:\n  contents: read\njobs: {}\n';
    fs.writeFileSync(
      path.join(directory, file),
      overrides[file] ?? defaultContent,
      'utf8'
    );
  }
  return directory;
}

test('SEENIT-QUALITY-008 verrouille actionlint et accepte uniquement l’allowlist canonique', () => {
  assert.equal(ACTIONLINT_VERSION, '1.7.12');
  const directory = createFixture();
  try {
    assert.equal(validateWorkflowPolicy(directory).length, ALLOWED_WORKFLOWS.size);
    fs.writeFileSync(path.join(directory, 'issue-999-hotfix.yml'), 'name: Hotfix\njobs: {}\n', 'utf8');
    assert.throws(() => validateWorkflowPolicy(directory), /workflow non autorisé/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('SEENIT-QUALITY-008 interdit les mutations Git directes dans les workflows sans bloquer merge-base', () => {
  assert.equal(containsForbiddenGitMutation('git merge-base HEAD origin/main'), false);
  assert.equal(containsForbiddenGitMutation('git merge main'), true);
  assert.equal(containsForbiddenGitMutation('git push origin main'), true);

  const directory = createFixture({
    'discover-media-relations.yml': 'name: Test\njobs:\n  bad:\n    steps:\n      - run: git commit -am "hotfix" && git push\n'
  });
  try {
    assert.throws(() => validateWorkflowPolicy(directory), /ne doit pas modifier, committer ou pousser du code/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('SEENIT-QUALITY-008 borne toutes les permissions write par workflow', () => {
  assert.deepEqual(findWritePermissions('permissions:\n  contents: write\n  issues: write\n'), ['contents', 'issues']);
  const directory = createFixture({
    'deploy-backend.yml': 'name: Test\npermissions:\n  contents: write\n  id-token: write\njobs: {}\n'
  });
  try {
    assert.throws(() => validateWorkflowPolicy(directory), /permission contents: write non autorisée/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('SEENIT-QUALITY-008 autorise uniquement les écritures canoniques nécessaires', () => {
  const directory = createFixture({
    'audit-structured-logs.yml': 'name: Test\npermissions:\n  contents: read\n  id-token: write\n  issues: write\njobs: {}\n',
    'build-apk.yml': 'name: Test\npermissions:\n  contents: write\njobs: {}\n',
    'deploy-backend.yml': 'name: Test\npermissions:\n  contents: read\n  id-token: write\njobs: {}\n',
    'firestore-default-migration.yml': 'name: Test\npermissions:\n  contents: read\n  id-token: write\n  issues: write\njobs: {}\n',
    'release-control.yml': 'name: Test\npermissions:\n  contents: write\n  actions: write\n  issues: write\n  pull-requests: write\njobs: {}\n',
    'release-update-push.yml': 'name: Test\npermissions:\n  contents: read\n  issues: write\njobs: {}\n',
    'runtime-control.yml': 'name: Test\npermissions:\n  contents: read\n  actions: write\n  issues: write\njobs: {}\n'
  });
  try {
    assert.equal(validateWorkflowPolicy(directory).length, ALLOWED_WORKFLOWS.size);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('SEENIT-QUALITY-004 verrouille la quarantaine distante sur le SHA exact et le merge-base de main', () => {
  assert.deepEqual(validateAgentRemoteWorkflowContract(validRemoteWorkflow), []);
  assert.match(validRemoteWorkflow, /agent-staging\/\*\*/);
  assert.match(validRemoteWorkflow, /github\.sha/);
  assert.match(validRemoteWorkflow, /merge-base HEAD refs\/remotes\/origin\/main/);

  const unsafe = validRemoteWorkflow
    .replace("      - 'agent-staging/**'", '      - main')
    .replace('git merge-base HEAD refs/remotes/origin/main', 'git rev-parse HEAD^');
  const errors = validateAgentRemoteWorkflowContract(unsafe).join('\n');
  assert.match(errors, /agent-staging/);
  assert.match(errors, /merge-base/);
});
