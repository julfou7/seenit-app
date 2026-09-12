import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/build-apk.yml', 'utf8');
const validateStart = workflow.indexOf('  validate:');
const buildStart = workflow.indexOf('\n  build:', validateStart);
assert.ok(validateStart >= 0 && buildStart > validateStart, 'le job Validate Change doit rester isolable');
const validateJob = workflow.slice(validateStart, buildStart);

function position(label: string): number {
  const index = validateJob.indexOf(label);
  assert.ok(index >= 0, `étape absente du job Validate Change : ${label}`);
  return index;
}

test('SEENIT-QUALITY-008 impose un préflight sans dépendances et un cache exact de confiance', () => {
  assert.match(validateJob, /timeout-minutes:\s*10/);

  const actionlint = position('Install pinned actionlint');
  const preflight = position('Validate Change Preflight');
  const restore = position('Restore Exact node_modules Cache');
  const install = position('Install Dependencies on Cache Miss');
  const canonical = position('Validate Change Canonical');

  assert.ok(actionlint < preflight, 'actionlint verrouillé doit être disponible avant le préflight');
  assert.ok(preflight < restore, 'le préflight doit précéder le cache et l’installation');
  assert.ok(restore < install, 'la restauration exacte doit précéder l’installation de secours');
  assert.ok(install < canonical, 'l’orchestration post-install doit suivre la restauration ou l’installation');

  assert.match(validateJob, /version='1\.7\.12'/);
  assert.match(validateJob, /8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8/);
  assert.match(validateJob, /actionlint_\$\{version\}_linux_amd64\.tar\.gz/);
  assert.match(validateJob, /npm run validate:change -- --preflight/);
  assert.match(validateJob, /npm run validate:change -- --postinstall/);
  assert.match(validateJob, /SEENIT_VALIDATE_BASE_SHA/);
  assert.match(validateJob, /SEENIT_FORCE_DEPENDENCY_AUDIT/);

  assert.doesNotMatch(validateJob, /run:\s*npm run lint\b/);
  assert.doesNotMatch(validateJob, /run:\s*npm run test:unit\b/);
  assert.doesNotMatch(validateJob, /run:\s*npm run test:android\b/);
  assert.doesNotMatch(validateJob, /run:\s*npm run build\b/);
  assert.doesNotMatch(validateJob, /run:\s*node scripts\/materialize-android-config\.cjs/);

  assert.match(validateJob, /uses:\s*actions\/cache\/restore@55cc8345863c7cc4c66a329aec7e433d2d1c52a9/);
  assert.match(validateJob, /path:\s*node_modules/);
  assert.match(validateJob, /runner\.os/);
  assert.match(validateJob, /runner\.arch/);
  assert.match(validateJob, /steps\.runtime\.outputs\.node_version/);
  assert.match(validateJob, /hashFiles\('package\.json', 'package-lock\.json', 'scripts\/patch-local-notifications\.cjs', 'scripts\/materialize-android-config\.cjs'\)/);
  assert.doesNotMatch(validateJob, /restore-keys:/, 'aucune restauration approximative n’est autorisée');
  assert.match(validateJob, /steps\.node_modules_cache\.outputs\.cache-hit != 'true'/);
  assert.match(validateJob, /npm ci --legacy-peer-deps --prefer-offline --no-audit --no-fund/);

  const save = position('Save Trusted node_modules Cache');
  const summary = position('Publish Validation Summary');
  assert.ok(save > canonical, 'le cache de référence ne doit être sauvegardé qu’après la validation canonique verte');
  assert.ok(summary > save, 'le résumé doit conclure le job même après la sauvegarde');
  assert.equal((validateJob.match(/actions\/cache\/save@/g) || []).length, 1, 'un seul point d’écriture du cache est autorisé');

  const saveBlock = validateJob.slice(save, summary);
  assert.match(saveBlock, /success\(\)/);
  assert.match(saveBlock, /github\.event_name == 'push'/);
  assert.match(saveBlock, /github\.ref == 'refs\/heads\/main'/);
  assert.match(saveBlock, /github\.ref == 'refs\/heads\/master'/);
  assert.match(saveBlock, /steps\.node_modules_cache\.outputs\.cache-hit != 'true'/);
  assert.match(saveBlock, /uses:\s*actions\/cache\/save@55cc8345863c7cc4c66a329aec7e433d2d1c52a9/);

  const summaryBlock = validateJob.slice(summary);
  assert.match(summaryBlock, /if:\s*always\(\)/);
  assert.match(summaryBlock, /GITHUB_STEP_SUMMARY/);
  assert.match(summaryBlock, /Mode de livraison/);
  assert.match(summaryBlock, /Cache node_modules/);
  assert.match(summaryBlock, /Préflight workflows \+ SPEC/);
  assert.match(summaryBlock, /TypeScript/);
  assert.match(summaryBlock, /Tests unitaires/);
  assert.match(summaryBlock, /Build Web \+ serveur/);
  assert.match(validateJob, /Set up Node\.js 22 with npm cache[\s\S]*cache:\s*npm/);
});
