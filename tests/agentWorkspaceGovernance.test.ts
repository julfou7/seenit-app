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
const rootRules = readFileSync('AGENTS.md', 'utf8');
const autonomousResume = readFileSync('docs/process/chatgpt-autonomous-resume.md', 'utf8');

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

test('SEENIT-QUALITY-004 le contrat racine autorise uniquement le fallback no-egress gouverné', () => {
  assert.match(rootRules, /Fallback sans egress strictement borné/);
  assert.match(rootRules, /docs\/process\/agent-remote-workspace\.md/);
  assert.match(rootRules, /agent-staging\/\*\*/);
  assert.match(rootRules, /SHA exact/);
  assert.match(rootRules, /unique exception au garde local/i);
  assert.match(rootRules, /Sauf fallback sans egress strictement borné de la section 0\.3/);
  assert.match(rootRules, /SeenIt — reprise autonome/);
  assert.match(rootRules, /Ne jamais désactiver cette automatisation/i);
});

test('la reprise autonome ne sélectionne que des chantiers exécutables avec les outils du run', () => {
  assert.match(autonomousResume, /PRÉFLIGHT D.EXÉCUTABILITÉ/);
  assert.match(autonomousResume, /Petit et borné[^\n]+ne suffit pas/i);
  assert.match(autonomousResume, /avant d.acquérir un bail[^\n]+capacités du run/i);
  assert.match(autonomousResume, /HANDOFF_READY[^\n]+incapacité d.outillage inchangée[^\n]+pas une reprise actionnable/i);
  assert.match(autonomousResume, /candidat échoue ce préflight[^\n]+candidat suivant/i);
  assert.match(autonomousResume, /diff matérialisé, test ciblé exécuté, commit[^\n]+ou PR/i);
  assert.match(autonomousResume, /checkpoint `DONE`[^\n]+release déjà publiée[^\n]+terminal/i);
});
