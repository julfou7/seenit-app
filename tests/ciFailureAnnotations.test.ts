import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { extractFailureLines, formatFailureAnnotation } = require('../scripts/validate-change.cjs');

test('SEENIT-QUALITY-008 une étape rouge publie sa cause exacte en annotation lisible par l’API', () => {
  // Sorties réelles des quatre quarantaines rouges de #809 (31/10/2026).
  const output = [
    'ok 151 - tests/other.test.ts',
    '# Error [ERR_MODULE_NOT_FOUND]: Cannot find module \'/home/runner/work/seenit-app/seenit-app/src/lib/apiAuth\'',
    'not ok 152 - tests/platformIdentityNotificationBulk.test.ts',
    '\u001b[31m[Changelog] ❌ Commit 66c871dd432f sans bloc Changelog: explicite.\u001b[0m',
    '[Format] ❌ src/components/FilterModal.tsx: fin de ligne finale manquante',
    'src/x.ts(3,7): error TS2322: Type \'string\' is not assignable to type \'number\'.',
    '# pass 1189',
    'not ok 152 - tests/platformIdentityNotificationBulk.test.ts',
  ].join('\n');
  const lines = extractFailureLines(output);
  assert.deepEqual(lines, [
    '# Error [ERR_MODULE_NOT_FOUND]: Cannot find module \'/home/runner/work/seenit-app/seenit-app/src/lib/apiAuth\'',
    'not ok 152 - tests/platformIdentityNotificationBulk.test.ts',
    '[Changelog] ❌ Commit 66c871dd432f sans bloc Changelog: explicite.',
    '[Format] ❌ src/components/FilterModal.tsx: fin de ligne finale manquante',
    'src/x.ts(3,7): error TS2322: Type \'string\' is not assignable to type \'number\'.',
  ], 'causes gardées, couleurs et doublons retirés, lignes vertes ignorées');
  assert.equal(extractFailureLines(Array.from({ length: 50 }, (_, i) => `not ok ${i} - t`).join('\n')).length, 20, 'annotation bornée');

  const annotation = formatFailureAnnotation('Tests unitaires', lines.slice(0, 2));
  assert.match(annotation, /^::error title=Validate Change — Tests unitaires::/);
  assert.match(annotation, /%0Anot ok 152/, 'retours à la ligne encodés pour la commande GitHub');
  assert.doesNotMatch(annotation.split('::')[1], /[,:]/, 'le titre ne casse pas la syntaxe de la commande');
  assert.match(formatFailureAnnotation('Build', []), /lire le log du job/);

  const runner = readFileSync('scripts/validate-change.cjs', 'utf8');
  assert.match(runner, /const annotate = process\.env\.GITHUB_ACTIONS === 'true';/, 'en local, la sortie reste en direct');
  assert.match(runner, /if \(annotate\) reportFailure\(label/);
  assert.match(readFileSync('scripts/pwa-browser-smoke.cjs', 'utf8'), /::error title=PWA Browser Quality Gate::/);
});

test('AGENTS §0.3b documente la lecture des logs par l’API avant toute nouvelle écriture', () => {
  const agents = readFileSync('AGENTS.md', 'utf8');
  assert.match(agents, /### 0\.3b Diagnostiquer une CI rouge/);
  for (const endpoint of ['/actions/runs?head_sha=<SHA>', '/actions/runs/<run_id>/jobs', '/check-runs/<job_id>/annotations', '/actions/jobs/<job_id>/logs']) {
    assert.ok(agents.includes(endpoint), `endpoint documenté : ${endpoint}`);
  }
  assert.match(agents, /Sans cause lue, \*\*ne jamais pousser une nouvelle variante\*\*/);
});
