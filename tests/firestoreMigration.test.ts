import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  canonicalDocumentLine,
  canonicalizeFirestoreValue
} = require('../scripts/firestore-database-digest.cjs') as {
  canonicalDocumentLine: (path: string, data: unknown) => string;
  canonicalizeFirestoreValue: (value: unknown) => unknown;
};

const read = (path: string) => fs.readFileSync(path, 'utf8');

test('SEENIT-DATA-006 borne la migration unique de default par export, répétition, maintenance et rollback', () => {
  const script = read('scripts/migrate-firestore-default.sh');
  const workflow = read('.github/workflows/firestore-default-migration.yml');
  const lockdown = read('firebase.migration-lockdown.json');
  const lifecycle = JSON.parse(read('config/firestore-export-lifecycle.json'));

  assert.match(workflow, /github\.event\.issue\.number == 23/);
  assert.match(workflow, /github\.event\.comment\.author_association == 'OWNER'/);
  assert.match(workflow, /sha=\(\[0-9a-f\]\{40\}\)/);
  assert.match(script, /SEENIT_MIGRATION_CONFIRMATION/);
  assert.match(script, /readonly DEFAULT_DATABASE='default'/);
  assert.doesNotMatch(script, /readonly DEFAULT_DATABASE='\(default\)'/);
  assert.match(script, /lock_public_traffic[\s\S]*firebase\.migration-lockdown\.json/);
  assert.match(script, /write_digest "\$DEFAULT_DATABASE"[\s\S]*gcloud firestore export/);
  assert.match(script, /write_digest "\$AI_DATABASE"[\s\S]*gcloud firestore export/);
  assert.match(script, /default-rehearsal-digest[\s\S]*compare_digests/);
  assert.match(script, /ai-rehearsal-digest[\s\S]*compare_digests/);
  assert.match(script, /firestore indexes composite list/);
  assert.match(script, /firestore indexes fields list/);
  assert.match(script, /firestore fields ttls list/);
  assert.equal(
    (script.match(/select\(\(\.deleteTime \/\/ ""\) == ""\)/g) ?? []).length,
    2,
    'les tombstones Firestore doivent être ignorés au préflight et dans la topologie finale'
  );
  assert.match(script, /recover_on_failure[\s\S]*restore_default_after_cutover_failure/);
  assert.match(script, /ROLLBACK INCOMPLET[\s\S]*maintenance conservée/);
  assert.match(script, /deploy_rules firebase\.json[\s\S]*restore_public_traffic/);
  assert.match(lockdown, /\(default\)[\s\S]*ai-studio-seenit-/);
  assert.equal(lifecycle.rule[0].action.type, 'Delete');
  assert.equal(lifecycle.rule[0].condition.age, 30);
  if (process.platform !== 'win32') {
    execFileSync('bash', ['-n', 'scripts/migrate-firestore-default.sh']);
  }
});

test('SEENIT-COST-001 transfère le quota gratuit vers default sans stockage permanent', () => {
  const script = read('scripts/migrate-firestore-default.sh');
  const workflowPolicy = read('scripts/validate-workflow-policy.cjs');
  assert.match(script, /--public-access-prevention/);
  assert.match(script, /--soft-delete-duration=0s/);
  assert.match(script, /firestore-export-lifecycle\.json/);
  assert.match(script, /AI_DELETED=true/);
  assert.match(script, /\.freeTier == true/);
  assert.match(script, /\.deleteProtectionState == "DELETE_PROTECTION_ENABLED"/);
  assert.match(script, /\.locationId == \$location[\s\S]*\.databaseEdition == "STANDARD"/);
  assert.match(workflowPolicy, /firestore-default-migration\.yml[^\n]*id-token[^\n]*issues/);
});

test('le digest Firestore est déterministe et ne journalise pas les données', () => {
  const first = {
    z: 4,
    a: {
      second: true,
      first: Buffer.from('secret-value')
    },
    list: [Number.NaN, -0, Infinity]
  };
  const second = {
    list: [Number.NaN, -0, Infinity],
    a: {
      first: Buffer.from('secret-value'),
      second: true
    },
    z: 4
  };
  assert.deepEqual(canonicalizeFirestoreValue(first), canonicalizeFirestoreValue(second));
  const firstLine = canonicalDocumentLine('users/example', first);
  const secondLine = canonicalDocumentLine('users/example', second);
  assert.equal(firstLine, secondLine);
  assert.equal(
    crypto.createHash('sha256').update(firstLine).digest('hex'),
    crypto.createHash('sha256').update(secondLine).digest('hex')
  );

  const digestScript = read('scripts/firestore-database-digest.cjs');
  assert.match(digestScript, /listDocuments[\s\S]*showMissing: true/);
  assert.match(digestScript, /documentCount[\s\S]*collectionGroupCounts[\s\S]*digest/);
  assert.equal(digestScript.includes('console.log(document.data'), false);
  assert.equal(digestScript.includes('JSON.stringify(report, null'), false);
});
