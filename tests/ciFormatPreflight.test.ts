import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { checkChangedFormatting } = require('../scripts/format-source.cjs');

test('#85 le préflight vérifie le format minimal avant les contrôles coûteux', () => {
  const validation = readFileSync('scripts/validate-change.cjs', 'utf8');
  const start = validation.indexOf('function validatePreflight()');
  const end = validation.indexOf('function validatePostinstall()');
  assert.ok(start >= 0 && end > start);
  const preflight = validation.slice(start, end);

  const format = preflight.indexOf("['run', 'format:check']");
  const workflows = preflight.indexOf("['run', 'validate:workflows']");
  const spec = preflight.indexOf("['run', 'test:spec']");
  assert.ok(format >= 0, 'format:check absent du préflight');
  assert.ok(format < workflows, 'le format doit échouer avant la politique workflows');
  assert.ok(format < spec, 'le format doit échouer avant l’intégrité SPEC');

  const stagingWorkflow = readFileSync('.github/workflows/agent-remote-validate.yml', 'utf8');
  assert.ok(
    stagingWorkflow.indexOf('Validate change preflight') < stagingWorkflow.indexOf('Build canonical devcontainer'),
    'Agent Remote Validate doit exécuter le préflight avant le devcontainer'
  );

  const canonicalWorkflow = readFileSync('.github/workflows/build-apk.yml', 'utf8');
  assert.ok(
    canonicalWorkflow.indexOf('Validate Change Preflight') < canonicalWorkflow.indexOf('Restore Exact node_modules Cache'),
    'Validate Change doit exécuter le préflight avant le cache node_modules'
  );

  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.match(pkg.scripts.lint, /format:check/, 'le lint complet conserve la défense en profondeur');
});

test('#85 le cas terrain sans saut de ligne final est refusé par le contrôle minimal', () => {
  const root = mkdtempSync(join(tmpdir(), 'seenit-format-preflight-'));
  try {
    mkdirSync(join(root, 'src'));
    execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'seenit-test@example.invalid'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'SeenIt Test'], { cwd: root });
    writeFileSync(join(root, 'src', 'FilterModal.tsx'), 'export const value = 1;\n', 'utf8');
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root, stdio: 'ignore' });
    const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

    writeFileSync(join(root, 'src', 'FilterModal.tsx'), 'export const value = 2;', 'utf8');
    const problems = checkChangedFormatting(baseSha, root);
    assert.ok(
      problems.includes('src/FilterModal.tsx: fin de ligne finale manquante'),
      `problème attendu absent: ${problems.join(' | ')}`
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('#85 EditorConfig demande une fin de ligne finale aux éditeurs compatibles', () => {
  const editorConfig = readFileSync('.editorconfig', 'utf8');
  assert.match(editorConfig, /^root = true/m);
  assert.match(editorConfig, /^end_of_line = lf/m);
  assert.match(editorConfig, /^insert_final_newline = true/m);
});
