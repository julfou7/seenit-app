import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  ALLOWED_WORKFLOWS,
  validateWorkflowPolicy
} = require('../scripts/validate-workflow-policy.cjs') as {
  ALLOWED_WORKFLOWS: Set<string>;
  validateWorkflowPolicy: (workflowDir?: string) => string[];
};

function createFixture(overrides: Record<string, string> = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'seenit-workflows-'));
  for (const file of ALLOWED_WORKFLOWS) {
    fs.writeFileSync(
      path.join(directory, file),
      overrides[file] ?? 'name: Test\npermissions:\n  contents: read\njobs: {}\n',
      'utf8'
    );
  }
  return directory;
}

test('SEENIT-QUALITY-008 accepte uniquement l’allowlist canonique', () => {
  const directory = createFixture();
  try {
    assert.equal(validateWorkflowPolicy(directory).length, ALLOWED_WORKFLOWS.size);
    fs.writeFileSync(path.join(directory, 'issue-999-hotfix.yml'), 'name: Hotfix\njobs: {}\n', 'utf8');
    assert.throws(
      () => validateWorkflowPolicy(directory),
      /workflow non autorisé/
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('SEENIT-QUALITY-008 interdit git commit et git push dans les workflows', () => {
  const directory = createFixture({
    'discover-media-relations.yml': 'name: Test\njobs:\n  bad:\n    steps:\n      - run: git commit -am "hotfix" && git push\n'
  });
  try {
    assert.throws(
      () => validateWorkflowPolicy(directory),
      /ne doit pas ajouter, committer ou pousser du code/
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('SEENIT-QUALITY-008 réserve contents: write aux contrôles de release', () => {
  const directory = createFixture({
    'deploy-backend.yml': 'name: Test\npermissions:\n  contents: write\njobs: {}\n'
  });
  try {
    assert.throws(
      () => validateWorkflowPolicy(directory),
      /contents: write interdite/
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('SEENIT-QUALITY-008 autorise contents: write sur le workflow de publication explicite', () => {
  const directory = createFixture({
    'build-apk.yml': 'name: Test\npermissions:\n  contents: write\njobs: {}\n',
    'release-control.yml': 'name: Test\npermissions:\n  contents: write\n  actions: write\njobs: {}\n'
  });
  try {
    assert.equal(validateWorkflowPolicy(directory).length, ALLOWED_WORKFLOWS.size);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
