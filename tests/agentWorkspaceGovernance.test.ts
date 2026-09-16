import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const devcontainer = JSON.parse(readFileSync('.devcontainer/devcontainer.json', 'utf8')) as {
  build?: { dockerfile?: string; context?: string };
  mounts?: string[];
  postCreateCommand?: string;
};
const dockerfile = readFileSync('.devcontainer/Dockerfile', 'utf8');
const bootstrap = readFileSync('scripts/bootstrap-agent-workspace.cjs', 'utf8');
const remoteWorkflow = readFileSync('.github/workflows/agent-remote-validate.yml', 'utf8');
const remoteProcess = readFileSync('docs/process/agent-remote-workspace.md', 'utf8');
const bootstrapRules = readFileSync('.agents/AGENTS.md', 'utf8');

test('SEENIT-QUALITY-004 fournit un devcontainer reproductible et réutilise les dépendances exactes', () => {
  assert.equal(devcontainer.build?.dockerfile, 'Dockerfile');
  assert.equal(devcontainer.build?.context, '..');
  assert.equal(devcontainer.postCreateCommand, 'node scripts/bootstrap-agent-workspace.cjs');
  assert.ok(devcontainer.mounts?.some(mount => mount.includes('/node_modules')));
  assert.ok(devcontainer.mounts?.some(mount => mount.includes('/home/node/.npm')));
  assert.match(dockerfile, /javascript-node:1-22-bookworm/);
  assert.match(dockerfile, /npm@10\.9\.3/);
  assert.match(dockerfile, /ACTIONLINT_VERSION=1\.7\.12/);
  assert.match(bootstrap, /package-lock\.json/);
  assert.match(bootstrap, /\.seenit-install-fingerprint/);
  assert.match(bootstrap, /--prefer-offline/);
  assert.match(bootstrap, /dependenciesAreReusable/);
});

test('SEENIT-QUALITY-004 le fallback sans egress reste une quarantaine exact-SHA', () => {
  assert.match(remoteWorkflow, /agent-staging\/\*\*/);
  assert.match(remoteWorkflow, /ref:\s*\$\{\{ github\.sha \}\}/);
  assert.match(remoteWorkflow, /git merge-base HEAD refs\/remotes\/origin\/main/);
  assert.match(remoteWorkflow, /SEENIT_VALIDATE_BASE_SHA/);
  assert.match(remoteWorkflow, /npm run validate:change -- --postinstall/);
  assert.match(remoteProcess, /jamais mergée directement/i);
  assert.match(remoteProcess, /même SHA/i);
  assert.match(remoteProcess, /merge-base/i);
  assert.match(remoteProcess, /sans egress/i);
  assert.match(remoteProcess, /CI.*debugger/is);
  assert.match(bootstrapRules, /docs\/process\/agent-remote-workspace\.md/);
  assert.match(bootstrapRules, /agent-staging\/\*\*/);
  assert.match(bootstrapRules, /SHA exact/);
});
