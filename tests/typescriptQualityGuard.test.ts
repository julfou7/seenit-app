import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  addedLineDebt,
  compareFileDebt,
  isProductionTypeScript,
  loadPolicy,
  scanRepository,
  scanSource,
  validateReport
} = require('../scripts/lint-typescript-quality.cjs');
const { normalizeText } = require('../scripts/format-source.cjs');

test('SEENIT-QUALITY-011 mesure any explicites et console directs sans faux positif lexical', () => {
  const metrics = scanSource(`
    type A = any;
    const literal = "any console.log('non')";
    const value = source as any;
    console.warn(value);
    appLogger.warn('system', 'ok');
  `, 'fixture.ts');

  assert.equal(metrics.explicitAny, 2);
  assert.equal(metrics.directConsole, 1);
  assert.deepEqual(metrics.anyLines, [2, 4]);
  assert.deepEqual(metrics.consoleLines, [5]);
});

test('SEENIT-QUALITY-011 impose une amélioration de dette sur chaque fichier endetté touché', () => {
  assert.deepEqual(
    compareFileDebt(
      { explicitAny: 2, directConsole: 2 },
      { explicitAny: 2, directConsole: 2 }
    ),
    ['dette historique non réduite 4 → 4']
  );
  assert.deepEqual(
    compareFileDebt(
      { explicitAny: 1, directConsole: 2 },
      { explicitAny: 2, directConsole: 2 }
    ),
    []
  );
  assert.deepEqual(
    compareFileDebt(
      { explicitAny: 0, directConsole: 0 },
      { explicitAny: 0, directConsole: 0 }
    ),
    []
  );
});

test('SEENIT-QUALITY-011 refuse une nouvelle dette dans une ligne modifiée même si elle est compensée ailleurs', () => {
  const metrics = {
    explicitAny: 2,
    directConsole: 1,
    anyLines: [3, 20],
    consoleLines: [8]
  };
  assert.deepEqual(
    addedLineDebt(metrics, new Set([3, 8])),
    ['any explicite ajouté ligne(s) 3', 'console direct ajouté ligne(s) 8']
  );
  assert.deepEqual(
    addedLineDebt(
      { explicitAny: 0, directConsole: 3, anyLines: [], consoleLines: [5, 10, 15] },
      new Set([15]),
      { explicitAny: 0, directConsole: 3 }
    ),
    []
  );
});

test('SEENIT-QUALITY-011 borne la mesure au code TypeScript de production', () => {
  assert.equal(isProductionTypeScript('src/lib/api.ts'), true);
  assert.equal(isProductionTypeScript('src/view.tsx'), true);
  assert.equal(isProductionTypeScript('server.ts'), true);
  assert.equal(isProductionTypeScript('tests/example.test.ts'), false);
  assert.equal(isProductionTypeScript('scripts/tool.ts'), false);
  assert.equal(isProductionTypeScript('src/types.d.ts'), false);
});

test('SEENIT-QUALITY-011 bloque toute nouvelle dette any/console et active le strict progressif', () => {
  const policy = loadPolicy();
  const report = scanRepository();
  const violations = validateReport(report, policy);

  assert.deepEqual(violations, []);
  assert.equal(policy.observedBaseline.fileCount, 199);
  assert.equal(policy.observedBaseline.explicitAny, 1118);
  assert.equal(policy.observedBaseline.directConsole, 197);
  assert.ok(report.explicitAny < policy.observedBaseline.explicitAny);
  assert.ok(report.directConsole < policy.observedBaseline.directConsole);

  for (const boundary of policy.criticalBoundaries) {
    const metrics = report.files[boundary.path];
    assert.ok(metrics, `frontière absente: ${boundary.path}`);
    assert.ok(metrics.explicitAny <= boundary.maxExplicitAny, boundary.path);
    assert.ok(metrics.directConsole <= boundary.maxDirectConsole, boundary.path);
  }

  const strictConfig = JSON.parse(fs.readFileSync('tsconfig.strict-boundaries.json', 'utf8'));
  assert.equal(strictConfig.compilerOptions.strict, true);
  assert.equal(strictConfig.compilerOptions.allowJs, false);
  assert.deepEqual(strictConfig.files, policy.strictFiles);

  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.match(pkg.scripts.lint, /typecheck/);
  assert.match(pkg.scripts.lint, /typecheck:strict/);
  assert.match(pkg.scripts.lint, /lint:quality/);
  assert.match(pkg.scripts.lint, /format:check/);
});

test('le formatteur minimal normalise fins de ligne et espaces sans réécrire le style', () => {
  assert.equal(normalizeText('const x = 1;  \r\n\r\n'), 'const x = 1;\n');
});
