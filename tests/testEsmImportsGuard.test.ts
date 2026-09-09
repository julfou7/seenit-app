import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const guardScript = path.resolve('scripts/validate-test-esm-imports.cjs');

function makeFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'seenit-esm-guard-'));
  mkdirSync(path.join(root, 'tests'), { recursive: true });
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'src/foo.ts'), 'export const foo = 1;\n');
  writeFileSync(path.join(root, 'src/side.ts'), 'export const side = 1;\n');
  writeFileSync(path.join(root, 'src/lazy.tsx'), 'export const lazy = 1;\n');
  return root;
}

function runGuard(root: string) {
  return spawnSync(process.execPath, [guardScript, '--root', root], {
    encoding: 'utf8',
  });
}

test('SEENIT-QUALITY-008 bloque les imports ESM relatifs sans extension avant les tests', () => {
  const root = makeFixture();
  try {
    writeFileSync(path.join(root, 'tests/bad.test.ts'), [
      "import { foo } from '../src/foo';",
      "import '../src/side';",
      "const lazy = import('../src/lazy');",
      "import test from 'node:test';",
      "const example = \"import '../src/foo'\";",
      "// import '../src/foo';",
      "/* import '../src/foo'; */",
      '',
    ].join('\n'));

    const result = runGuard(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /tests\/bad\.test\.ts:1.*\.\.\/src\/foo\.ts/);
    assert.match(result.stderr, /tests\/bad\.test\.ts:2.*\.\.\/src\/side\.ts/);
    assert.match(result.stderr, /tests\/bad\.test\.ts:3.*\.\.\/src\/lazy\.tsx/);
    assert.doesNotMatch(result.stderr, /bad\.test\.ts:(?:5|6|7)/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('SEENIT-QUALITY-008 accepte les extensions explicites et ignore packages et code Vite', () => {
  const root = makeFixture();
  try {
    writeFileSync(path.join(root, 'tests/good.test.ts'), [
      "import { foo } from '../src/foo.ts';",
      "import '../src/side.ts';",
      "const lazy = import('../src/lazy.tsx');",
      "import test from 'node:test';",
      "import assert from 'node:assert/strict';",
      '',
    ].join('\n'));
    writeFileSync(path.join(root, 'src/app.ts'), "import './foo';\n");

    const result = runGuard(root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Imports ESM des TNR Node : OK/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('issue #220 installe le garde dans le préflight et les consignes agents', () => {
  const validator = readFileSync('scripts/validate-specifications.cjs', 'utf8');
  const agents = readFileSync('AGENTS.md', 'utf8');
  const bootstrap = readFileSync('.agents/AGENTS.md', 'utf8');
  const delivery = readFileSync('docs/process/delivery.md', 'utf8');

  const guardIndex = validator.indexOf("require('./validate-test-esm-imports.cjs')");
  const catalogueIndex = validator.indexOf("const cataloguePath =");
  assert.ok(guardIndex >= 0 && guardIndex < catalogueIndex, 'le garde doit précéder la validation du catalogue');
  assert.match(agents, /tests\/\*\*\/\*\.test\.ts/);
  assert.match(agents, /node --test/);
  assert.match(agents, /extensions? `\.ts` \/ `\.tsx`/);
  assert.match(bootstrap, /TNR.*Node ESM.*\.ts.*\.tsx/i);
  assert.match(delivery, /garde des imports ESM des TNR Node/i);
});
