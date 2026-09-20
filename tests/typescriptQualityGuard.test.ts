import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  isProductionTypeScript,
  scanRepository,
  scanSource,
  topEntries
} = require('../scripts/lint-typescript-quality.cjs');

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

test('SEENIT-QUALITY-011 borne la mesure au code TypeScript de production', () => {
  assert.equal(isProductionTypeScript('src/lib/api.ts'), true);
  assert.equal(isProductionTypeScript('src/view.tsx'), true);
  assert.equal(isProductionTypeScript('server.ts'), true);
  assert.equal(isProductionTypeScript('tests/example.test.ts'), false);
  assert.equal(isProductionTypeScript('scripts/tool.ts'), false);
  assert.equal(isProductionTypeScript('src/types.d.ts'), false);
});

test('SEENIT-QUALITY-011 publie la baseline actuelle avant gel des seuils', () => {
  const report = scanRepository();
  assert.ok(report.fileCount > 0);
  assert.ok(report.explicitAny > 0, 'la phase de mesure doit observer la dette any historique avant durcissement');
  assert.ok(report.directConsole > 0, 'la phase de mesure doit observer les console directs historiques avant durcissement');

  const summary = {
    scope: report.scope,
    fileCount: report.fileCount,
    explicitAny: report.explicitAny,
    directConsole: report.directConsole,
    topExplicitAny: topEntries(report.files, 'explicitAny'),
    topDirectConsole: topEntries(report.files, 'directConsole')
  };
  console.log('[SEENIT-QUALITY-011 baseline]', JSON.stringify(summary));
});
